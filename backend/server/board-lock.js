import { WebSocket } from 'ws';
import { broadcast } from './board-broadcast.js';
import { sendWs } from './websocket-transport.js';
import { isSafeId } from './validation.js';

const BOARD_EDIT_LEASE_MS = 3500;

function broadcastBoardEditUnlock(board) {
  broadcast(board, { type: 'board-lock', boardId: board.id, locked: false, revision: board.state.revision });
}

function currentBoardEditLease(board) {
  const lease = board.editLease;
  if (!lease) return null;
  if (lease.expiresAt > Date.now()) return lease;
  if (board.pendingTasks > 0) {
    lease.expiresAt = Date.now() + 1000;
    clearTimeout(board.editLeaseTimer);
    board.editLeaseTimer = setTimeout(() => {
      if (board.editLease === lease) currentBoardEditLease(board);
    }, 1020);
    board.editLeaseTimer.unref?.();
    lease.announcedAt = Date.now();
    broadcast(board, {
      type: 'board-lock',
      boardId: board.id,
      locked: true,
      ownerClientId: lease.clientId,
      itemId: lease.itemId,
      expiresAt: lease.expiresAt
    });
    return lease;
  }
  clearTimeout(board.editLeaseTimer);
  board.editLease = null;
  board.editLeaseTimer = null;
  broadcastBoardEditUnlock(board);
  return null;
}

function releaseBoardEditLease(board, client) {
  if (board.editLease?.clientId !== client.id) return;
  if (board.pendingTasks > 0) {
    const lease = board.editLease;
    void board.tail.then(() => {
      if (
        board.editLease?.clientId === client.id &&
        (board.editLease === lease || client.socket.readyState !== WebSocket.OPEN || client.board !== board)
      ) {
        releaseBoardEditLease(board, client);
      }
    });
    return;
  }
  clearTimeout(board.editLeaseTimer);
  board.editLease = null;
  board.editLeaseTimer = null;
  broadcastBoardEditUnlock(board);
}

function renewBoardEditLease(board, client, itemId = null) {
  const active = currentBoardEditLease(board);
  if (active && active.clientId !== client.id) {
    sendWs(client, {
      type: 'board-lock',
      boardId: board.id,
      locked: true,
      ownerClientId: active.clientId,
      itemId: active.itemId,
      expiresAt: active.expiresAt
    });
    return false;
  }
  const now = Date.now();
  const lease = {
    clientId: client.id,
    itemId: isSafeId(itemId) ? itemId : active?.itemId || null,
    expiresAt: now + BOARD_EDIT_LEASE_MS,
    announcedAt: active?.announcedAt || 0
  };
  if (!active) {
    for (const [key, lock] of board.sheetLocks || []) {
      if (lock.clientId === client.id) continue;
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
  board.editLease = lease;
  clearTimeout(board.editLeaseTimer);
  board.editLeaseTimer = setTimeout(() => {
    if (board.editLease === lease) currentBoardEditLease(board);
  }, BOARD_EDIT_LEASE_MS + 20);
  board.editLeaseTimer.unref?.();
  if (!active || now - lease.announcedAt >= 1000) {
    lease.announcedAt = now;
    broadcast(board, {
      type: 'board-lock',
      boardId: board.id,
      locked: true,
      ownerClientId: client.id,
      itemId: lease.itemId,
      expiresAt: lease.expiresAt
    });
  }
  return true;
}

export { broadcastBoardEditUnlock, currentBoardEditLease, releaseBoardEditLease, renewBoardEditLease };
