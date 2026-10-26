import crypto from 'node:crypto';
import { GUIDE_SOURCE_BOARD_ID, GUIDE_TEMPLATE, MAX_CANVASES } from './config.js';
import { defaultState } from './document-defaults.js';
import { normalizeStoredState } from './document-validation.js';
import { servicesRuntime } from './runtime/services.js';
import { rebuildDerivedIndexes } from './search-index.js';
import { normalizeCanvasName } from './validation.js';

function nextCanvasId() {
  let id;
  do {
    id = `canvas_${crypto.randomUUID().replace(/-/g, '')}`;
  } while (servicesRuntime.database.prepare('SELECT 1 FROM boards WHERE id = ?').get(id));
  return id;
}

function createCanvas(nameInput, userId = null, visibilityInput = 'shared') {
  const name = normalizeCanvasName(nameInput);
  const visibility = visibilityInput === 'shared' ? 'shared' : 'private';
  const boardId = nextCanvasId();
  const state = defaultState(boardId);
  const now = Date.now();
  const serialized = JSON.stringify(state);
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const duplicate = userId
      ? servicesRuntime.database
          .prepare('SELECT 1 FROM canvas_catalog WHERE owner_user_id = ? AND name = ?')
          .get(userId, name)
      : servicesRuntime.database
          .prepare('SELECT 1 FROM canvas_catalog WHERE owner_user_id IS NULL AND name = ?')
          .get(name);
    if (duplicate) {
      throw Object.assign(new Error('Canvas name already exists.'), { statusCode: 409, code: 'CANVAS_NAME_EXISTS' });
    }
    const row = userId
      ? servicesRuntime.database
          .prepare(
            `SELECT
          SUM(CASE WHEN board_id NOT IN (SELECT board_id FROM guide_canvases) THEN 1 ELSE 0 END) AS count,
          COALESCE(MAX(sort_order), -1) AS max_order
          FROM canvas_catalog WHERE owner_user_id = ?`
          )
          .get(userId)
      : servicesRuntime.database
          .prepare(
            'SELECT COUNT(*) AS count, COALESCE(MAX(sort_order), -1) AS max_order FROM canvas_catalog WHERE owner_user_id IS NULL'
          )
          .get();
    if (Number(row.count) >= MAX_CANVASES) {
      throw Object.assign(new Error(`At most ${MAX_CANVASES} canvases can be created.`), {
        statusCode: 409,
        code: 'CANVAS_LIMIT_REACHED'
      });
    }
    servicesRuntime.database
      .prepare(
        'INSERT INTO boards (id, version, revision, state_json, saved_at, updated_at) VALUES (?, 2, 0, ?, NULL, ?)'
      )
      .run(boardId, serialized, state.updatedAt);
    servicesRuntime.database
      .prepare(
        `
        INSERT INTO canvas_catalog
          (board_id, name, sort_order, preview_version, created_at, owner_user_id, visibility)
        VALUES (?, ?, ?, 0, ?, ?, ?)
      `
      )
      .run(boardId, name, Number(row.max_order) + 1, now, userId, visibility);
    rebuildDerivedIndexes(boardId, state);
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
  return {
    id: boardId,
    name,
    previewVersion: 0,
    previewStyleVersion: 0,
    createdAt: now,
    visibility,
    ownerUserId: userId,
    canManage: Boolean(userId)
  };
}

