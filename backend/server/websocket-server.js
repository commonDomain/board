import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { URL } from 'node:url';
import { recordAuthenticatedUserOnline } from './account-response.js';
import { clients } from './board-registry.js';
import { sendProtocolError, sendWs } from './websocket-transport.js';
import {
  DOCUMENT_VERSION,
  JOIN_TIMEOUT_MS,
  MAX_CLIENT_INBOUND_MESSAGES,
  MAX_CLIENT_INBOUND_QUEUE_BYTES,
  MAX_MESSAGE_SIZE,
  MAX_WEBSOCKET_CLIENTS,
  OPS_RATE_LIMIT,
  SAVE_RATE_LIMIT
} from './config.js';
import { isOriginAllowed } from './http-security.js';
import { server } from './http-server.js';
import { ProtocolError } from './protocol-error.js';
import { createRateLimiter } from './rate-limits.js';
import { resourceStatus } from './resource-state.js';
import { refreshMemoryStatus } from './resources.js';
import { serverStateRuntime } from './runtime/server-state.js';
import { servicesRuntime } from './runtime/services.js';
import { detachClient, handleClientMessage } from './socket-messages.js';

const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MESSAGE_SIZE,
  perMessageDeflate: {
    threshold: 1024,
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    concurrencyLimit: 4,
    zlibDeflateOptions: { level: 6, memLevel: 7 }
  }
});

server.on('upgrade', (req, socket, head) => {
  if (!serverStateRuntime.isAccepting) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  refreshMemoryStatus();
  if (clients.size >= MAX_WEBSOCKET_CLIENTS || !resourceStatus.memoryWritable) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\n\r\n');
    socket.destroy();
    return;
  }
  let requestUrl;
  try {
    requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    socket.destroy();
    return;
  }
  if (requestUrl.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!isOriginAllowed(req, { requireOrigin: true })) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const session = servicesRuntime.accountService.readSession(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  recordAuthenticatedUserOnline(req, session, 'websocket-online');
  req.accountSession = session;
  webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
    webSocketServer.emit('connection', webSocket, req);
  });
});

webSocketServer.on('connection', (socket, req) => {
  const client = {
    id: crypto.randomUUID(),
    userId: req?.accountSession?.userId || null,
    sessionTokenHash: req?.accountSession?.tokenHash || null,
    sessionExpiresAt: Number(req?.accountSession?.expiresAt) || null,
    socket,
    board: null,
    isAlive: true,
    inboundTail: Promise.resolve(),
    opLimit: createRateLimiter(OPS_RATE_LIMIT, 1000),
    saveLimit: createRateLimiter(SAVE_RATE_LIMIT, 1000),
    cursorLimit: createRateLimiter(60, 1000),
    inboundQueuedBytes: 0,
    inboundQueuedMessages: 0,
    joinTimer: null
  };
  clients.add(client);
  client.joinTimer = setTimeout(() => {
    if (!client.board && socket.readyState === WebSocket.OPEN) socket.close(1008, 'Join timeout');
  }, JOIN_TIMEOUT_MS);
  client.joinTimer.unref?.();

  socket.on('pong', () => {
    client.isAlive = true;
  });
  socket.on('message', (payload, isBinary) => {
    if (!serverStateRuntime.isAccepting) {
      sendProtocolError(client, new ProtocolError('SERVER_SHUTTING_DOWN', 'Server is shutting down.'));
      return;
    }
    if (isBinary) {
      sendProtocolError(client, new ProtocolError('BINARY_UNSUPPORTED', 'Binary messages are not supported.'));
      return;
    }
    const messageBytes = Number(payload?.length ?? payload?.byteLength) || 0;
    if (
      client.inboundQueuedMessages >= MAX_CLIENT_INBOUND_MESSAGES ||
      client.inboundQueuedBytes + messageBytes > MAX_CLIENT_INBOUND_QUEUE_BYTES
    ) {
      sendProtocolError(
        client,
        new ProtocolError('INBOUND_QUEUE_LIMIT', 'Too much unprocessed data is queued.', { closeCode: 1009 })
      );
      return;
    }
    client.inboundQueuedBytes += messageBytes;
    client.inboundQueuedMessages += 1;
    let operationId;
    let requestId;
    const run = client.inboundTail.then(() => {
      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch {
        throw new ProtocolError('INVALID_JSON', 'Invalid JSON message.');
      }
      operationId = message && typeof message === 'object' ? message.opId : undefined;
      requestId =
        message?.type === 'save' && typeof message.requestId === 'string' ? message.requestId.slice(0, 120) : undefined;
      return handleClientMessage(client, message);
    });
    client.inboundTail = run
      .catch((error) =>
        sendProtocolError(client, error, operationId ? { opId: operationId } : requestId ? { requestId } : {})
      )
      .finally(() => {
        client.inboundQueuedBytes = Math.max(0, client.inboundQueuedBytes - messageBytes);
        client.inboundQueuedMessages = Math.max(0, client.inboundQueuedMessages - 1);
      });
  });
  socket.on('close', () => detachClient(client));
  socket.on('error', () => detachClient(client));

  sendWs(client, {
    type: 'hello',
    clientId: client.userId || client.id,
    socketClientId: client.id,
    user: client.userId ? servicesRuntime.accountService.publicUser(client.userId) : null,
    protocolVersion: DOCUMENT_VERSION,
    sheetOps: 2,
    sheetLocks: 1
  });
});

export { webSocketServer };
