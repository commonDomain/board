'use strict';

const { tableColumns } = require('./account-helpers');

// Schema changes run before serving requests; migration transactions roll back together.
function initializeAccountSchema(database) {
  database.exec(`
      CREATE TABLE IF NOT EXISTS user_accounts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        avatar_asset_id TEXT,
        recovery_salt TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS passkey_credentials (
        credential_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        public_key BLOB NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports_json TEXT NOT NULL DEFAULT '[]',
        device_type TEXT NOT NULL,
        backed_up INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL DEFAULT 'Passkey',
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS passkeys_user_id ON passkey_credentials(user_id);
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        challenge TEXT NOT NULL,
        user_id TEXT,
        payload_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS auth_challenges_expiry ON auth_challenges(expires_at);
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        system_name TEXT NOT NULL DEFAULT '未知系统',
        app_name TEXT NOT NULL DEFAULT '未知 APP',
        device_class TEXT NOT NULL DEFAULT 'desktop' CHECK (device_class IN ('mobile', 'desktop')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS user_sessions_expiry ON user_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS recent_auth_grants (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_token_hash TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('add-passkey', 'bind-email')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (session_token_hash) REFERENCES user_sessions(token_hash) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS recent_auth_grants_expiry ON recent_auth_grants(expires_at);
      CREATE TABLE IF NOT EXISTS account_security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS account_security_events_user_created
        ON account_security_events(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS device_pairings (
        id TEXT PRIMARY KEY,
        approve_token_hash TEXT NOT NULL UNIQUE,
        claim_token_hash TEXT NOT NULL UNIQUE,
        verification_code TEXT NOT NULL,
        intent TEXT NOT NULL CHECK (intent IN ('login', 'register', 'recovery')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'claimed', 'cancelled')),
        user_id TEXT,
        expires_at INTEGER NOT NULL,
        approved_at INTEGER,
        claimed_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS device_pairings_expiry ON device_pairings(expires_at);
      CREATE TABLE IF NOT EXISTS external_identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL,
        email TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, subject),
        UNIQUE (provider, user_id),
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS external_identities_user ON external_identities(user_id);
      CREATE TABLE IF NOT EXISTS email_auth_requests (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        claim_token_hash TEXT UNIQUE,
        email TEXT NOT NULL,
        intent TEXT NOT NULL CHECK (intent IN ('login', 'register', 'bind')),
        requested_user_id TEXT,
        provider_email_id TEXT,
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        last_event_at INTEGER,
        expires_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (requested_user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS email_auth_requests_email_created ON email_auth_requests(email, created_at);
      CREATE INDEX IF NOT EXISTS email_auth_requests_provider ON email_auth_requests(provider_email_id);
      CREATE INDEX IF NOT EXISTS email_auth_requests_expiry ON email_auth_requests(expires_at);
      CREATE TABLE IF NOT EXISTS resend_webhook_events (
        event_id TEXT PRIMARY KEY,
        provider_email_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS resend_webhook_events_received ON resend_webhook_events(received_at);
      CREATE TABLE IF NOT EXISTS asset_upload_grants (
        asset_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (asset_id, user_id),
        FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS asset_upload_grants_expiry ON asset_upload_grants(expires_at);
      CREATE TABLE IF NOT EXISTS share_groups (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL UNIQUE,
        invite_code_hash TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (owner_user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS share_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL UNIQUE,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES share_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS share_members_group ON share_members(group_id);
      CREATE TABLE IF NOT EXISTS user_canvas_order (
        user_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (user_id, board_id),
        UNIQUE (user_id, sort_order),
        FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);
  const sessionColumns = tableColumns(database, 'user_sessions');
  if (!sessionColumns.has('system_name')) {
    database.exec("ALTER TABLE user_sessions ADD COLUMN system_name TEXT NOT NULL DEFAULT '未知系统'");
  }
  if (!sessionColumns.has('app_name')) {
    database.exec("ALTER TABLE user_sessions ADD COLUMN app_name TEXT NOT NULL DEFAULT '未知 APP'");
  }
  if (!sessionColumns.has('device_class')) {
    database.exec(
      "ALTER TABLE user_sessions ADD COLUMN device_class TEXT NOT NULL DEFAULT 'desktop' CHECK (device_class IN ('mobile', 'desktop'))"
    );
  }
  const catalogColumns = tableColumns(database, 'canvas_catalog');
  if (!catalogColumns.has('owner_user_id')) {
    database.exec('ALTER TABLE canvas_catalog ADD COLUMN owner_user_id TEXT REFERENCES user_accounts(id)');
  }
  if (!catalogColumns.has('visibility')) {
    database.exec(
      "ALTER TABLE canvas_catalog ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private'))"
    );
  }
  const emailRequestColumns = tableColumns(database, 'email_auth_requests');
  let invalidatesLegacyEmailRequests = false;
  if (!emailRequestColumns.has('claim_token_hash')) {
    database.exec('ALTER TABLE email_auth_requests ADD COLUMN claim_token_hash TEXT');
    invalidatesLegacyEmailRequests = true;
  }
  if (!emailRequestColumns.has('confirmed_at')) {
    database.exec('ALTER TABLE email_auth_requests ADD COLUMN confirmed_at INTEGER');
    invalidatesLegacyEmailRequests = true;
  }
  if (!emailRequestColumns.has('replace_existing')) {
    database.exec('ALTER TABLE email_auth_requests ADD COLUMN replace_existing INTEGER NOT NULL DEFAULT 0');
  }
  database.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS email_auth_requests_claim_token ON email_auth_requests(claim_token_hash) WHERE claim_token_hash IS NOT NULL'
  );
  if (invalidatesLegacyEmailRequests) {
    database
      .prepare(
        `
        UPDATE email_auth_requests SET consumed_at = COALESCE(consumed_at, ?), delivery_status = 'superseded'
        WHERE claim_token_hash IS NULL AND consumed_at IS NULL
      `
      )
      .run(Date.now());
  }
  if (!database.prepare("SELECT 1 FROM schema_migrations WHERE name = 'account_canvas_catalog_v1'").get()) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
          CREATE TABLE canvas_catalog_account_v1 (
            board_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
            preview_webp BLOB,
            preview_version INTEGER NOT NULL DEFAULT 0 CHECK (preview_version >= 0),
            preview_style_version INTEGER NOT NULL DEFAULT 0 CHECK (preview_style_version >= 0),
            created_at INTEGER NOT NULL,
            owner_user_id TEXT REFERENCES user_accounts(id),
            visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private')),
            UNIQUE (owner_user_id, name),
            UNIQUE (owner_user_id, sort_order),
            FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
          ) STRICT;
          INSERT INTO canvas_catalog_account_v1
            (board_id, name, sort_order, preview_webp, preview_version, created_at, owner_user_id, visibility)
          SELECT board_id, name, sort_order, preview_webp, preview_version, created_at, owner_user_id, visibility
          FROM canvas_catalog;
          DROP TABLE canvas_catalog;
          ALTER TABLE canvas_catalog_account_v1 RENAME TO canvas_catalog;
        `);
      database
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run('account_canvas_catalog_v1', Date.now());
      database.exec('COMMIT');
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }
}

module.exports = { initializeAccountSchema };
