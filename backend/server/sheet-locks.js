import crypto from 'node:crypto';
import { renewBoardEditLease } from './board-lock.js';
import { broadcast } from './board-broadcast.js';
import { sendWs } from './websocket-transport.js';
import { ProtocolError } from './protocol-error.js';

const SHEET_LOCK_TTL_MS = 20000;

function sheetLockKey(itemId, sheetId, row, column) {
  return `${itemId}\u0000${sheetId}\u0000${row}:${column}`;
}

function releaseClientSheetLocks(board, client) {
  if (!board?.sheetLocks) return;
  for (const [key, lock] of board.sheetLocks) {
    if (lock.clientId !== client.id) continue;
    board.sheetLocks.delete(key);
    broadcast(board, {
      type: 'sheet-lock-changed',
      itemId: lock.itemId,
      sheetId: lock.sheetId,
      row: lock.row,
      column: lock.column,
      locked: false
    });
  }
}

function purgeExpiredSheetLocks(board, now = Date.now()) {
  if (!board?.sheetLocks) board.sheetLocks = new Map();
  for (const [key, lock] of board.sheetLocks) {
    if (lock.expiresAt > now) continue;
    board.sheetLocks.delete(key);
    broadcast(board, {
      type: 'sheet-lock-changed',
      itemId: lock.itemId,
      sheetId: lock.sheetId,
      row: lock.row,
      column: lock.column,
      locked: false
    });
  }
}

function validateSheetLockTarget(board, message) {
  const itemId = typeof message.itemId === 'string' ? message.itemId : '';
  const sheetId = typeof message.sheetId === 'string' ? message.sheetId : '';
  const row = Number(message.row);
  const column = Number(message.column);
  if (
    !itemId ||
    !sheetId ||
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    row >= 50000 ||
    column < 0 ||
    column >= 512
  ) {
    throw new ProtocolError('INVALID_SHEET_LOCK', 'Invalid spreadsheet cell lock target.');
  }
  const item = board.state.items.find((candidate) => candidate?.id === itemId && candidate.type === 'sheet');
  const sheet = item?.workbook?.sheets?.find((candidate) => candidate?.sheetId === sheetId);
  if (!sheet) throw new ProtocolError('SHEET_NOT_FOUND', 'Spreadsheet or worksheet no longer exists.');
  return { itemId, sheetId, row, column };
}

function handleSheetLockMessage(board, client, message) {
  const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 120) : '';
  if (!requestId) throw new ProtocolError('INVALID_SHEET_LOCK', 'Spreadsheet lock request id is required.');
  purgeExpiredSheetLocks(board);
  if (message.type === 'sheet-lock-release') {
    for (const [key, lock] of board.sheetLocks) {
      if (lock.clientId !== client.id || lock.lockId !== message.lockId) continue;
      board.sheetLocks.delete(key);
      sendWs(client, { type: 'sheet-lock-result', requestId, granted: true, released: true });
      broadcast(
        board,
        {
          type: 'sheet-lock-changed',
          itemId: lock.itemId,
          sheetId: lock.sheetId,
          row: lock.row,
          column: lock.column,
          locked: false
        },
        client
      );
      return;
    }
    sendWs(client, { type: 'sheet-lock-result', requestId, granted: false, reason: 'lock-expired' });
    return;
  }
  const target = validateSheetLockTarget(board, message);
  const key = sheetLockKey(target.itemId, target.sheetId, target.row, target.column);
  const existing = board.sheetLocks.get(key);
  if (message.type === 'sheet-lock-renew') {
    if (!existing || existing.clientId !== client.id || existing.lockId !== message.lockId) {
      sendWs(client, { type: 'sheet-lock-result', requestId, granted: false, reason: 'lock-expired', ...target });
      return;
    }
    existing.expiresAt = Date.now() + SHEET_LOCK_TTL_MS;
    sendWs(client, {
      type: 'sheet-lock-result',
      requestId,
      granted: true,
      lockId: existing.lockId,
      expiresAt: existing.expiresAt,
      ...target
    });
    return;
  }
  if (!renewBoardEditLease(board, client, target.itemId)) {
    sendWs(client, { type: 'sheet-lock-result', requestId, granted: false, reason: 'board-busy', ...target });
    return;
  }
  const currentLock = board.sheetLocks.get(key);
  if (currentLock && currentLock.clientId !== client.id) {
    sendWs(client, {
      type: 'sheet-lock-result',
      requestId,
      granted: false,
      reason: 'cell-busy',
      expiresAt: currentLock.expiresAt,
      ...target
    });
    return;
  }
  const lock = currentLock || { ...target, clientId: client.id, lockId: crypto.randomUUID(), expiresAt: 0 };
  lock.expiresAt = Date.now() + SHEET_LOCK_TTL_MS;
  board.sheetLocks.set(key, lock);
  sendWs(client, {
    type: 'sheet-lock-result',
    requestId,
    granted: true,
    lockId: lock.lockId,
    expiresAt: lock.expiresAt,
    ...target
  });
  if (!currentLock)
    broadcast(board, { type: 'sheet-lock-changed', ...target, locked: true, expiresAt: lock.expiresAt }, client);
}

export {
  handleSheetLockMessage,
  purgeExpiredSheetLocks,
  releaseClientSheetLocks,
  sheetLockKey,
  validateSheetLockTarget
};
