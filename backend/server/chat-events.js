import { clients } from './board-registry.js';
import { servicesRuntime } from './runtime/services.js';
import { sendWs } from './websocket-transport.js';
import { assertClientAccess } from './client-access.js';

// Send invalidations only; message content and read positions use the guarded API.
export function notifyChatChanged(boardId, onlyUserId = null, kind = null) {
  const account = servicesRuntime.accountService;
  for (const client of clients) {
    if (!client.userId || !(client.sessionExpiresAt > Date.now()) || onlyUserId && client.userId !== onlyUserId) continue;
    try { assertClientAccess(client); } catch { continue; }
    if (account.canAccessBoard(client.userId,boardId)) sendWs(client,{type:'chat-changed',boardId,...(kind ? {kind} : {})});
  }
}
