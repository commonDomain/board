import { OP_RECEIPT_LIMIT, OP_RETENTION_MS } from './config.js';
import { recoveryStatus } from './recovery-state.js';
import { servicesRuntime } from './runtime/services.js';

function initializeRuntimeRecoveryState() {
  const row = servicesRuntime.database.prepare("SELECT value FROM runtime_state WHERE key = 'clean_shutdown'").get();
  recoveryStatus.previousShutdownUnclean = Boolean(row && row.value !== '1');
  if (recoveryStatus.previousShutdownUnclean) {
    const check = servicesRuntime.database.prepare('PRAGMA quick_check').all();
    recoveryStatus.quickCheck = check.every((entry) => entry.quick_check === 'ok') ? 'ok' : 'failed';
    if (recoveryStatus.quickCheck !== 'ok') {
      throw new Error('SQLite quick_check failed after an unclean shutdown. Restore from a verified backup.');
    }
  } else {
    recoveryStatus.quickCheck = 'not-needed';
  }
  servicesRuntime.database
    .prepare(
      `
    INSERT INTO runtime_state (key, value, updated_at) VALUES ('clean_shutdown', '0', ?)
    ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = excluded.updated_at
  `
    )
    .run(Date.now());
  const backupRow = servicesRuntime.database
    .prepare("SELECT value FROM runtime_state WHERE key = 'last_backup_at'")
    .get();
  recoveryStatus.lastBackupAt = backupRow?.value || null;
}

function seedOperationReceipts() {
  servicesRuntime.database
    .prepare(
      `
    INSERT OR IGNORE INTO operation_receipts (board_id, op_id, revision, actor_id, created_at)
    SELECT board_id, op_id, revision, actor_id, created_at FROM operations
  `
    )
    .run();
}

function trimBoardRows(table, boardId, maximum) {
  const boundary = servicesRuntime.database
    .prepare(
      `
    SELECT revision FROM ${table}
    WHERE board_id = ?
    ORDER BY revision DESC
    LIMIT 1 OFFSET ?
  `
    )
    .get(boardId, maximum - 1);
  if (boundary) {
    servicesRuntime.database
      .prepare(`DELETE FROM ${table} WHERE board_id = ? AND revision < ?`)
      .run(boardId, boundary.revision);
  }
}

function pruneOperationHistory() {
  const cutoff = Date.now() - OP_RETENTION_MS;
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    servicesRuntime.database.prepare('DELETE FROM operations WHERE created_at < ?').run(cutoff);
    servicesRuntime.database.prepare('DELETE FROM operation_receipts WHERE created_at < ?').run(cutoff);
    const boardIds = servicesRuntime.database.prepare('SELECT id FROM boards').all();
    for (const { id } of boardIds) {
      trimBoardRows('operations', id, OP_RECEIPT_LIMIT);
      trimBoardRows('operation_receipts', id, OP_RECEIPT_LIMIT);
    }
    servicesRuntime.database.exec('COMMIT');
    recoveryStatus.lastMaintenanceAt = new Date().toISOString();
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

export { initializeRuntimeRecoveryState, pruneOperationHistory, seedOperationReceipts, trimBoardRows };
