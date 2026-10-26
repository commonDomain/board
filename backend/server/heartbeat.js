import { WebSocket } from 'ws';
import { clients } from './board-registry.js';
import { sendWs } from './websocket-transport.js';
import { HEARTBEAT_INTERVAL_MS } from './config.js';
import { maintenanceStateRuntime } from './runtime/maintenance-state.js';
import { disconnectInvalidSessions } from './session-access.js';

function startHeartbeat() {
  maintenanceStateRuntime.heartbeatTimer = setInterval(() => {
    disconnectInvalidSessions();
    for (const client of Array.from(clients)) {
      if (client.sessionExpiresAt && client.sessionExpiresAt <= Date.now()) {
        sendWs(client, { type: 'error', code: 'AUTH_EXPIRED', message: 'Authentication expired.' });
        client.socket.close(1008, 'Authentication expired');
        continue;
      }
      if (!client.isAlive) {
        client.socket.terminate();
        continue;
      }
      client.isAlive = false;
      if (client.socket.readyState === WebSocket.OPEN) client.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  maintenanceStateRuntime.heartbeatTimer.unref?.();
}

export { startHeartbeat };
