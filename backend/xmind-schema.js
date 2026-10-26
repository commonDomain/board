'use strict';

function initializeSchema(service) {
  service.database.exec(`
      CREATE TABLE IF NOT EXISTS xmind_oauth_client (
        issuer TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS xmind_oauth_flows (
        state_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'global' CHECK (provider IN ('global','china')),
        verifier_ciphertext TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS xmind_connections (
        user_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'global' CHECK (provider IN ('global','china')),
        token_ciphertext TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('connected','reauthorize')),
        connected_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS xmind_board_links (
        board_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'global' CHECK (provider IN ('global','china')),
        remote_map_id TEXT NOT NULL,
        remote_name TEXT NOT NULL,
        remote_hash TEXT NOT NULL,
        baseline_tree_json TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (board_id, item_id),
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS xmind_links_user ON xmind_board_links(user_id);
    `);
  const linkColumns = new Set(
    service.database
      .prepare('PRAGMA table_info(xmind_board_links)')
      .all()
      .map((column) => column.name)
  );
  if (!linkColumns.has('provider'))
    service.database.exec(
      "ALTER TABLE xmind_board_links ADD COLUMN provider TEXT NOT NULL DEFAULT 'global' CHECK (provider IN ('global','china'))"
    );
  if (!linkColumns.has('pending_remote_hash'))
    service.database.exec('ALTER TABLE xmind_board_links ADD COLUMN pending_remote_hash TEXT');
  if (!linkColumns.has('pending_tree_json'))
    service.database.exec('ALTER TABLE xmind_board_links ADD COLUMN pending_tree_json TEXT');
  if (!linkColumns.has('pending_synced_at'))
    service.database.exec('ALTER TABLE xmind_board_links ADD COLUMN pending_synced_at INTEGER');
  if (!linkColumns.has('baseline_relations_json'))
    service.database.exec(
      "ALTER TABLE xmind_board_links ADD COLUMN baseline_relations_json TEXT NOT NULL DEFAULT '[]'"
    );
  if (!linkColumns.has('pending_relations_json'))
    service.database.exec('ALTER TABLE xmind_board_links ADD COLUMN pending_relations_json TEXT');
  const flowColumns = new Set(
    service.database
      .prepare('PRAGMA table_info(xmind_oauth_flows)')
      .all()
      .map((column) => column.name)
  );
  if (!flowColumns.has('provider'))
    service.database.exec(
      "ALTER TABLE xmind_oauth_flows ADD COLUMN provider TEXT NOT NULL DEFAULT 'global' CHECK (provider IN ('global','china'))"
    );
  const connectionColumns = new Set(
    service.database
      .prepare('PRAGMA table_info(xmind_connections)')
      .all()
      .map((column) => column.name)
  );
  if (!connectionColumns.has('provider'))
    service.database.exec(
      "ALTER TABLE xmind_connections ADD COLUMN provider TEXT NOT NULL DEFAULT 'global' CHECK (provider IN ('global','china'))"
    );
}
module.exports = { initializeSchema };
