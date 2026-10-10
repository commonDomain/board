import { rebuildStoredAssetReferences } from './asset-references.js';
import { loadBoard } from './board-cache.js';
import { DERIVED_DATA_VERSION, DOCUMENT_VERSION } from './config.js';
import { assertStateLimits, normalizeStoredState } from './document-validation.js';
import { rebuildAmapComponentRegistry } from './integration-links.js';
import { servicesRuntime } from './runtime/services.js';
import { rebuildDerivedIndexes } from './search-index.js';

function migrateStoredDocuments() {
  const rows = servicesRuntime.database
    .prepare(
      `
    SELECT id, revision, state_json FROM boards
    WHERE CASE
      WHEN json_valid(state_json) THEN COALESCE(json_extract(state_json, '$.version'), -1) <> ?
      ELSE 1
    END
    ORDER BY id
  `
    )
    .all(DOCUMENT_VERSION);
  if (!rows.length) return 0;
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    const archiveV2 = servicesRuntime.database.prepare(`
      INSERT OR IGNORE INTO state_v2_archives (board_id, revision, state_json, archived_at)
      VALUES (?, ?, ?, ?)
    `);
    const archiveV3 = servicesRuntime.database.prepare(`
      INSERT OR IGNORE INTO state_v3_archives (board_id, revision, state_json, archived_at)
      VALUES (?, ?, ?, ?)
    `);
    const archiveV4 = servicesRuntime.database.prepare(`
      INSERT OR IGNORE INTO state_v4_archives (board_id, revision, state_json, archived_at)
      VALUES (?, ?, ?, ?)
    `);
    const update = servicesRuntime.database.prepare(
      'UPDATE boards SET state_json = ?, updated_at = ? WHERE id = ? AND revision = ?'
    );
    for (const row of rows) {
      const parsed = JSON.parse(row.state_json);
      if (parsed.version === 2) archiveV2.run(row.id, row.revision, row.state_json, Date.now());
      if (parsed.version === 3) archiveV3.run(row.id, row.revision, row.state_json, Date.now());
      if (parsed.version === 4) archiveV4.run(row.id, row.revision, row.state_json, Date.now());
      const normalized = normalizeStoredState(parsed, row.id, Number(row.revision));
      assertStateLimits(normalized);
      if (parsed.version !== DOCUMENT_VERSION) {
        const result = update.run(JSON.stringify(normalized), normalized.updatedAt, row.id, row.revision);
        if (Number(result.changes) !== 1) throw new Error(`Could not migrate board ${row.id}`);
      }
    }
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw new Error(`Document migration failed; database was left unchanged: ${error.message}`, { cause: error });
  }
  return rows.length;
}

function rebuildDerivedDataIfNeeded(migratedDocuments = 0) {
  const marker = servicesRuntime.database
    .prepare("SELECT value FROM runtime_state WHERE key = 'derived_data_version'")
    .get();
  if (!migratedDocuments && marker?.value === DERIVED_DATA_VERSION) return false;
  rebuildAmapComponentRegistry();
  rebuildStoredAssetReferences();
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of servicesRuntime.database
      .prepare('SELECT id, revision, state_json FROM boards ORDER BY id')
      .all()) {
      rebuildDerivedIndexes(row.id, normalizeStoredState(JSON.parse(row.state_json), row.id, Number(row.revision)));
    }
    servicesRuntime.database
      .prepare(
        `
      INSERT INTO runtime_state (key, value, updated_at) VALUES ('derived_data_version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `
      )
      .run(DERIVED_DATA_VERSION, Date.now());
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return true;
}

