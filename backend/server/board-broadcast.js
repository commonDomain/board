import { WebSocket } from 'ws';
import { MAX_CLIENTS_PER_BOARD, MAX_CLIENT_QUEUE_BYTES } from './config.js';
import { servicesRuntime } from './runtime/services.js';
import { assertClientAccess } from './client-access.js';

function broadcast(board, message, exceptClient = null) {
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
    if (socket.bufferedAmount > MAX_CLIENT_QUEUE_BYTES) {
      socket.terminate();
      continue;
    }
    socket.send(payload, (error) => {
      if (error) socket.terminate();
    });
  }
}

function boardPresence(board) {
  const ids = new Set(Array.from(board.clients, (client) => client.userId || client.id));
  return { clients: ids.size, maxClients: MAX_CLIENTS_PER_BOARD, clientIds: Array.from(ids) };
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
    users: Array.from(distinct.values())
  });
}
export { broadcast, boardPresence, broadcastPresence };
