import { WebSocket } from 'ws';
import { MAX_CLIENTS_PER_BOARD, MAX_CLIENT_QUEUE_BYTES } from './config.js';
import { servicesRuntime } from './runtime/services.js';
import { assertClientAccess } from './client-access.js';
import { PRESENCE_BUFFER_LIMIT } from '../../public/app/presence-channel-model.js';

function broadcast(board, message, exceptClient = null, { transient = false } = {}) {
  let payload;
  try {
    payload = JSON.stringify(message);
  } catch {
    return;
  }
  for (const client of board.clients) {
    if (client === exceptClient) continue;
    try {
      assertClientAccess(client, board);
    } catch {
      client.socket.close(1008, 'Access revoked');
      continue;
    }
    const socket = client.socket;
    if (socket.readyState !== WebSocket.OPEN) continue;
    if (transient && socket.bufferedAmount > PRESENCE_BUFFER_LIMIT) continue;
    if (socket.bufferedAmount > MAX_CLIENT_QUEUE_BYTES) {
      socket.terminate();
      continue;
    }
    socket.send(payload, (error) => {
      if (error) socket.terminate();
    });
    if (message.type === 'committed') trackDeliveredRevision(client, board, message.revision);
  }
}

// Committed messages share one ordered socket with lease results. Tracking the
// contiguous revision delivered to a connection lets lease grants rely on that
// order instead of resending the full document to a client that is merely
// still processing messages already in flight.
function markClientSynced(client, board) {
  client.syncedBoard = board;
  client.syncedRevision = board.state.revision;
}

function trackDeliveredRevision(client, board, revision) {
  if (client.syncedBoard === board && client.syncedRevision === revision - 1) client.syncedRevision = revision;
  else client.syncedBoard = null;
}

function clientHasDeliveredRevision(client, board) {
  return client.syncedBoard === board && client.syncedRevision === board.state.revision;
}

function boardPresence(board) {
  const ids = new Set(Array.from(board.clients, (client) => client.userId || client.id));
  return { clients: ids.size, maxClients: MAX_CLIENTS_PER_BOARD, clientIds: Array.from(ids),
    connectionIds: Array.from(board.clients, client => client.id) };
}

function broadcastPresence(board) {
  const distinct = new Map();
  for (const client of board.clients) {
    const key = client.userId || client.id;
    if (!distinct.has(key)) {
      distinct.set(key, {
        ...(client.userId ? servicesRuntime.accountService.publicUser(client.userId) : { id: key, username: '访客' }),

      });
    }
  }
  broadcast(board, {
    type: 'presence',
    clients: distinct.size,
    maxClients: MAX_CLIENTS_PER_BOARD,
    clientIds: Array.from(distinct.keys()),
    connectionIds: Array.from(board.clients, client => client.id),
    users: Array.from(distinct.values())
  });
}
export { broadcast, boardPresence, broadcastPresence, clientHasDeliveredRevision, markClientSynced };
