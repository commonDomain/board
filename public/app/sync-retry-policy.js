const TRANSIENT_CODES = new Set([
  'RATE_LIMITED', 'INBOUND_QUEUE_LIMIT', 'BOARD_BUSY', 'SHEET_CELL_BUSY',
  'INTERNAL_ERROR', 'SERVER_SHUTTING_DOWN', 'NOT_JOINED', 'MEMORY_PRESSURE', 'STORAGE_LIMIT'
]);

function isTransientSyncError(message) {
  return TRANSIENT_CODES.has(message.code) ||
    // Older servers used the same code for a temporary lease and a data conflict.
    (message.code === 'SHEET_CELL_CONFLICT' &&
      message.message === 'Spreadsheet cell is being edited by another collaborator.');
}

function syncRetryMinimumDelay(message) {
  if (message.code === 'STORAGE_LIMIT') return 60000;
  if (message.code === 'MEMORY_PRESSURE') return 5000;
  if (message.code === 'BOARD_BUSY') return 3600;
  if (message.code === 'SHEET_CELL_BUSY' || message.code === 'SHEET_CELL_CONFLICT') return 1500;
  return 1200;
}

export { isTransientSyncError, syncRetryMinimumDelay };
