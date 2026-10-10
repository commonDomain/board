import crypto from 'node:crypto';
import { cachedPointBytes } from '../state-codec.js';
import SheetProtocol from '../../public/sheet-protocol.js';
import { hydrateImageAssetMetadata } from './asset-references.js';
import { boardCacheStats, boards } from './board-registry.js';
import { BOARD_CACHE_IDLE_MS, BOARD_CACHE_MAX_BYTES, BOARD_CACHE_MAX_ENTRIES } from './config.js';
import { defaultState } from './document-defaults.js';
import { assertStateLimits, normalizeStoredState } from './document-validation.js';
import { ProtocolError } from './protocol-error.js';
import { servicesRuntime } from './runtime/services.js';
import { rebuildDerivedIndexes } from './search-index.js';
import { requireBoardId } from './validation.js';

function sheetJournalChecksum(serializedOperation) {
  return crypto.createHash('sha256').update(serializedOperation).digest('hex');
}

function replaySheetJournal(boardId, state, baseRevision, targetRevision) {
  const rows = servicesRuntime.database
    .prepare(
      `
    SELECT revision, canonical_op, checksum FROM sheet_command_journal
    WHERE board_id = ? AND revision > ? AND revision <= ? ORDER BY revision ASC
  `
    )
    .all(boardId, baseRevision, targetRevision);
  let expectedRevision = baseRevision + 1;
  for (const row of rows) {
    if (Number(row.revision) !== expectedRevision)
      throw new Error(`Spreadsheet journal gap for ${boardId} at revision ${expectedRevision}`);
    if (sheetJournalChecksum(row.canonical_op) !== row.checksum)
      throw new Error(`Spreadsheet journal checksum mismatch for ${boardId} at revision ${row.revision}`);
    const operation = JSON.parse(row.canonical_op);
    const item = state.items.find((entry) => entry.id === operation.itemId && entry.type === 'sheet');
    if (!item || operation.kind !== 'sheet-command')
      throw new Error(`Invalid spreadsheet journal operation for ${boardId}`);
    SheetProtocol.applyCanonicalCommand(item, operation.command, { canonical: true });
    item.contentVersion = Math.max(Number(item.contentVersion) || 0, Number(operation.contentVersion) || 0);
    state.revision = Number(row.revision);
    expectedRevision += 1;
  }
  if (expectedRevision - 1 !== targetRevision) throw new Error(`Spreadsheet journal is incomplete for ${boardId}`);
  return state;
}

function loadBoard(boardId) {
  const row = servicesRuntime.database.prepare('SELECT revision, state_json FROM boards WHERE id = ?').get(boardId);
  if (row) {
    const parsed = JSON.parse(row.state_json);
    const checkpointRevision = Math.max(0, Number(parsed?.revision) || 0);
    const state = hydrateImageAssetMetadata(normalizeStoredState(parsed, boardId, checkpointRevision));
    if (checkpointRevision < Number(row.revision))
      replaySheetJournal(boardId, state, checkpointRevision, Number(row.revision));
    state.revision = Number(row.revision);
    assertStateLimits(state);
    return {
      id: boardId,
      state,
      clients: new Set(),
      sheetLocks: new Map(),
      tail: Promise.resolve(),
      pendingTasks: 0,
      lastAccessAt: Date.now(),
      estimatedBytes: Buffer.byteLength(row.state_json, 'utf8'),
      deleted: false
    };
  }

  const state = defaultState(boardId);
  assertStateLimits(state);
  const serialized = JSON.stringify(state);
  servicesRuntime.database
    .prepare(
      'INSERT INTO boards (id, version, revision, state_json, saved_at, updated_at) VALUES (?, 2, 0, ?, NULL, ?)'
    )
    .run(boardId, serialized, state.updatedAt);
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    rebuildDerivedIndexes(boardId, state);
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return {
    id: boardId,
    state,
    clients: new Set(),
    sheetLocks: new Map(),
    tail: Promise.resolve(),
    pendingTasks: 0,
    lastAccessAt: Date.now(),
    estimatedBytes: Buffer.byteLength(serialized, 'utf8'),
    deleted: false
  };
}

function getBoard(boardId) {
  const id = requireBoardId(boardId);
  if (!servicesRuntime.database.prepare('SELECT 1 FROM canvas_catalog WHERE board_id = ?').get(id)) {
    throw new ProtocolError('CANVAS_NOT_FOUND', 'Canvas does not exist.');
  }
  let board = boards.get(id);
  if (!board) {
    boardCacheStats.misses += 1;
    board = loadBoard(id);
    boards.set(id, board);
  } else {
    boardCacheStats.hits += 1;
  }
  board.lastAccessAt = Date.now();
  return board;
}

function enqueueBoard(board, task) {
  board.pendingTasks += 1;
  board.lastAccessAt = Date.now();
  const result = board.tail.then(task).finally(() => {
    board.pendingTasks = Math.max(0, board.pendingTasks - 1);
    board.lastAccessAt = Date.now();
  });
  board.tail = result.catch(() => {});
  return result;
}

function boardCacheBytes() {
  let total = 0;
  for (const board of boards.values())
    total += Math.max(0, Number(board.estimatedBytes) || 0) + cachedPointBytes(board.state);
  return total;
}

function boardCanBeEvicted(board) {
  return board && board.clients.size === 0 && board.pendingTasks === 0 && !board.sheetCheckpointTimer && !board.deleted;
}

function evictBoardCache(options = {}) {
  const now = Date.now();
  const aggressive = options.aggressive === true;
  const candidates = Array.from(boards.values())
    .filter(boardCanBeEvicted)
    .sort((left, right) => left.lastAccessAt - right.lastAccessAt);
  let bytes = boardCacheBytes();
  for (const board of candidates) {
    const idle = now - board.lastAccessAt >= BOARD_CACHE_IDLE_MS;
    const overCapacity = boards.size > BOARD_CACHE_MAX_ENTRIES || bytes > BOARD_CACHE_MAX_BYTES;
    if (!aggressive && !idle && !overCapacity) continue;
    if (boards.get(board.id) !== board || !boardCanBeEvicted(board)) continue;
    boards.delete(board.id);
    bytes = Math.max(0, bytes - (Number(board.estimatedBytes) || 0) - cachedPointBytes(board.state));
    boardCacheStats.evictions += 1;
  }
}

function findCommitted(boardId, opId) {
  const row = servicesRuntime.database
    .prepare(
      `
    SELECT r.revision, r.actor_id, o.canonical_op
    FROM operation_receipts AS r
    LEFT JOIN operations AS o ON o.board_id = r.board_id AND o.op_id = r.op_id
    WHERE r.board_id = ? AND r.op_id = ?
  `
    )
    .get(boardId, opId);
  if (!row) return null;
  return {
    type: 'committed',
    opId,
    revision: Number(row.revision),
    op: row.canonical_op ? JSON.parse(row.canonical_op) : null,
    from: row.actor_id
  };
}

export {
  boardCacheBytes,
  boardCanBeEvicted,
  enqueueBoard,
  evictBoardCache,
  findCommitted,
  getBoard,
  loadBoard,
  replaySheetJournal,
  sheetJournalChecksum
};
