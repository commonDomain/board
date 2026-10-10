import { ProtocolError } from './protocol-error.js';
import { servicesRuntime } from './runtime/services.js';

function assertClientAccess(client, board = null) {
  const session = servicesRuntime.database
    .prepare('SELECT user_id, expires_at FROM user_sessions WHERE token_hash = ?')
    .get(client.sessionTokenHash || '');
  if (!session || session.user_id !== client.userId || Number(session.expires_at) <= Date.now()) {
    throw new ProtocolError('AUTH_EXPIRED', '会话已失效，请重新登录。', { closeCode: 1008 });
  }
  if (board && (board.deleted || !servicesRuntime.accountService.canAccessBoard(client.userId, board.id))) {
    throw new ProtocolError('CANVAS_NOT_FOUND', '画布访问权限已撤销。', { closeCode: 1008 });
  }
}
export { assertClientAccess };
