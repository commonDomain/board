import { XMindService } from '../xmind-service.js';
import { DatabaseSync } from 'node:sqlite';
import { AmapService } from '../amap-service.js';
import { AccountService } from '../account-service.js';
import { promoteSeededGuideRevisions } from './catalog.js';
import {AMAP_ACCOUNT_RATE_PER_MINUTE,AMAP_CACHE_LOCATE_MS,AMAP_CACHE_ROUTE_MS,AMAP_CACHE_SEARCH_MS,AMAP_CIRCUIT_OPEN_MS,AMAP_ENABLED,AMAP_FAILURE_THRESHOLD,AMAP_GLOBAL_QPS,AMAP_IP_RATE_PER_MINUTE,AMAP_JS_KEY,AMAP_JS_SECURITY_CODE,AMAP_MAX_CONCURRENCY,AMAP_MAX_NAV_ITEMS_PER_USER,AMAP_MAX_RESPONSE_BYTES,AMAP_QUOTAS,AMAP_QUOTA_TIMEZONE,AMAP_REQUEST_TIMEOUT_MS,AMAP_USAGE_HASH_SECRET,AMAP_WEB_SERVICE_KEY,AMAP_WEB_SERVICE_PRIVATE_KEY} from './amap-config.js';
import {AUTH_CHALLENGE_TTL_MS,DATABASE_FILE,DEVICE_PAIRING_TTL_MS,EMAIL_HOURLY_LIMIT,EMAIL_LINK_TTL_MS,EMAIL_REQUEST_RETENTION_MS,EMAIL_RESEND_COOLDOWN_MS,MAX_PASSKEYS_PER_ACCOUNT,MAX_SESSIONS_PER_ACCOUNT,PUBLIC_BASE_URL,RECENT_AUTH_TTL_MS,RESEND_EVENT_RETENTION_MS,SESSION_TTL_MS,SHARING_ENABLED,SHARING_MAX_MEMBERS,XMIND_MAX_RESPONSE_BYTES,XMIND_MCP_ENABLED,XMIND_REQUEST_TIMEOUT_MS,XMIND_TOKEN_ENCRYPTION_KEY,XMIND_TOKEN_ENCRYPTION_PREVIOUS_KEYS} from './config.js';
import {
  ensureCanvasPreviewSchema,
  migrateStoredDocuments,
  rebuildDerivedDataIfNeeded,
  repairDirtyDerivedIndexes,
  repairDuplicateXmindBoardLinks
} from './migrations.js';
import { initializeRuntimeRecoveryState, seedOperationReceipts } from './recovery.js';
import { servicesRuntime } from './runtime/services.js';
import { ensureNotebookSchema } from './notebooks.js';
import { retireCanvasNotebooks } from './legacy-note-cleanup.js';

