import { cloneStateForOperation } from '../state-codec.js';
import SheetProtocol from '../../public/sheet-protocol.js';
import ConnectorCore from '../../public/connector-core.js';
import { operationMayAffectAssets, replaceAssetReferences } from './asset-references.js';
import { enqueueBoard, findCommitted, sheetJournalChecksum } from './board-cache.js';
import { renewBoardEditLease } from './board-lock.js';
import { boards } from './board-registry.js';
import { broadcast } from './board-broadcast.js';
import { sendWs } from './websocket-transport.js';
import { DOCUMENT_VERSION } from './config.js';
import { assertStateLimits, isItemLocked } from './document-validation.js';
import {
  prepareAmapItems,
  prepareXmindItems,
  syncAmapComponentRegistry,
  syncXmindLinkRegistry
} from './integration-links.js';
import { applyOperationToDraft } from './operations.js';
import { ProtocolError } from './protocol-error.js';
import { assertWriteCapacity } from './resources.js';
import { servicesRuntime } from './runtime/services.js';
import { rebuildDerivedIndexes, syncDerivedIndexes } from './search-index.js';
import { assertClientAccess } from './client-access.js';
import { purgeExpiredSheetLocks, sheetLockKey } from './sheet-locks.js';
import { cleanString, requireOpId } from './validation.js';
import { brainConnectorIds } from '../../public/app/planning-source-links.js';
import { reconcileSavedBrains } from './planning-sources.js';
import { invalidatePlanning } from './planning-events.js';

