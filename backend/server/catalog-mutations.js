import crypto from 'node:crypto';
import { replaceAssetReferences } from './asset-references.js';
import { enqueueBoard } from './board-cache.js';
import { boards } from './board-registry.js';
import { sendWs } from './websocket-transport.js';
import { listCanvases, nextCanvasId } from './catalog.js';
import { requireCatalogBoardId } from './catalog-access.js';
import {BOARD_ID_PATTERN} from './item-schema.js';
import {MAX_CANVASES,MAX_CANVAS_NAME_LENGTH} from './config.js';
import { defaultState } from './document-defaults.js';
import { assertStateLimits, normalizeStoredState } from './document-validation.js';
import { prepareAmapItems, syncAmapComponentRegistry } from './integration-links.js';
import { prepareItem } from './item-assets.js';
import { servicesRuntime } from './runtime/services.js';
import { rebuildDerivedIndexes } from './search-index.js';
import { cleanString, normalizeCanvasName } from './validation.js';
import { remapPlans, rewriteReferences } from '../../frontend/planning/transfer.js';
import { importPlanningSnapshots } from './planning.js';

function renameCanvas(boardIdInput, nameInput, userId = null) {
  const boardId = requireCatalogBoardId(boardIdInput, userId);
  if (userId && !servicesRuntime.accountService.canManageBoard(userId, boardId)) {
    throw Object.assign(new Error('Only the canvas owner can rename it.'), {
      statusCode: 403,
      code: 'CANVAS_OWNER_REQUIRED'
    });
  }
  const name = normalizeCanvasName(nameInput);
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const duplicate = servicesRuntime.database
      .prepare('SELECT 1 FROM canvas_catalog WHERE owner_user_id IS ? AND name = ? AND board_id <> ?')
      .get(userId, name, boardId);
    if (duplicate) {
      throw Object.assign(new Error('Canvas name already exists.'), { statusCode: 409, code: 'CANVAS_NAME_EXISTS' });
    }
    servicesRuntime.database.prepare('UPDATE canvas_catalog SET name = ? WHERE board_id = ?').run(name, boardId);
    const stateRow = servicesRuntime.database
      .prepare('SELECT revision, state_json FROM boards WHERE id = ?')
      .get(boardId);
    rebuildDerivedIndexes(
      boardId,
      normalizeStoredState(JSON.parse(stateRow.state_json), boardId, Number(stateRow.revision))
    );
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
      throw Object.assign(new Error('Canvas name already exists.'), { statusCode: 409, code: 'CANVAS_NAME_EXISTS' });
    }
    throw error;
  }
  return listCanvases(userId).find((canvas) => canvas.id === boardId);
}

function reorderCanvases(idsInput, userId = null) {
  if (
    !Array.isArray(idsInput) ||
    !idsInput.length ||
    idsInput.length > (userId ? (MAX_CANVASES + 1) * 5 : MAX_CANVASES) ||
    idsInput.some((id) => typeof id !== 'string' || !BOARD_ID_PATTERN.test(id)) ||
    new Set(idsInput).size !== idsInput.length
  ) {
    throw Object.assign(new Error('Canvas order must contain each canvas id exactly once.'), {
      statusCode: 400,
      code: 'INVALID_CANVAS_ORDER'
    });
  }

  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const existing = listCanvases(userId).map((canvas) => canvas.id);
    if (existing.length !== idsInput.length || existing.some((id) => !idsInput.includes(id))) {
      throw Object.assign(new Error('Canvas list changed. Refresh it and try again.'), {
        statusCode: 409,
        code: 'CANVAS_CATALOG_CHANGED'
      });
    }
    if (userId) {
      servicesRuntime.database.prepare('DELETE FROM user_canvas_order WHERE user_id = ?').run(userId);
      const update = servicesRuntime.database.prepare(
        'INSERT INTO user_canvas_order (user_id, board_id, sort_order) VALUES (?, ?, ?)'
      );
      idsInput.forEach((id, index) => update.run(userId, id, index));
    } else {
      servicesRuntime.database
        .prepare('UPDATE canvas_catalog SET sort_order = sort_order + 100 WHERE owner_user_id IS NULL')
        .run();
      const update = servicesRuntime.database.prepare('UPDATE canvas_catalog SET sort_order = ? WHERE board_id = ?');
      idsInput.forEach((id, index) => update.run(index, id));
    }
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return listCanvases(userId);
}

