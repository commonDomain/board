import { broadcast } from './board-broadcast.js';
import { sendWs } from './websocket-transport.js';
import { isSafeId } from './validation.js';
import { editOperationTargets } from '../../public/app/edit-lock-targets-model.js';

const ELEMENT_EDIT_LEASE_MS = 3500;

function announce(board, leases, locked) {
  const locks = leases.map(lease => ({ type: 'board-lock', boardId: board.id, itemId: lease.itemId,
    locked, ownerClientId: lease.clientId, expiresAt: lease.expiresAt, revision: board.state.revision }));
  if (locks.length) broadcast(board, locks.length === 1 ? locks[0] : { type: 'board-locks', boardId: board.id, locks });
}

function scheduleExpiry(board) {
  if (!board.editLeases.size) {
    clearTimeout(board.editLeaseTimer);
    board.editLeaseTimer = null;
    return;
  }
  if (board.editLeaseTimer) return;
  const expiresAt = Math.min(...[...board.editLeases.values()].map(lease => lease.expiresAt));
  board.editLeaseTimer = setTimeout(() => {
    board.editLeaseTimer = null;
    currentBoardEditLeases(board);
  }, Math.max(1, expiresAt - Date.now() + 20));
  board.editLeaseTimer.unref?.();
}

function currentBoardEditLeases(board) {
  board.editLeases ||= new Map();
  const now = Date.now();
  const expired = [];
  for (const [id, lease] of board.editLeases) {
    if (lease.expiresAt > now) continue;
    board.editLeases.delete(id);
    expired.push(lease);
  }
  announce(board, expired, false);
  scheduleExpiry(board);
  return board.editLeases;
}

function conflictingLease(board, client, ids, leases = currentBoardEditLeases(board)) {
  return [...leases.values()].find(lease => lease.clientId !== client.id &&
    (lease.itemId === '*' || ids.has('*') || ids.has(lease.itemId)));
}

function releaseBoardEditLease(board, client, itemId = null) {
  const ids = itemId instanceof Set ? itemId : itemId ? new Set([itemId]) : null;
  const released = [];
  for (const [id, lease] of currentBoardEditLeases(board)) {
    if (lease.clientId !== client.id || ids && !ids.has(id)) continue;
    board.editLeases.delete(id);
    released.push(lease);
  }
  announce(board, released, false);
  scheduleExpiry(board);
}

function renewBoardEditLease(board, client, itemId) {
  const suffix = typeof itemId === 'string' ? itemId.replace(/^(section|group|document):/, '') : itemId;
  if (!isSafeId(suffix) && itemId !== '*') return false;
  return renewElementEditLeases(board, client, new Set([itemId]));
}

function renewElementEditLeases(board, client, ids) {
  const leases = currentBoardEditLeases(board);
  const conflict = conflictingLease(board, client, ids, leases);
  if (conflict) {
    sendWs(client, { type: 'board-lock', boardId: board.id, locked: true,
      ownerClientId: conflict.clientId, itemId: conflict.itemId, expiresAt: conflict.expiresAt });
    return false;
  }
  const now = Date.now();
  const announced = [];
  for (const itemId of ids) {
    const lease = leases.get(itemId) || { clientId: client.id, itemId, announcedAt: 0 };
    lease.expiresAt = now + ELEMENT_EDIT_LEASE_MS;
    leases.set(itemId, lease);
    if (now - lease.announcedAt >= 900) {
      lease.announcedAt = now;
      announced.push(lease);
    }
  }
  announce(board, announced, true);
  scheduleExpiry(board);
  return true;
}

function renewOperationEditLeases(board, client, operation) {
  return renewElementEditLeases(board, client, editOperationTargets(operation, board.state));
}

export { currentBoardEditLeases, conflictingLease, releaseBoardEditLease, renewBoardEditLease, renewElementEditLeases, renewOperationEditLeases };