async function commitOperation(board, client, message) {
  if (message?.op?.kind === 'sheet-command' && ['set-cell', 'patch-cells'].includes(message.op.command?.type)) {
    return commitSheetDeltaOperation(board, client, message);
  }
  assertClientAccess(client, board);
  const opId = requireOpId(message.opId);
  if (!Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0) {
    throw new ProtocolError('INVALID_BASE_REVISION', 'baseRevision must be a non-negative integer.');
  }

  const duplicate = findCommitted(board.id, opId);
  if (duplicate) {
    sendWs(client, { ...duplicate, duplicate: true });
    return;
  }

  if (message.baseRevision !== board.state.revision) {
    throw new ProtocolError(
      'REVISION_CONFLICT',
      `Expected revision ${board.state.revision}, received ${message.baseRevision}.`
    );
  }

  if (!renewBoardEditLease(board, client, message.op?.item?.id || message.op?.itemId || null)) {
    throw new ProtocolError('BOARD_BUSY', 'Another member is editing this canvas.');
  }

  const hasNewConnections = board.state.items.some((item) => item.type === 'connector' && item.connectorVersion);
  if (hasNewConnections && message.connectorCapabilities !== 1)
    throw new ProtocolError('CONNECTOR_VERSION', 'Please refresh to use the updated connection system.');
  const draft = cloneStateForOperation(board.state);
  let canonicalOperation = await applyOperationToDraft(draft, message.op, {
    depth: 0,
    count: 0,
    userId: client.userId
  });
  const oldItems = new Map(board.state.items.map((item) => [item.id, item]));
  const removedBrains = board.state.items.filter(item => item.type === 'mindmap' && !draft.items.some(value => value.id === item.id));
  const lines = brainConnectorIds(board.state.items, removedBrains.map(item => item.id)).filter(id => draft.items.some(item => item.id === id));
  if (lines.length) canonicalOperation = { kind: 'batch', ops: [canonicalOperation, await applyOperationToDraft(draft, { kind: 'delete', ids: lines }, { depth: 0, count: 0, userId: client.userId })] };
  const newItems = new Map(draft.items.map((item) => [item.id, item]));
  const oldSections = new Map(board.state.sections.map((section) => [section.id, section]));
  const newSections = new Map(draft.sections.map((section) => [section.id, section]));
  const terminalUpdates = [];
  for (const connection of draft.items) {
    if (connection.type !== 'connector' || !connection.connectorVersion) continue;
    let changed = false;
    for (const key of ['source', 'target']) {
      const terminal = connection[key];
      if (!terminal.binding || terminal.status === 'orphan') continue;
      const sections = terminal.binding.kind === 'section';
      const oldOwner = (sections ? oldSections : oldItems).get(terminal.binding.id);
      const newOwner = (sections ? newSections : newItems).get(terminal.binding.id);
      if (!newOwner && oldOwner) {
        terminal.status = 'orphan';
        connection.fieldVersions[key]++;
        changed = true;
      } else if (
        newOwner &&
        oldOwner &&
        terminal.binding.content &&
        ['x', 'y', 'w', 'h', 'rotation'].some((field) => newOwner[field] !== oldOwner[field])
      ) {
        const previousTerminal = oldItems.get(connection.id)?.[key];
        // Explicit DOM geometry from an upsert is more precise than an affine fallback.
        if (previousTerminal && JSON.stringify(previousTerminal.fallback) === JSON.stringify(terminal.fallback)) {
          const local = ConnectorCore.rotate(terminal.fallback, oldOwner, true);
          terminal.fallback = ConnectorCore.rotate(
            {
              x: newOwner.x + ((local.x - oldOwner.x) / Math.max(1, oldOwner.w)) * newOwner.w,
              y: newOwner.y + ((local.y - oldOwner.y) / Math.max(1, oldOwner.h)) * newOwner.h
            },
            newOwner
          );
          changed = true;
        }
      }
    }
    if (changed) {
      ConnectorCore.apply(connection);
      terminalUpdates.push({ kind: 'upsert', item: structuredClone(connection) });
    }
  }
  if (terminalUpdates.length) canonicalOperation = { kind: 'batch', ops: [canonicalOperation, ...terminalUpdates] };
  prepareAmapItems(board.state, draft, client.userId);
  prepareXmindItems(board.id, board.state, draft, client.userId);
  const revision = board.state.revision + 1;
  draft.version = DOCUMENT_VERSION;
  draft.boardId = board.id;
  draft.revision = revision;
  draft.updatedAt = Date.now();
  const serializedState = assertStateLimits(draft);
  const serializedOperation = JSON.stringify(canonicalOperation);
  await assertWriteCapacity(
    Buffer.byteLength(serializedState, 'utf8') + Buffer.byteLength(serializedOperation, 'utf8')
  );
  assertClientAccess(client, board);
  let changedPlans = [];
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    if (!hasNewConnections && draft.items.some((item) => item.type === 'connector' && item.connectorVersion)) {
      servicesRuntime.database
        .prepare(
          'INSERT OR IGNORE INTO connector_migration_archives (board_id, revision, state_json, archived_at) VALUES (?, ?, ?, ?)'
        )
        .run(board.id, board.state.revision, JSON.stringify(board.state), Date.now());
    }
    const updated = servicesRuntime.database
      .prepare('UPDATE boards SET revision = ?, state_json = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .run(revision, serializedState, draft.updatedAt, board.id, board.state.revision);
    if (Number(updated.changes) !== 1) {
      throw new Error(`Revision compare-and-swap failed for board ${board.id}`);
    }
    servicesRuntime.database
      .prepare(
        'INSERT INTO operations (board_id, op_id, revision, canonical_op, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(board.id, opId, revision, serializedOperation, client.userId || client.id, Date.now());
    servicesRuntime.database
      .prepare(
        'INSERT INTO operation_receipts (board_id, op_id, revision, actor_id, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(board.id, opId, revision, client.userId || client.id, Date.now());
    servicesRuntime.database
      .prepare('DELETE FROM sheet_command_journal WHERE board_id = ? AND revision <= ?')
      .run(board.id, revision);
    if (operationMayAffectAssets(canonicalOperation, board.state)) {
      replaceAssetReferences('board', board.id, draft);
    }
    syncAmapComponentRegistry(board.id, board.state, draft);
    syncXmindLinkRegistry(board.id, board.state, draft, client.userId);
    const derivedIndexesWereDirty = Boolean(
      servicesRuntime.database.prepare('SELECT 1 FROM derived_index_dirty WHERE board_id = ?').get(board.id)
    );
    if (derivedIndexesWereDirty) rebuildDerivedIndexes(board.id, draft);
    else syncDerivedIndexes(board.id, draft, canonicalOperation);
    servicesRuntime.database.prepare('DELETE FROM derived_index_dirty WHERE board_id = ?').run(board.id);
    changedPlans = reconcileSavedBrains(servicesRuntime.database, { kind: 'canvas', boardId: board.id }, board.state.items, draft.items, client.userId);
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }

  board.state = draft;
  board.estimatedBytes = Buffer.byteLength(serializedState, 'utf8');
  board.lastAccessAt = Date.now();
  changedPlans.forEach(invalidatePlanning);
  broadcast(board, {
    type: 'committed',
    opId,
    revision,
    op: canonicalOperation,
    from: client.userId || client.id
  });
}

function scheduleSheetCheckpoint(board) {
  if (board.sheetCheckpointTimer || board.deleted) return;
  board.sheetCheckpointTimer = setTimeout(() => {
    board.sheetCheckpointTimer = null;
    void enqueueBoard(board, async () => {
      if (!board.deleted) await checkpointBoard(board, null);
    }).catch((error) => console.warn(`Spreadsheet checkpoint failed for ${board.id}`, error));
  }, 2000);
  board.sheetCheckpointTimer.unref?.();
}

async function commitSheetDeltaOperation(board, client, message) {
  assertClientAccess(client, board);
  const opId = requireOpId(message.opId);
  if (!Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0)
    throw new ProtocolError('INVALID_BASE_REVISION', 'baseRevision must be a non-negative integer.');
  const duplicate = findCommitted(board.id, opId);
  if (duplicate) {
    sendWs(client, { ...duplicate, duplicate: true });
    return;
  }
  if (message.baseRevision !== board.state.revision)
    throw new ProtocolError(
      'REVISION_CONFLICT',
      `Expected revision ${board.state.revision}, received ${message.baseRevision}.`
    );
  const itemId = cleanString(message.op.itemId, 128, '');
  const item = board.state.items.find((entry) => entry.id === itemId && entry.type === 'sheet');
  if (!item) throw new ProtocolError('SHEET_NOT_FOUND', 'Spreadsheet no longer exists.');
  if (isItemLocked(board.state, item))
    throw new ProtocolError('ITEM_LOCKED', 'Locked spreadsheet content cannot be changed.');
  let command;
  try {
    command = SheetProtocol.normalizeCommand(message.op.command, item.workbook);
  } catch (error) {
    throw new ProtocolError(error.code || 'INVALID_SHEET_COMMAND', error.message);
  }
  const sheet = item.workbook.sheets.find((entry) => entry.sheetId === command.sheetId);
  const changes = command.type === 'set-cell' ? [command] : command.cells;
  purgeExpiredSheetLocks(board);
  const canonicalCells = [];
  for (const change of changes) {
    const key = `${change.row}:${change.column}`;
    const currentVersion = Math.max(0, Math.trunc(Number(sheet.cellVersions?.[key]) || 0));
    if (currentVersion !== change.expectedCellVersion)
      throw new ProtocolError(
        'SHEET_CELL_CONFLICT',
        `Cell version changed from ${change.expectedCellVersion} to ${currentVersion}.`
      );
    const activeLock = board.sheetLocks.get(sheetLockKey(itemId, command.sheetId, change.row, change.column));
    if (activeLock && activeLock.clientId !== client.id)
      throw new ProtocolError('SHEET_CELL_CONFLICT', 'Spreadsheet cell is being edited by another collaborator.');
    canonicalCells.push({ ...change, version: currentVersion + 1 });
  }
  if (!renewBoardEditLease(board, client, itemId)) {
    throw new ProtocolError('BOARD_BUSY', 'Another member is editing this canvas.');
  }
  const editedAt = Math.max(
    Number(item.sheetEditedAt) || 0,
    Math.trunc(Number(message.op.command.editedAt) || Date.now())
  );
  const contentVersion = Math.max(0, Number(item.contentVersion) || 0) + 1;
  const canonicalCommand =
    command.type === 'set-cell'
      ? {
          ...canonicalCells[0],
          type: 'set-cell',
          protocolVersion: SheetProtocol.VERSION,
          sheetId: command.sheetId,
          expectedStructureVersion: command.expectedStructureVersion,
          editedAt
        }
      : {
          type: 'patch-cells',
          protocolVersion: SheetProtocol.VERSION,
          sheetId: command.sheetId,
          expectedStructureVersion: command.expectedStructureVersion,
          cells: canonicalCells,
          editedAt
        };
  const canonicalOperation = {
    kind: 'sheet-command',
    itemId,
    command: canonicalCommand,
    contentVersion
  };
  const serializedOperation = JSON.stringify(canonicalOperation);
  const revision = board.state.revision + 1;
  await assertWriteCapacity(Buffer.byteLength(serializedOperation, 'utf8') * 2);
  assertClientAccess(client, board);
  const now = Date.now();
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const updated = servicesRuntime.database
      .prepare('UPDATE boards SET revision = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .run(revision, now, board.id, board.state.revision);
    if (Number(updated.changes) !== 1) throw new Error(`Revision compare-and-swap failed for board ${board.id}`);
    servicesRuntime.database
      .prepare(
        'INSERT INTO operations (board_id, op_id, revision, canonical_op, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(board.id, opId, revision, serializedOperation, client.userId || client.id, now);
    servicesRuntime.database
      .prepare(
        'INSERT INTO operation_receipts (board_id, op_id, revision, actor_id, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(board.id, opId, revision, client.userId || client.id, now);
    servicesRuntime.database
      .prepare(
        'INSERT INTO sheet_command_journal (board_id, revision, op_id, canonical_op, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(board.id, revision, opId, serializedOperation, sheetJournalChecksum(serializedOperation), now);
    servicesRuntime.database
      .prepare(
        `
      INSERT INTO derived_index_dirty (board_id, updated_at) VALUES (?, ?)
      ON CONFLICT(board_id) DO UPDATE SET updated_at = excluded.updated_at
    `
      )
      .run(board.id, now);
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  try {
    SheetProtocol.applyCanonicalCommand(item, canonicalOperation.command, { canonical: true });
  } catch (error) {
    boards.delete(board.id);
    throw error;
  }
  item.contentVersion = contentVersion;
  board.state.revision = revision;
  board.state.updatedAt = now;
  board.lastAccessAt = now;
  broadcast(board, { type: 'committed', opId, revision, op: canonicalOperation, from: client.userId || client.id });
  scheduleSheetCheckpoint(board);
}

async function checkpointBoard(board, client) {
  const savedAt = new Date().toISOString();
  const nextState = { ...board.state, savedAt };
  const serialized = JSON.stringify(nextState);
  await assertWriteCapacity(Buffer.byteLength(serialized, 'utf8'));
  if (client) assertClientAccess(client, board);
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const updated = servicesRuntime.database
      .prepare('UPDATE boards SET state_json = ?, saved_at = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .run(serialized, savedAt, nextState.updatedAt, board.id, board.state.revision);
    if (Number(updated.changes) !== 1) throw new Error(`Checkpoint compare-and-swap failed for board ${board.id}`);
    if (servicesRuntime.database.prepare('SELECT 1 FROM derived_index_dirty WHERE board_id = ?').get(board.id)) {
      rebuildDerivedIndexes(board.id, nextState);
      servicesRuntime.database.prepare('DELETE FROM derived_index_dirty WHERE board_id = ?').run(board.id);
    }
    servicesRuntime.database
      .prepare('DELETE FROM sheet_command_journal WHERE board_id = ? AND revision <= ?')
      .run(board.id, board.state.revision);
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  board.state = nextState;
  board.estimatedBytes = Buffer.byteLength(serialized, 'utf8');
  board.lastAccessAt = Date.now();
  servicesRuntime.database.prepare('PRAGMA wal_checkpoint(PASSIVE)').all();
  return { type: 'saved', revision: board.state.revision, savedAt };
}

export { checkpointBoard, commitOperation, commitSheetDeltaOperation, scheduleSheetCheckpoint };
