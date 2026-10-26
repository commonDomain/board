
import { enqueueBoard, evictBoardCache, getBoard } from './board-cache.js';
import { releaseBoardEditLease, renewElementEditLeases } from './board-lock.js';
import { clients } from './board-registry.js';
import { broadcast, broadcastPresence, clientHasDeliveredRevision } from './board-broadcast.js';
import { sendBoardSnapshot, sendUnchangedSnapshot } from './broadcast.js';
import { sendWs } from './websocket-transport.js';
import { checkpointBoard, commitOperation } from './commits.js';
import { DOCUMENT_VERSION, MAX_CLIENTS_PER_BOARD } from './config.js';
import { ProtocolError } from './protocol-error.js';
import { servicesRuntime } from './runtime/services.js';
import { assertClientAccess } from './client-access.js';
import { handleSheetLockMessage, releaseClientSheetLocks } from './sheet-locks.js';
import { clampNumber, isSafeId } from './validation.js';
import { reconcileGomokuUser } from './gomoku-presence.js';

function detachClient(client) {
  clearTimeout(client.joinTimer);
  const board = client.board;
  client.board = null;
  clients.delete(client);
  reconcileGomokuUser(client.userId);
  if (!board) return;
  releaseBoardEditLease(board, client);
  releaseClientSheetLocks(board, client);
  board.clients.delete(client);
  board.lastAccessAt = Date.now();
  broadcastPresence(board);
  evictBoardCache();
}