async function deleteCanvas(boardIdInput, userId = null) {
  const boardId = requireCatalogBoardId(boardIdInput, userId);
  if (userId && !servicesRuntime.accountService.canManageBoard(userId, boardId)) {
    throw Object.assign(new Error('Only the canvas owner can delete it.'), {
      statusCode: 403,
      code: 'CANVAS_OWNER_REQUIRED'
    });
  }
  const board = boards.get(boardId);
  if (board) board.deleted = true;

  const remove = () => {
    servicesRuntime.database.exec('BEGIN IMMEDIATE');
    try {
      const ownerRow = servicesRuntime.database
        .prepare('SELECT owner_user_id FROM canvas_catalog WHERE board_id = ?')
        .get(boardId);
      const guide = servicesRuntime.database
        .prepare('SELECT user_id FROM guide_canvases WHERE board_id = ?')
        .get(boardId);
      if (guide) {
        servicesRuntime.database
          .prepare('INSERT OR IGNORE INTO dismissed_guide_canvases (user_id, dismissed_at) VALUES (?, ?)')
          .run(guide.user_id, Date.now());
      }
      const count = userId
        ? Number(
            servicesRuntime.database
              .prepare('SELECT COUNT(*) AS count FROM canvas_catalog WHERE owner_user_id = ?')
              .get(userId).count
          )
        : Number(
            servicesRuntime.database
              .prepare('SELECT COUNT(*) AS count FROM canvas_catalog WHERE owner_user_id IS NULL')
              .get().count
          );
      if (!userId && count <= 1) {
        throw Object.assign(new Error('The last canvas cannot be deleted.'), {
          statusCode: 409,
          code: 'LAST_CANVAS'
        });
      }
      const spatialRows = servicesRuntime.database
        .prepare('SELECT spatial_id FROM spatial_entities WHERE board_id = ?')
        .all(boardId);
      const deleteBounds = servicesRuntime.database.prepare('DELETE FROM board_bounds WHERE spatial_id = ?');
      for (const row of spatialRows) deleteBounds.run(row.spatial_id);
      servicesRuntime.database.prepare('DELETE FROM search_index WHERE board_id = ?').run(boardId);
      servicesRuntime.database
        .prepare("DELETE FROM asset_references WHERE owner_type = 'board' AND owner_id = ?")
        .run(boardId);
      archiveHostPlans(servicesRuntime.database, 'canvas', boardId);
      servicesRuntime.database.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
      servicesRuntime.database
        .prepare('UPDATE canvas_catalog SET sort_order = sort_order + 100 WHERE owner_user_id IS ?')
        .run(ownerRow?.owner_user_id || null);
      const remaining = servicesRuntime.database
        .prepare('SELECT board_id FROM canvas_catalog WHERE owner_user_id IS ? ORDER BY sort_order ASC')
        .all(ownerRow?.owner_user_id || null);
      const update = servicesRuntime.database.prepare('UPDATE canvas_catalog SET sort_order = ? WHERE board_id = ?');
      remaining.forEach((row, index) => update.run(index, row.board_id));
      servicesRuntime.database.exec('COMMIT');
    } catch (error) {
      try {
        servicesRuntime.database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  };

  try {
    if (board) await enqueueBoard(board, remove);
    else remove();
  } catch (error) {
    if (board) board.deleted = false;
    throw error;
  }

  if (board) {
    for (const client of Array.from(board.clients)) {
      sendWs(client, { type: 'canvas-deleted', boardId });
      client.socket.close(1008, 'Canvas deleted');
    }
    boards.delete(boardId);
  }
  return listCanvases(userId);
}

async function deleteAccountAndCanvases(userId) {
  const owned = servicesRuntime.database
    .prepare('SELECT board_id FROM canvas_catalog WHERE owner_user_id = ?')
    .all(userId);
  const activeBoards = owned.map((row) => boards.get(row.board_id)).filter(Boolean);
  for (const board of activeBoards) board.deleted = true;
  await Promise.all(activeBoards.map((board) => enqueueBoard(board, () => undefined)));
  let result;
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const deleteBounds = servicesRuntime.database.prepare('DELETE FROM board_bounds WHERE spatial_id = ?');
    const deleteSearch = servicesRuntime.database.prepare('DELETE FROM search_index WHERE board_id = ?');
    const deleteReferences = servicesRuntime.database.prepare(
      "DELETE FROM asset_references WHERE owner_type = 'board' AND owner_id = ?"
    );
    const deleteBoard = servicesRuntime.database.prepare('DELETE FROM boards WHERE id = ?');
    servicesRuntime.database.prepare('DELETE FROM planning_documents WHERE owner_user_id=?').run(userId);
    for (const row of owned) {
      for (const spatial of servicesRuntime.database
        .prepare('SELECT spatial_id FROM spatial_entities WHERE board_id = ?')
        .all(row.board_id)) {
        deleteBounds.run(spatial.spatial_id);
      }
      deleteSearch.run(row.board_id);
      deleteReferences.run(row.board_id);
      deleteBoard.run(row.board_id);
    }
    servicesRuntime.database.prepare("DELETE FROM asset_references WHERE owner_type = 'notebook' AND owner_id IN (SELECT id FROM independent_notebooks WHERE owner_user_id = ?)").run(userId);
    servicesRuntime.database.prepare('DELETE FROM independent_notebooks WHERE owner_user_id = ?').run(userId);
    result = servicesRuntime.accountService.deleteAccount(userId);
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    for (const board of activeBoards) board.deleted = false;
    throw error;
  }
  for (const board of activeBoards) {
    for (const client of Array.from(board.clients)) {
      sendWs(client, { type: 'account-deleted' });
      client.socket.close(1008, 'Account deleted');
    }
    boards.delete(board.id);
  }
  return result;
}

function setCanvasVisibility(boardIdInput, visibilityInput, userId) {
  const boardId = requireCatalogBoardId(boardIdInput, userId);
  if (servicesRuntime.database.prepare('SELECT 1 FROM guide_canvases WHERE board_id = ?').get(boardId)) {
    throw Object.assign(new Error('The guide canvas is private.'), { statusCode: 409, code: 'GUIDE_CANVAS_FIXED' });
  }
  if (!servicesRuntime.accountService.canManageBoard(userId, boardId)) {
    throw Object.assign(new Error('Only the canvas owner can change privacy.'), {
      statusCode: 403,
      code: 'CANVAS_OWNER_REQUIRED'
    });
  }
  const visibility = visibilityInput === 'private' ? 'private' : visibilityInput === 'shared' ? 'shared' : null;
  if (!visibility)
    throw Object.assign(new Error('Visibility must be shared or private.'), {
      statusCode: 400,
      code: 'INVALID_VISIBILITY'
    });
  servicesRuntime.database
    .prepare('UPDATE canvas_catalog SET visibility = ? WHERE board_id = ?')
    .run(visibility, boardId);
  const board = boards.get(boardId);
  if (visibility === 'private' && board) {
    for (const client of Array.from(board.clients)) {
      if (client.userId === userId) continue;
      sendWs(client, { type: 'access-revoked', boardId });
      client.socket.close(1008, 'Access revoked');
    }
  }
  return listCanvases(userId).find((canvas) => canvas.id === boardId);
}

async function importGuestCanvases(userId, input) {
  const candidates = Array.isArray(input?.canvases) ? input.canvases : [];
  if (!candidates.length || candidates.length > MAX_CANVASES) {
    throw Object.assign(new Error('Select between 1 and 10 guest canvases to import.'), {
      statusCode: 400,
      code: 'INVALID_GUEST_IMPORT'
    });
  }
  const requestHash = crypto.createHash('sha256').update(JSON.stringify([candidates,input.planning||[]])).digest('hex');
  const findReceipt = () =>
    servicesRuntime.database
      .prepare('SELECT imported_guest_ids FROM guest_import_receipts WHERE user_id = ? AND request_hash = ?')
      .get(userId, requestHash);
  const importResult = (ids) => ({ importedGuestIds: ids, canvases: listCanvases(userId), maximum: MAX_CANVASES });
  const receipt = findReceipt();
  if (receipt) return importResult(JSON.parse(receipt.imported_guest_ids));
  const owned = servicesRuntime.database
    .prepare(
      'SELECT c.name, c.sort_order, g.board_id AS guide_board_id FROM canvas_catalog AS c LEFT JOIN guide_canvases AS g ON g.board_id = c.board_id WHERE c.owner_user_id = ? ORDER BY c.sort_order'
    )
    .all(userId);
  if (owned.filter((row) => !row.guide_board_id).length + candidates.length > MAX_CANVASES) {
    throw Object.assign(new Error(`Import would exceed the ${MAX_CANVASES} canvas limit.`), {
      statusCode: 409,
      code: 'CANVAS_LIMIT_REACHED'
    });
  }
  const usedNames = new Set(owned.map((row) => row.name));
  const prepared = [];
  for (const [index, candidate] of candidates.entries()) {
    const guestId = cleanString(candidate?.id, 100, '');
    if (!/^guest_[a-zA-Z0-9]+$/.test(guestId)) {
      throw Object.assign(new Error('Guest canvas id is invalid.'), { statusCode: 400, code: 'INVALID_GUEST_IMPORT' });
    }
    let baseName = normalizeCanvasName(candidate?.name);
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      const tail = ` (${suffix})`;
      name = `${Array.from(baseName)
        .slice(0, Math.max(1, MAX_CANVAS_NAME_LENGTH - tail.length))
        .join('')}${tail}`;
      suffix += 1;
    }
    usedNames.add(name);
    const boardId = nextCanvasId();
    const rawSnapshot = candidate?.snapshot && typeof candidate.snapshot === 'object' ? candidate.snapshot : {};
    const importedItems = [];
    for (const rawItem of Array.isArray(rawSnapshot.items) ? rawSnapshot.items : [])
      importedItems.push(await prepareItem(rawItem, { userId }));
    let normalized;
    try {
      normalized = normalizeStoredState({ ...rawSnapshot, boardId, revision: 0, items: importedItems }, boardId, 0);
    } catch {
      throw Object.assign(new Error('Guest canvas contains invalid document data.'), {
        statusCode: 400,
        code: 'INVALID_GUEST_IMPORT'
      });
    }
    normalized.revision = 0;
    normalized.savedAt = null;
    normalized.updatedAt = Date.now();
    prepareAmapItems(defaultState(boardId), normalized, userId);
    assertStateLimits(normalized);
    prepared.push({
      guestId,
      boardId,
      name,
      state: normalized,
      sortOrder: Number(owned.at(-1)?.sort_order ?? -1) + index + 1
    });
  }
  const now = Date.now();
  const migrated=remapPlans(input.planning||[],host=>{const target=prepared.find(canvas=>canvas.guestId===host.boardId&&host.kind==='canvas');if(!target)throw new Error('规划宿主不在本次导入范围');return {kind:'canvas',boardId:target.boardId};},ref=>{const target=prepared.find(canvas=>canvas.guestId===ref.boardId&&ref.kind==='canvas');return target?{...ref,boardId:target.boardId}:null;},userId);
  for(const canvas of prepared)rewriteReferences(canvas.state,migrated.mapping);
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const concurrentReceipt = findReceipt();
    if (concurrentReceipt) {
      servicesRuntime.database.exec('ROLLBACK');
      return importResult(JSON.parse(concurrentReceipt.imported_guest_ids));
    }
    const currentOwned = servicesRuntime.database
      .prepare(
        'SELECT c.name, c.sort_order, g.board_id AS guide_board_id FROM canvas_catalog AS c LEFT JOIN guide_canvases AS g ON g.board_id = c.board_id WHERE c.owner_user_id = ?'
      )
      .all(userId);
    if (currentOwned.filter((row) => !row.guide_board_id).length + prepared.length > MAX_CANVASES) {
      throw Object.assign(new Error(`Import would exceed the ${MAX_CANVASES} canvas limit.`), {
        statusCode: 409,
        code: 'CANVAS_LIMIT_REACHED'
      });
    }
    const currentNames = new Set(currentOwned.map((row) => row.name));
    for (const [index, canvas] of prepared.entries()) {
      const baseName = canvas.name;
      let suffix = 2;
      while (currentNames.has(canvas.name)) {
        const tail = ` (${suffix++})`;
        canvas.name = `${Array.from(baseName)
          .slice(0, Math.max(1, MAX_CANVAS_NAME_LENGTH - tail.length))
          .join('')}${tail}`;
      }
      currentNames.add(canvas.name);
      canvas.sortOrder = Math.max(-1, ...currentOwned.map((row) => Number(row.sort_order))) + index + 1;
    }
    const insertBoard = servicesRuntime.database.prepare(
      'INSERT INTO boards (id, version, revision, state_json, saved_at, updated_at) VALUES (?, 2, 0, ?, NULL, ?)'
    );
    const insertCatalog = servicesRuntime.database.prepare(`
      INSERT INTO canvas_catalog (board_id, name, sort_order, preview_version, created_at, owner_user_id, visibility)
      VALUES (?, ?, ?, 0, ?, ?, 'private')
    `);
    for (const canvas of prepared) {
      insertBoard.run(canvas.boardId, JSON.stringify(canvas.state), now);
      insertCatalog.run(canvas.boardId, canvas.name, canvas.sortOrder, now, userId);
      syncAmapComponentRegistry(canvas.boardId, defaultState(canvas.boardId), canvas.state);
      rebuildDerivedIndexes(canvas.boardId, canvas.state);
      replaceAssetReferences('board', canvas.boardId, canvas.state);
    }
    importPlanningSnapshots(servicesRuntime.database,userId,migrated.plans,'guest_import');
    servicesRuntime.database
      .prepare(
        'INSERT INTO guest_import_receipts (user_id, request_hash, imported_guest_ids, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(userId, requestHash, JSON.stringify(prepared.map((canvas) => canvas.guestId)), now);
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return {
    importedGuestIds: prepared.map((canvas) => canvas.guestId),
    canvases: listCanvases(userId),
    maximum: MAX_CANVASES
  };
}

export {
  deleteAccountAndCanvases,
  deleteCanvas,
  importGuestCanvases,
  renameCanvas,
  reorderCanvases,
  setCanvasVisibility
};

import { archiveHostPlans } from './planning-schema.js';
