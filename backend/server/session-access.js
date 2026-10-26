import { clients } from './board-registry.js';
import { sendProtocolError, sendWs } from './websocket-transport.js';
import { servicesRuntime } from './runtime/services.js';
import { assertClientAccess } from './client-access.js';

function disconnectRevokedUser(userId) {
  for (const client of clients) {
    if (client.userId !== userId || !client.board) continue;
    if (servicesRuntime.accountService.canAccessBoard(userId, client.board.id)) continue;
    sendWs(client, { type: 'access-revoked', boardId: client.board.id });
    client.socket.close(1008, 'Access revoked');
  }
}

function sharingUserIds(userId) {
  const group = servicesRuntime.accountService.groupForUser(userId);
  if (!group) return [userId];
  return servicesRuntime.database
    .prepare('SELECT user_id FROM share_members WHERE group_id = ?')
    .all(group.id)
    .map((row) => row.user_id);
}

function notifySharingChanged(userIds, reason) {
  const recipients = new Set(userIds);
  if (!recipients.size) return;
  for (const client of clients) {
    if (client.userId && recipients.has(client.userId)) {
      sendWs(client, { type: 'sharing-changed', reason });
    }
  }
}

function disconnectInvalidSessions() {
  for (const client of clients) {
    try {
      assertClientAccess(client, client.board);
    } catch (error) {
      sendProtocolError(client, error);
    }
  }
}
export { disconnectRevokedUser, sharingUserIds, notifySharingChanged, disconnectInvalidSessions };