function repairDuplicateXmindBoardLinks() {
  servicesRuntime.database.exec(`CREATE TABLE IF NOT EXISTS xmind_link_repair_archives (
    board_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    detached_item_ids_json TEXT NOT NULL,
    archived_at INTEGER NOT NULL,
    PRIMARY KEY (board_id, revision)
  ) STRICT`);
  const groups = servicesRuntime.database
    .prepare(
      `
    SELECT board_id, provider, remote_map_id, COUNT(*) AS copies
    FROM xmind_board_links
    GROUP BY board_id, provider, remote_map_id
    HAVING COUNT(*) > 1
  `
    )
    .all();
  if (!groups.length) {
    servicesRuntime.database.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS xmind_links_unique_remote ON xmind_board_links(board_id, provider, remote_map_id)'
    );
    return 0;
  }
  const boardChanges = new Map();
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    for (const group of groups) {
      const links = servicesRuntime.database
        .prepare(
          `
        SELECT * FROM xmind_board_links
        WHERE board_id=? AND provider=? AND remote_map_id=?
        ORDER BY synced_at ASC, item_id ASC
      `
        )
        .all(group.board_id, group.provider, group.remote_map_id);
      for (const duplicate of links.slice(1)) {
        let change = boardChanges.get(group.board_id);
        if (!change) {
          const board = servicesRuntime.database
            .prepare('SELECT revision, state_json FROM boards WHERE id=?')
            .get(group.board_id);
          if (!board) continue;
          change = { board, state: JSON.parse(board.state_json), detached: [] };
          boardChanges.set(group.board_id, change);
        }
        const item = Array.isArray(change.state.items)
          ? change.state.items.find((entry) => entry?.id === duplicate.item_id)
          : null;
        if (item?.source?.provider === 'xmind') delete item.source;
        change.detached.push(duplicate.item_id);
        servicesRuntime.database
          .prepare('DELETE FROM xmind_board_links WHERE board_id=? AND item_id=?')
          .run(group.board_id, duplicate.item_id);
      }
    }
    const archive = servicesRuntime.database.prepare(`
      INSERT OR IGNORE INTO xmind_link_repair_archives (board_id,revision,state_json,detached_item_ids_json,archived_at)
      VALUES (?,?,?,?,?)
    `);
    const update = servicesRuntime.database.prepare(
      'UPDATE boards SET revision=?, state_json=?, updated_at=? WHERE id=? AND revision=?'
    );
    for (const [boardId, change] of boardChanges) {
      if (!change.detached.length) continue;
      const now = Date.now();
      const revision = Number(change.board.revision) + 1;
      archive.run(boardId, change.board.revision, change.board.state_json, JSON.stringify(change.detached), now);
      change.state.revision = revision;
      change.state.updatedAt = now;
      const result = update.run(revision, JSON.stringify(change.state), now, boardId, change.board.revision);
      if (Number(result.changes) !== 1)
        throw new Error(`XMind duplicate-link repair compare-and-swap failed for ${boardId}`);
    }
    servicesRuntime.database.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS xmind_links_unique_remote ON xmind_board_links(board_id, provider, remote_map_id)'
    );
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return Array.from(boardChanges.values()).reduce((total, change) => total + change.detached.length, 0);
}

function repairDirtyDerivedIndexes() {
  const rows = servicesRuntime.database
    .prepare('SELECT board_id FROM derived_index_dirty ORDER BY updated_at ASC')
    .all();
  for (const row of rows) {
    const board = loadBoard(row.board_id);
    servicesRuntime.database.exec('BEGIN IMMEDIATE');
    try {
      rebuildDerivedIndexes(row.board_id, board.state);
      servicesRuntime.database
        .prepare('UPDATE boards SET state_json = ?, updated_at = ? WHERE id = ? AND revision = ?')
        .run(
          JSON.stringify(board.state),
          Number(board.state.updatedAt) || Date.now(),
          row.board_id,
          board.state.revision
        );
      servicesRuntime.database
        .prepare('DELETE FROM sheet_command_journal WHERE board_id = ? AND revision <= ?')
        .run(row.board_id, board.state.revision);
      servicesRuntime.database.prepare('DELETE FROM derived_index_dirty WHERE board_id = ?').run(row.board_id);
      servicesRuntime.database.exec('COMMIT');
    } catch (error) {
      try {
        servicesRuntime.database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }
}

function ensureCanvasPreviewSchema() {
  const columns = new Set(
    servicesRuntime.database
      .prepare('PRAGMA table_info(canvas_catalog)')
      .all()
      .map((row) => row.name)
  );
  if (!columns.has('preview_style_version')) {
    servicesRuntime.database.exec(`
      ALTER TABLE canvas_catalog
      ADD COLUMN preview_style_version INTEGER NOT NULL DEFAULT 0 CHECK (preview_style_version >= 0)
    `);
  }
}

export {
  ensureCanvasPreviewSchema,
  migrateStoredDocuments,
  rebuildDerivedDataIfNeeded,
  repairDirtyDerivedIndexes,
  repairDuplicateXmindBoardLinks
};