async function handleClientMessage(client, message) {
  assertClientAccess(client, client.board);
  if (client.sessionExpiresAt && client.sessionExpiresAt <= Date.now()) {
    throw new ProtocolError('AUTH_EXPIRED', 'Authentication expired.', { closeCode: 1008 });
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new ProtocolError('INVALID_MESSAGE', 'Message must be an object.');
  }

  if (message.type === 'join') {
    if (message.protocolVersion !== DOCUMENT_VERSION || message.workspaceProtocolVersion !== 4) {
      throw new ProtocolError(
        'PROTOCOL_MISMATCH',
        'Please reload the page to use the current collaboration protocol.',
        { closeCode: 1008 }
      );
    }
    if (client.userId && !servicesRuntime.accountService.canAccessBoard(client.userId, message.boardId)) {
      throw new ProtocolError('CANVAS_NOT_FOUND', 'Canvas does not exist.', { closeCode: 1008 });
    }
    const board = getBoard(message.boardId);
    if (client.board && client.board !== board) {
      releaseBoardEditLease(client.board, client);
      releaseClientSheetLocks(client.board, client);
      client.board.clients.delete(client);
      broadcastPresence(client.board);
      client.board = null;
    }
    if (!board.clients.has(client) && board.clients.size >= MAX_CLIENTS_PER_BOARD) {
      throw new ProtocolError('ROOM_FULL', 'This board is full.', { closeCode: 1008 });
    }
    client.board = board;
    client.workspaceProtocolVersion = message.workspaceProtocolVersion;
    board.clients.add(client);
    board.lastAccessAt = Date.now();
    evictBoardCache();
    clearTimeout(client.joinTimer);
    const hasMatchingSnapshot =
      Number.isSafeInteger(message.lastRevision) &&
      message.lastRevision >= 0 &&
      message.lastRevision === board.state.revision;
    if (hasMatchingSnapshot) sendUnchangedSnapshot(client, board);
    else sendBoardSnapshot(client, board);
    broadcastPresence(board);
    reconcileGomokuUser(client.userId);
    return;
  }

  if (!client.board) {
    throw new ProtocolError('NOT_JOINED', 'Join a board before sending messages.');
  }
  const board = client.board;
  if (board.deleted) {
    throw new ProtocolError('CANVAS_NOT_FOUND', 'Canvas no longer exists.', { closeCode: 1008 });
  }

  if (message.type === 'op') {
    if (!client.opLimit()) {
      throw new ProtocolError('RATE_LIMITED', 'Operations are arriving too quickly.');
    }
    try {
      await enqueueBoard(board, () => commitOperation(board, client, message));
    } catch (error) {
      if (!['BOARD_BUSY', 'REVISION_CONFLICT', 'RATE_LIMITED', 'MEMORY_PRESSURE', 'STORAGE_LIMIT'].includes(error.code))
        releaseBoardEditLease(board, client);
      throw error;
    } finally {
      if (client.board !== board || client.socket.readyState !== 1) releaseBoardEditLease(board, client);
    }
    return;
  }

  if (message.type === 'edit-activity') {
    // Pointer presence must not consume the budget needed to renew a lease.
    // Always process releases in order, even when acquisition is rate-limited.
    if (message.active !== false && !(client.editActivityLimit || client.cursorLimit)()) {
      if (typeof message.requestId === 'string') sendWs(client, { type: 'element-lock-result', boardId: board.id,
        requestId: message.requestId.slice(0, 120), granted: false, reason: 'rate_limited', revision: board.state.revision });
      return;
    }
    await enqueueBoard(board, () => {
      assertClientAccess(client, board);
      if (client.board !== board) return;
      if (message.active === false && !message.itemId && !message.itemIds) { releaseBoardEditLease(board, client); return; }
      const itemIds = Array.isArray(message.itemIds) ? [...new Set(message.itemIds)] : [message.itemId];
      if (!itemIds.length || itemIds.length > 10000 || itemIds.some(id => typeof id !== 'string' ||
          id !== '*' && !isSafeId(id.replace(/^(section|group|document):/, ''))))
        throw new ProtocolError('INVALID_EDIT_TARGET', '编辑目标无效。');
      if (message.active === false) { releaseBoardEditLease(board, client, new Set(itemIds)); return; }
      const granted = renewElementEditLeases(board, client, new Set(itemIds));
      if (typeof message.requestId !== 'string') return;
      // Earlier commits are already queued on this socket ahead of the result.
      // Only an unproven gap needs the authoritative document again.
      if (granted && message.revision !== board.state.revision &&
          !(Number(message.revision) < board.state.revision && clientHasDeliveredRevision(client, board))) sendBoardSnapshot(client, board);
      sendWs(client, { type: 'element-lock-result', boardId: board.id, requestId: message.requestId.slice(0, 120),
        itemId: message.itemId, itemIds, granted, revision: board.state.revision,
        ...(granted && message.includeItem ? { item: message.itemId?.startsWith('section:') ? board.state.sections.find(item => item.id === message.itemId.slice(8)) || null :
          message.itemId?.startsWith('group:') ? board.state.groups.find(item => item.id === message.itemId.slice(6)) || null : board.state.items.find(item => item.id === message.itemId) || null } : {}) });
    });
    return;
  }

  if (['sheet-lock-request', 'sheet-lock-renew', 'sheet-lock-release'].includes(message.type)) {
    if (!client.cursorLimit())
      throw new ProtocolError('RATE_LIMITED', 'Spreadsheet lock requests are arriving too quickly.');
    handleSheetLockMessage(board, client, message);
    return;
  }

  if (message.type === 'save') {
    if (!client.saveLimit()) {
      throw new ProtocolError('RATE_LIMITED', 'Saves are arriving too quickly.');
    }
    const saved = await enqueueBoard(board, () => {
      assertClientAccess(client, board);
      return checkpointBoard(board, client);
    });
    sendWs(client, {
      ...saved,
      requestId: typeof message.requestId === 'string' ? message.requestId.slice(0, 120) : undefined
    });
    return;
  }

  if (message.type === 'resync') {
    await enqueueBoard(board, () => {
      assertClientAccess(client, board);
      return sendBoardSnapshot(client, board);
    });
    return;
  }

  if (message.type === 'cursor') {
    if (message.hidden === true) {
      if (client.cursorVisible === false) return;
      client.cursorVisible = false;
      broadcast(board, { type: 'cursor', from: client.userId || client.id, cursorId: client.id, hidden: true }, client, { transient: true });
      return;
    }
    if (!client.cursorLimit()) return;
    const x = Number(message.x);
    const y = Number(message.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    client.cursorVisible = true;
    broadcast(
      board,
      {
        type: 'cursor',
        from: client.userId || client.id,
        cursorId: client.id,
        x: clampNumber(x, -100000000, 100000000, 0),
        y: clampNumber(y, -100000000, 100000000, 0),

      },
      client,
      { transient: true }
    );
    return;
  }

  if (message.type === 'ping') {
    sendWs(client, { type: 'pong', now: Date.now() });
    return;
  }

  throw new ProtocolError('UNSUPPORTED_MESSAGE', 'Unsupported message type.');
}

export { detachClient, handleClientMessage };
