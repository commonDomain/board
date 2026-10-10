
import { enqueueBoard, evictBoardCache, getBoard } from './board-cache.js';
import { currentBoardEditLease, releaseBoardEditLease, renewBoardEditLease } from './board-lock.js';
import { clients } from './board-registry.js';
import { broadcast, broadcastPresence } from './board-broadcast.js';
import { sendBoardSnapshot, unchangedSnapshotMessage } from './broadcast.js';
import { sendWs } from './websocket-transport.js';
import { checkpointBoard, commitOperation } from './commits.js';
import { DOCUMENT_VERSION, MAX_CLIENTS_PER_BOARD } from './config.js';
import { ProtocolError } from './protocol-error.js';
import { servicesRuntime } from './runtime/services.js';
import { assertClientAccess } from './client-access.js';
import { handleSheetLockMessage, releaseClientSheetLocks } from './sheet-locks.js';
import { clampNumber } from './validation.js';

function detachClient(client) {
  clearTimeout(client.joinTimer);
  const board = client.board;
  client.board = null;
  clients.delete(client);
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
    if (message.protocolVersion !== DOCUMENT_VERSION || message.workspaceProtocolVersion !== 1) {
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
    board.clients.add(client);
    board.lastAccessAt = Date.now();
    evictBoardCache();
    clearTimeout(client.joinTimer);
    const hasMatchingSnapshot =
      Number.isSafeInteger(message.lastRevision) &&
      message.lastRevision >= 0 &&
      message.lastRevision === board.state.revision;
    if (hasMatchingSnapshot) sendWs(client, unchangedSnapshotMessage(board));
    else sendBoardSnapshot(client, board);
    const editLease = currentBoardEditLease(board);
    if (editLease)
      sendWs(client, {
        type: 'board-lock',
        boardId: board.id,
        locked: true,
        ownerClientId: editLease.clientId,
        itemId: editLease.itemId,
        expiresAt: editLease.expiresAt
      });
    broadcastPresence(board);
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
    await enqueueBoard(board, () => commitOperation(board, client, message));
    return;
  }

  if (message.type === 'edit-activity') {
    if (!client.cursorLimit()) return;
    if (message.active === false) releaseBoardEditLease(board, client);
    else renewBoardEditLease(board, client, message.itemId);
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
    if (!client.cursorLimit()) return;
    const x = Number(message.x);
    const y = Number(message.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    broadcast(
      board,
      {
        type: 'cursor',
        from: client.userId || client.id,
        x: clampNumber(x, -100000000, 100000000, 0),
        y: clampNumber(y, -100000000, 100000000, 0),

      },
      client
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
