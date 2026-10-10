import { ProtocolError } from './protocol-error.js';
import { servicesRuntime } from './runtime/services.js';
import { requireBoardId } from './validation.js';

function requireCatalogBoardId(value, userId = null) {
  const boardId = requireBoardId(value);
  const row = servicesRuntime.database
    .prepare('SELECT owner_user_id FROM canvas_catalog WHERE board_id = ?')
    .get(boardId);
  if (!row || (userId ? !servicesRuntime.accountService.canAccessBoard(userId, boardId) : Boolean(row.owner_user_id))) {
    throw new ProtocolError('CANVAS_NOT_FOUND', 'Canvas does not exist.');
  }
  return boardId;
}

export { requireCatalogBoardId };
