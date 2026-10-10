import { WebSocket } from 'ws';
import { MAX_CLIENT_QUEUE_BYTES } from './config.js';
import { ProtocolError } from './protocol-error.js';

function sendWs(client, message) {
  const socket = client.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  if (socket.bufferedAmount > MAX_CLIENT_QUEUE_BYTES) {
    socket.terminate();
    return false;
  }
  let payload;
  try {
    payload = JSON.stringify(message);
  } catch {
    return false;
  }
  socket.send(payload, (error) => {
    if (error) socket.terminate();
  });
  return true;
}

function sendProtocolError(client, error, correlation = {}) {
  const isProtocol = error instanceof ProtocolError;
  sendWs(client, {
    type: 'error',
    code: isProtocol ? error.code : 'INTERNAL_ERROR',
    message: isProtocol ? error.message : 'Server could not process that message.',
    ...correlation
  });
  if (!isProtocol) console.error(error);
  if (isProtocol && error.closeCode) client.socket.close(error.closeCode, error.message.slice(0, 120));
}
export { sendWs, sendProtocolError };