function ensureGuideCanvas(userId) {
  if (
    !userId ||
    servicesRuntime.database.prepare('SELECT 1 FROM guide_canvases WHERE user_id = ?').get(userId) ||
    servicesRuntime.database.prepare('SELECT 1 FROM dismissed_guide_canvases WHERE user_id = ?').get(userId)
  )
    return;
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    if (
      servicesRuntime.database.prepare('SELECT 1 FROM guide_canvases WHERE user_id = ?').get(userId) ||
      servicesRuntime.database.prepare('SELECT 1 FROM dismissed_guide_canvases WHERE user_id = ?').get(userId)
    ) {
      servicesRuntime.database.exec('COMMIT');
      return;
    }
    const source = servicesRuntime.database
      .prepare('SELECT board_id FROM canvas_catalog WHERE board_id = ? AND owner_user_id = ?')
      .get(GUIDE_SOURCE_BOARD_ID, userId);
    if (source) {
      servicesRuntime.database
        .prepare("UPDATE canvas_catalog SET visibility = 'private' WHERE board_id = ?")
        .run(source.board_id);
      servicesRuntime.database
        .prepare('INSERT INTO guide_canvases (user_id, board_id) VALUES (?, ?)')
        .run(userId, source.board_id);
    } else {
      const boardId = nextCanvasId();
      const now = Date.now();
      const state = normalizeStoredState(
        { ...GUIDE_TEMPLATE, boardId, revision: 1, savedAt: null, updatedAt: now },
        boardId,
        1
      );
      let name = '操作指南';
      let suffix = 2;
      while (
        servicesRuntime.database
          .prepare('SELECT 1 FROM canvas_catalog WHERE owner_user_id = ? AND name = ?')
          .get(userId, name)
      ) {
        name = `操作指南 (${suffix++})`;
      }
      const order = servicesRuntime.database
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maximum FROM canvas_catalog WHERE owner_user_id = ?')
        .get(userId);
      servicesRuntime.database
        .prepare(
          'INSERT INTO boards (id, version, revision, state_json, saved_at, updated_at) VALUES (?, 2, 1, ?, NULL, ?)'
        )
        .run(boardId, JSON.stringify(state), now);
      servicesRuntime.database
        .prepare(
          `INSERT INTO canvas_catalog
        (board_id, name, sort_order, preview_version, created_at, owner_user_id, visibility)
        VALUES (?, ?, ?, 0, ?, ?, 'private')`
        )
        .run(boardId, name, Number(order.maximum) + 1, now, userId);
      servicesRuntime.database
        .prepare('INSERT INTO guide_canvases (user_id, board_id) VALUES (?, ?)')
        .run(userId, boardId);
      rebuildDerivedIndexes(boardId, state);
    }
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

function promoteSeededGuideRevisions() {
  const rows = servicesRuntime.database
    .prepare(
      `
    SELECT b.id, b.state_json FROM boards AS b
    JOIN guide_canvases AS g ON g.board_id = b.id
    WHERE b.revision = 0
  `
    )
    .all();
  if (!rows.length) return;
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const original = JSON.parse(row.state_json);
      const empty = !(original.items?.length || original.sections?.length || original.groups?.length);
      const state = empty
        ? normalizeStoredState(
            { ...GUIDE_TEMPLATE, boardId: row.id, revision: 1, savedAt: null, updatedAt: Date.now() },
            row.id,
            1
          )
        : { ...original, revision: 1 };
      servicesRuntime.database
        .prepare('UPDATE boards SET revision = 1, state_json = ?, updated_at = ? WHERE id = ? AND revision = 0')
        .run(JSON.stringify(state), Date.now(), row.id);
      if (empty) rebuildDerivedIndexes(row.id, state);
    }
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

function listCanvases(userId = null) {
  const rows = userId
    ? servicesRuntime.database
        .prepare(
          `
        SELECT c.board_id, c.name, c.preview_version, c.preview_style_version, c.created_at, c.owner_user_id, c.visibility,
               CASE WHEN g.board_id IS NULL THEN 0 ELSE 1 END AS is_guide,
               u.account_id AS owner_account_id, u.username AS owner_username,
               u.avatar_asset_id AS owner_avatar_asset_id, u.created_at AS owner_created_at,
               COALESCE(o.sort_order, 1000000 + c.created_at) AS viewer_order
        FROM canvas_catalog AS c
        LEFT JOIN guide_canvases AS g ON g.board_id = c.board_id
        LEFT JOIN user_accounts AS u ON u.id = c.owner_user_id
        LEFT JOIN user_canvas_order AS o ON o.user_id = ? AND o.board_id = c.board_id
        WHERE c.owner_user_id = ?
           OR (c.visibility = 'shared' AND c.owner_user_id IN (
             SELECT peer.user_id FROM share_members AS self
             JOIN share_members AS peer ON peer.group_id = self.group_id
             WHERE self.user_id = ?
           ))
        ORDER BY viewer_order, c.created_at, c.board_id
      `
        )
        .all(userId, userId, userId)
    : servicesRuntime.database
        .prepare(
          `
        SELECT c.board_id, c.name, c.preview_version, c.preview_style_version, c.created_at, c.owner_user_id, c.visibility,
               CASE WHEN g.board_id IS NULL THEN 0 ELSE 1 END AS is_guide,
               u.account_id AS owner_account_id, u.username AS owner_username,
               u.avatar_asset_id AS owner_avatar_asset_id, u.created_at AS owner_created_at,
               c.sort_order AS viewer_order
        FROM canvas_catalog AS c
        LEFT JOIN guide_canvases AS g ON g.board_id = c.board_id
        LEFT JOIN user_accounts AS u ON u.id = c.owner_user_id
        WHERE c.owner_user_id IS NULL
        ORDER BY c.sort_order ASC
      `
        )
        .all();
  return rows.map((row) => ({
    id: row.board_id,
    name: row.name,
    previewVersion: Number(row.preview_version),
    previewStyleVersion: Number(row.preview_style_version),
    createdAt: Number(row.created_at),
    visibility: row.visibility || 'shared',
    isGuide: Boolean(row.is_guide),
    ownerUserId: row.owner_user_id || null,
    owner:
      row.owner_user_id && row.owner_account_id
        ? {
            id: row.owner_user_id,
            accountId: row.owner_account_id,
            username: row.owner_username,
            accountSuffix: row.owner_account_id.replace(/-/g, '').slice(-4),
            avatarUrl: row.owner_avatar_asset_id ? `/api/avatars/${row.owner_avatar_asset_id}` : null,
            createdAt: Number(row.owner_created_at)
          }
        : null,
    canManage: Boolean(userId && row.owner_user_id === userId)
  }));
}

export { createCanvas, ensureGuideCanvas, listCanvases, nextCanvasId, promoteSeededGuideRevisions };