function initializeDatabase() {
  servicesRuntime.database = new DatabaseSync(DATABASE_FILE);
  servicesRuntime.database.exec('PRAGMA journal_mode = WAL');
  servicesRuntime.database.exec('PRAGMA synchronous = FULL');
  servicesRuntime.database.exec('PRAGMA foreign_keys = ON');
  servicesRuntime.database.exec('PRAGMA busy_timeout = 5000');
  ensureNotebookSchema(servicesRuntime.database);
  servicesRuntime.database.exec(`CREATE TABLE IF NOT EXISTS connector_migration_archives (
    board_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, archived_at INTEGER NOT NULL
  ) STRICT`);
  servicesRuntime.database.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version = 2),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      state_json TEXT NOT NULL,
      saved_at TEXT,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS operations (
      board_id TEXT NOT NULL,
      op_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      canonical_op TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, op_id),
      UNIQUE (board_id, revision),
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS operations_board_revision
      ON operations(board_id, revision);
    CREATE TABLE IF NOT EXISTS operation_receipts (
      board_id TEXT NOT NULL,
      op_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      actor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, op_id),
      UNIQUE (board_id, revision),
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS operation_receipts_board_revision
      ON operation_receipts(board_id, revision);
    CREATE TABLE IF NOT EXISTS sheet_command_journal (
      board_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      op_id TEXT NOT NULL,
      canonical_op TEXT NOT NULL,
      checksum TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, revision),
      UNIQUE (board_id, op_id),
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sheet_command_journal_board_revision
      ON sheet_command_journal(board_id, revision);
    CREATE TABLE IF NOT EXISTS derived_index_dirty (
      board_id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS assets (
      asset_id TEXT PRIMARY KEY,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL,
      orphaned_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS asset_references (
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      ref_count INTEGER NOT NULL CHECK (ref_count > 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_type, owner_id, asset_id),
      FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS asset_references_asset_id
      ON asset_references(asset_id);
    CREATE TABLE IF NOT EXISTS runtime_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS canvas_catalog (
      board_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 0),
      preview_webp BLOB,
      preview_version INTEGER NOT NULL DEFAULT 0 CHECK (preview_version >= 0),
      preview_style_version INTEGER NOT NULL DEFAULT 0 CHECK (preview_style_version >= 0),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS state_v2_archives (
      board_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      archived_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS state_v3_archives (
      board_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      archived_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS state_v4_archives (
      board_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      archived_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS search_documents (
      board_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      content TEXT NOT NULL,
      target_id TEXT NOT NULL,
      section_id TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      PRIMARY KEY (board_id, document_id),
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS guest_import_receipts (
      user_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      imported_guest_ids TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, request_hash),
      FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS request_rate_limits (
      namespace TEXT NOT NULL,
      client_key_hash TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (namespace, client_key_hash, window_start)
    ) STRICT;
      CREATE INDEX IF NOT EXISTS request_rate_limits_updated ON request_rate_limits(updated_at);
      CREATE TABLE IF NOT EXISTS amap_component_registry (
        board_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        component_type TEXT NOT NULL CHECK (component_type IN ('amap-map', 'amap-search', 'amap-route')),
        creator_user_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (board_id, item_id),
        UNIQUE (board_id, component_type),
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS amap_component_registry_creator
        ON amap_component_registry(creator_user_id, component_type);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      content,
      label,
      board_id UNINDEXED,
      document_id UNINDEXED,
      kind UNINDEXED,
      target_id UNINDEXED,
      section_id UNINDEXED,
      x UNINDEXED,
      y UNINDEXED,
      tokenize='trigram'
    );
    CREATE TABLE IF NOT EXISTS spatial_entities (
      spatial_id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      UNIQUE (board_id, entity_type, entity_id),
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    ) STRICT;
    CREATE VIRTUAL TABLE IF NOT EXISTS board_bounds USING rtree(
      spatial_id,
      min_x, max_x,
      min_y, max_y
    );
  `);
  servicesRuntime.accountService = new AccountService(servicesRuntime.database, {
    publicBaseUrl: PUBLIC_BASE_URL.href,
    emailLinkTtlMs: EMAIL_LINK_TTL_MS,
    emailResendCooldownMs: EMAIL_RESEND_COOLDOWN_MS,
    emailHourlyLimit: EMAIL_HOURLY_LIMIT,
    emailRequestRetentionMs: EMAIL_REQUEST_RETENTION_MS,
    resendEventRetentionMs: RESEND_EVENT_RETENTION_MS,
    sessionTtlMs: SESSION_TTL_MS,
    challengeTtlMs: AUTH_CHALLENGE_TTL_MS,
    recentAuthTtlMs: RECENT_AUTH_TTL_MS,
    devicePairingTtlMs: DEVICE_PAIRING_TTL_MS,
    sharingMaxMembers: SHARING_MAX_MEMBERS,
    maxPasskeys: MAX_PASSKEYS_PER_ACCOUNT,
    maxSessions: MAX_SESSIONS_PER_ACCOUNT,
    sharingEnabled: SHARING_ENABLED
  });
  servicesRuntime.database.exec(`CREATE TABLE IF NOT EXISTS guide_canvases (
    user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
    board_id TEXT NOT NULL UNIQUE REFERENCES boards(id) ON DELETE CASCADE
  ) STRICT`);
  servicesRuntime.database.exec(`CREATE TABLE IF NOT EXISTS dismissed_guide_canvases (
    user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
    dismissed_at INTEGER NOT NULL
  ) STRICT`);
  servicesRuntime.amapService = new AmapService({
    database: servicesRuntime.database,
    config: {
      enabled: AMAP_ENABLED,
      jsKey: AMAP_JS_KEY,
      jsSecurityCode: AMAP_JS_SECURITY_CODE,
      webServiceKey: AMAP_WEB_SERVICE_KEY,
      webServicePrivateKey: AMAP_WEB_SERVICE_PRIVATE_KEY,
      usageHashSecret: AMAP_USAGE_HASH_SECRET,
      quotaTimeZone: AMAP_QUOTA_TIMEZONE,
      maxItemsPerUser: AMAP_MAX_NAV_ITEMS_PER_USER,
      requestTimeoutMs: AMAP_REQUEST_TIMEOUT_MS,
      maxResponseBytes: AMAP_MAX_RESPONSE_BYTES,
      maxConcurrency: AMAP_MAX_CONCURRENCY,
      accountRatePerMinute: AMAP_ACCOUNT_RATE_PER_MINUTE,
      ipRatePerMinute: AMAP_IP_RATE_PER_MINUTE,
      globalQps: AMAP_GLOBAL_QPS,
      failureThreshold: AMAP_FAILURE_THRESHOLD,
      circuitOpenMs: AMAP_CIRCUIT_OPEN_MS,
      cacheSearchMs: AMAP_CACHE_SEARCH_MS,
      cacheRouteMs: AMAP_CACHE_ROUTE_MS,
      cacheLocateMs: AMAP_CACHE_LOCATE_MS,
      quotas: AMAP_QUOTAS
    }
  });
  servicesRuntime.xmindService = new XMindService({
    database: servicesRuntime.database,
    enabled: XMIND_MCP_ENABLED,
    encryptionKey: XMIND_TOKEN_ENCRYPTION_KEY,
    previousEncryptionKeys: XMIND_TOKEN_ENCRYPTION_PREVIOUS_KEYS,
    publicBaseUrl: PUBLIC_BASE_URL.href,
    timeoutMs: XMIND_REQUEST_TIMEOUT_MS,
    maxResponseBytes: XMIND_MAX_RESPONSE_BYTES
  });
  repairDuplicateXmindBoardLinks();
  retireCanvasNotebooks(servicesRuntime.database);
  ensureCanvasPreviewSchema();
  const migratedDocuments = migrateStoredDocuments();
  promoteSeededGuideRevisions();
  initializeRuntimeRecoveryState();
  rebuildDerivedDataIfNeeded(migratedDocuments);
  repairDirtyDerivedIndexes();
  seedOperationReceipts();
}

export { initializeDatabase };
