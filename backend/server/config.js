import path from 'node:path';
import fs from 'node:fs';
import { URL } from 'node:url';
import { integerSetting, booleanSetting } from './environment-settings.js';

export const PLANNING_ENABLED = booleanSetting('PLANNING_ENABLED', false);

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const GUIDE_TEMPLATE = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'guide-template.json'), 'utf8'));

const GUIDE_SOURCE_BOARD_ID = 'canvas_7d0c40f96ff5446d8d2480cb98867eba';

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));

const ASSETS_DIR = path.join(DATA_DIR, 'assets');

const DATABASE_FILE = path.join(DATA_DIR, 'whiteboard.sqlite');

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

const LOGIN_LOG_DIR = path.resolve(process.env.LOGIN_LOG_DIR || path.join(DATA_DIR, 'logs'));

const PORT = integerSetting('PORT', 4000, { minimum: 0, maximum: 65535 });

const PUBLIC_BASE_URL = new URL(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}/`);

if (!PUBLIC_BASE_URL.pathname.endsWith('/')) PUBLIC_BASE_URL.pathname += '/';

PUBLIC_BASE_URL.search = '';

PUBLIC_BASE_URL.hash = '';

const HOST = process.env.HOST || '0.0.0.0';

const MAX_CLIENTS_PER_BOARD = integerSetting('MAX_CLIENTS_PER_BOARD', 25, {
  maximum: 1000
});

const MAX_WEBSOCKET_CLIENTS = integerSetting('MAX_WEBSOCKET_CLIENTS', 500, {
  maximum: 100_000
});

const MAX_ASSET_SIZE = integerSetting('MAX_ASSET_SIZE', 15 * 1024 * 1024);

const MAX_IMAGE_PIXELS = integerSetting('MAX_IMAGE_PIXELS', 80_000_000);

const MAX_AVATAR_SIZE = integerSetting('MAX_AVATAR_SIZE', 5 * 1024 * 1024, {
  minimum: 64 * 1024
});

const MAX_AVATAR_PIXELS = integerSetting('MAX_AVATAR_PIXELS', 20_000_000, {
  minimum: 256 * 256
});

const AVATAR_OUTPUT_SIZE = integerSetting('AVATAR_OUTPUT_SIZE', 256, {
  minimum: 64,
  maximum: 1024
});

const AVATAR_UPLOAD_RATE_LIMIT = integerSetting('AVATAR_UPLOAD_RATE_LIMIT', 6, {
  minimum: 1,
  maximum: 100
});

const AVATAR_UPLOAD_RATE_WINDOW_MS = integerSetting('AVATAR_UPLOAD_RATE_WINDOW_MS', 60_000, {
  minimum: 10_000,
  maximum: 60 * 60 * 1000
});

const IMAGE_PROCESSING_CONCURRENCY = integerSetting('IMAGE_PROCESSING_CONCURRENCY', 2, { minimum: 1, maximum: 16 });

const SESSION_READ_RATE_LIMIT = integerSetting('SESSION_READ_RATE_LIMIT', 120, {
  minimum: 10,
  maximum: 10_000
});

const SESSION_READ_RATE_WINDOW_MS = integerSetting('SESSION_READ_RATE_WINDOW_MS', 60_000, {
  minimum: 1000,
  maximum: 60 * 60 * 1000
});

const ACCOUNT_CLEANUP_INTERVAL_MS = integerSetting('ACCOUNT_CLEANUP_INTERVAL_MS', 60_000, {
  minimum: 10_000,
  maximum: 60 * 60 * 1000
});

const ASSET_GC_MIN_AGE_MS = integerSetting('ASSET_GC_MIN_AGE_MS', 7 * 24 * 60 * 60 * 1000, { minimum: 0 });

const ASSET_GC_INTERVAL_MS = integerSetting('ASSET_GC_INTERVAL_MS', 6 * 60 * 60 * 1000, { minimum: 60_000 });

const OP_RETENTION_MS = integerSetting('OP_RETENTION_MS', 30 * 24 * 60 * 60 * 1000, { minimum: 60_000 });

const OP_RECEIPT_LIMIT = integerSetting('OP_RECEIPT_LIMIT', 10_000, {
  minimum: 100
});

const MAINTENANCE_INTERVAL_MS = integerSetting('MAINTENANCE_INTERVAL_MS', 60 * 60 * 1000, { minimum: 60_000 });

const BACKUP_INTERVAL_MS = integerSetting('BACKUP_INTERVAL_MS', 24 * 60 * 60 * 1000, { minimum: 60_000 });

const BACKUP_RETENTION_COUNT = integerSetting('BACKUP_RETENTION_COUNT', 7, {
  minimum: 1,
  maximum: 100
});

const BACKUP_INITIAL_DELAY_MS = integerSetting('BACKUP_INITIAL_DELAY_MS', 5000, { minimum: 0, maximum: 60_000 });

const SNAPSHOT_CHUNK_THRESHOLD_BYTES = integerSetting('SNAPSHOT_CHUNK_THRESHOLD_BYTES', 4 * 1024 * 1024, {
  minimum: 256 * 1024
});

const SNAPSHOT_CHUNK_BYTES = integerSetting('SNAPSHOT_CHUNK_BYTES', 256 * 1024, {
  minimum: 64 * 1024,
  maximum: 1024 * 1024
});

const MAX_CANVASES = integerSetting('MAX_CANVASES', 10, {
  minimum: 1,
  maximum: 1000
});

const MAX_CANVAS_NAME_LENGTH = integerSetting('MAX_CANVAS_NAME_LENGTH', 30, {
  minimum: 1,
  maximum: 200
});

const MAX_PREVIEW_SIZE = integerSetting('MAX_PREVIEW_SIZE', 512 * 1024, {
  minimum: 16 * 1024
});

const CANVAS_PREVIEW_STYLE_VERSION = 4;

const MAX_BOARD_ITEMS = integerSetting('MAX_BOARD_ITEMS', 5000);

const MAX_STATE_BYTES = integerSetting('MAX_STATE_BYTES', 24 * 1024 * 1024);

const BOARD_CACHE_MAX_ENTRIES = integerSetting('BOARD_CACHE_MAX_ENTRIES', 100, {
  minimum: 1,
  maximum: 100_000
});

const BOARD_CACHE_MAX_BYTES = integerSetting('BOARD_CACHE_MAX_BYTES', 256 * 1024 * 1024, { minimum: MAX_STATE_BYTES });

const BOARD_CACHE_IDLE_MS = integerSetting('BOARD_CACHE_IDLE_MS', 15 * 60 * 1000, { minimum: 1000 });

const BOARD_CACHE_SWEEP_MS = integerSetting('BOARD_CACHE_SWEEP_MS', 60_000, {
  minimum: 1000
});

const MAX_MESSAGE_SIZE = integerSetting('MAX_MESSAGE_SIZE', Math.max(32 * 1024 * 1024, MAX_STATE_BYTES + 1024 * 1024));

const MAX_CLIENT_QUEUE_BYTES = integerSetting('MAX_CLIENT_QUEUE_BYTES', 32 * 1024 * 1024);

const MAX_CLIENT_INBOUND_QUEUE_BYTES = integerSetting(
  'MAX_CLIENT_INBOUND_QUEUE_BYTES',
  Math.max(MAX_MESSAGE_SIZE, 48 * 1024 * 1024),
  { minimum: MAX_MESSAGE_SIZE }
);

const MAX_CLIENT_INBOUND_MESSAGES = integerSetting('MAX_CLIENT_INBOUND_MESSAGES', 64, { minimum: 1, maximum: 10_000 });

const HEARTBEAT_INTERVAL_MS = integerSetting('HEARTBEAT_INTERVAL_MS', 30000, {
  minimum: 20
});

const JOIN_TIMEOUT_MS = integerSetting('JOIN_TIMEOUT_MS', 10000, {
  minimum: 50
});

const MAX_HTTP_CONNECTIONS = integerSetting('MAX_HTTP_CONNECTIONS', 1000, {
  maximum: 100_000
});

const MAX_REQUESTS_PER_SOCKET = integerSetting('MAX_REQUESTS_PER_SOCKET', 100, {
  maximum: 100_000
});

const HTTP_HEADERS_TIMEOUT_MS = integerSetting('HTTP_HEADERS_TIMEOUT_MS', 15_000, { minimum: 1000, maximum: 120_000 });

const HTTP_REQUEST_TIMEOUT_MS = integerSetting('HTTP_REQUEST_TIMEOUT_MS', 30_000, {
  minimum: HTTP_HEADERS_TIMEOUT_MS,
  maximum: 300_000
});

const HTTP_KEEP_ALIVE_TIMEOUT_MS = integerSetting('HTTP_KEEP_ALIVE_TIMEOUT_MS', 5000, {
  minimum: 1000,
  maximum: 120_000
});

const MAX_DATA_DIR_BYTES = integerSetting('MAX_DATA_DIR_BYTES', 20 * 1024 * 1024 * 1024, {
  minimum: 256 * 1024 * 1024
});

const MIN_FREE_DISK_BYTES = integerSetting('MIN_FREE_DISK_BYTES', 1024 * 1024 * 1024, { minimum: 0 });

const MAX_PROCESS_RSS_BYTES = integerSetting('MAX_PROCESS_RSS_BYTES', 768 * 1024 * 1024, {
  minimum: 128 * 1024 * 1024
});

const RESOURCE_MONITOR_INTERVAL_MS = integerSetting('RESOURCE_MONITOR_INTERVAL_MS', 60_000, {
  minimum: 1000,
  maximum: 300_000
});

const OPS_RATE_LIMIT = integerSetting('OPS_RATE_LIMIT', 30, { maximum: 10000 });

const SAVE_RATE_LIMIT = integerSetting('SAVE_RATE_LIMIT', 2, { maximum: 1000 });

const SEARCH_RATE_LIMIT = integerSetting('SEARCH_RATE_LIMIT', 100, {
  minimum: 1
});

const SEARCH_RATE_WINDOW_MS = integerSetting('SEARCH_RATE_WINDOW_MS', 10_000, {
  minimum: 1000,
  maximum: 60 * 60 * 1000
});

const ASSET_UPLOAD_RATE_LIMIT = integerSetting('ASSET_UPLOAD_RATE_LIMIT', 30, {
  minimum: 1
});

const ASSET_UPLOAD_RATE_WINDOW_MS = integerSetting('ASSET_UPLOAD_RATE_WINDOW_MS', 60_000, {
  minimum: 1000,
  maximum: 60 * 60 * 1000
});

const API_WRITE_RATE_LIMIT = integerSetting('API_WRITE_RATE_LIMIT', 300, {
  minimum: 10,
  maximum: 10000
});

const API_WRITE_RATE_WINDOW_MS = integerSetting('API_WRITE_RATE_WINDOW_MS', 60_000, {
  minimum: 1000,
  maximum: 60 * 60 * 1000
});

const AUTH_RATE_LIMIT = integerSetting('AUTH_RATE_LIMIT', 30, {
  minimum: 5,
  maximum: 1000
});

const AUTH_RATE_WINDOW_MS = integerSetting('AUTH_RATE_WINDOW_MS', 10 * 60_000, {
  minimum: 10_000,
  maximum: 24 * 60 * 60 * 1000
});

const EMAIL_LINK_TTL_MS = integerSetting('EMAIL_LINK_TTL_MS', 15 * 60 * 1000, {
  minimum: 60_000,
  maximum: 60 * 60 * 1000
});

const EMAIL_RESEND_COOLDOWN_MS = integerSetting('EMAIL_RESEND_COOLDOWN_MS', 60_000, {
  minimum: 10_000,
  maximum: 60 * 60 * 1000
});

const EMAIL_HOURLY_LIMIT = integerSetting('EMAIL_HOURLY_LIMIT', 5, {
  minimum: 1,
  maximum: 100
});

const EMAIL_REQUEST_RETENTION_MS = integerSetting('EMAIL_REQUEST_RETENTION_MS', 24 * 60 * 60 * 1000, {
  minimum: 60 * 60 * 1000
});

const RESEND_EVENT_RETENTION_MS = integerSetting('RESEND_EVENT_RETENTION_MS', 30 * 24 * 60 * 60 * 1000, {
  minimum: 24 * 60 * 60 * 1000
});

const SESSION_TTL_MS = integerSetting('SESSION_TTL_MS', 14 * 24 * 60 * 60 * 1000, {
  minimum: 60 * 60 * 1000,
  maximum: 90 * 24 * 60 * 60 * 1000
});

const AUTH_CHALLENGE_TTL_MS = integerSetting('AUTH_CHALLENGE_TTL_MS', 10 * 60 * 1000, {
  minimum: 60_000,
  maximum: 60 * 60 * 1000
});

const RECENT_AUTH_TTL_MS = integerSetting('RECENT_AUTH_TTL_MS', 5 * 60 * 1000, {
  minimum: 60_000,
  maximum: 15 * 60 * 1000
});

const DEVICE_PAIRING_TTL_MS = integerSetting('DEVICE_PAIRING_TTL_MS', 5 * 60 * 1000, {
  minimum: 60_000,
  maximum: 30 * 60 * 1000
});

const SHARING_MAX_MEMBERS = integerSetting('SHARING_MAX_MEMBERS', 5, {
  minimum: 2,
  maximum: 100
});

const ASSET_UPLOAD_CONCURRENCY = integerSetting('ASSET_UPLOAD_CONCURRENCY', 4, {
  minimum: 1,
  maximum: 64
});

const ASSET_UPLOAD_GRANT_TTL_MS = integerSetting('ASSET_UPLOAD_GRANT_TTL_MS', 10 * 60 * 1000, {
  minimum: 60_000,
  maximum: 24 * 60 * 60 * 1000
});

const HSTS_MAX_AGE_SECONDS = integerSetting('HSTS_MAX_AGE_SECONDS', 0, {
  minimum: 0,
  maximum: 63072000
});

const HTTPS_ONLY_ENABLED = booleanSetting('HTTPS_ONLY_ENABLED', true);

const JS_MINIFY_ENABLED = booleanSetting('JS_MINIFY_ENABLED', true);

const API_PAYLOAD_ENCRYPTION_ENABLED = booleanSetting('API_PAYLOAD_ENCRYPTION_ENABLED', false);

const API_PAYLOAD_ENCRYPTION_KEY = String(process.env.API_PAYLOAD_ENCRYPTION_KEY || '').trim();

const API_PAYLOAD_ENCRYPTION_SESSION_TTL_MS = integerSetting('API_PAYLOAD_ENCRYPTION_SESSION_TTL_MS', 10 * 60_000, {
  minimum: 60_000,
  maximum: 24 * 60 * 60 * 1000
});

const API_PAYLOAD_ENCRYPTION_MAX_SESSIONS = integerSetting('API_PAYLOAD_ENCRYPTION_MAX_SESSIONS', 10_000, {
  minimum: 100,
  maximum: 1_000_000
});

const API_PAYLOAD_ENCRYPTION_CLOCK_SKEW_MS = integerSetting('API_PAYLOAD_ENCRYPTION_CLOCK_SKEW_MS', 60_000, {
  minimum: 10_000,
  maximum: 10 * 60_000
});

const MAX_ENCRYPTED_API_PAYLOAD = integerSetting('MAX_ENCRYPTED_API_PAYLOAD', 96 * 1024 * 1024, {
  minimum: 1024 * 1024,
  maximum: 512 * 1024 * 1024
});

const SHUTDOWN_GRACE_MS = integerSetting('SHUTDOWN_GRACE_MS', 10_000, {
  minimum: 1000,
  maximum: 5 * 60 * 1000
});

const PRIVACY_LOCK_IDLE_MS = integerSetting('PRIVACY_LOCK_IDLE_MS', 15 * 60 * 1000, {
  minimum: 60_000,
  maximum: 24 * 60 * 60 * 1000
});

const RESEND_MAX_ATTEMPTS = integerSetting('RESEND_MAX_ATTEMPTS', 3, {
  minimum: 1,
  maximum: 5
});

const RESEND_RETRY_BASE_MS = integerSetting('RESEND_RETRY_BASE_MS', 350, {
  minimum: 100,
  maximum: 5000
});

const RESEND_REQUEST_TIMEOUT_MS = integerSetting('RESEND_REQUEST_TIMEOUT_MS', 10_000, {
  minimum: 1000,
  maximum: 60_000
});

const MAX_PASSKEYS_PER_ACCOUNT = integerSetting('MAX_PASSKEYS_PER_ACCOUNT', 10, { minimum: 1, maximum: 100 });

const MAX_SESSIONS_PER_ACCOUNT = integerSetting('MAX_SESSIONS_PER_ACCOUNT', 20, { minimum: 1, maximum: 200 });

const MAX_BATCH_OPERATIONS = MAX_BOARD_ITEMS;

const DOCUMENT_VERSION = 5;

const DERIVED_DATA_VERSION = `document-${DOCUMENT_VERSION}-search-3-amap-1-assets-1`;

const MAX_SECTIONS = integerSetting('MAX_SECTIONS', 500, {
  minimum: 1,
  maximum: 10_000
});

const MAX_GROUPS = integerSetting('MAX_GROUPS', 1000, {
  minimum: 1,
  maximum: 20_000
});

const MAX_GROUP_DEPTH = integerSetting('MAX_GROUP_DEPTH', 16, {
  minimum: 1,
  maximum: 100
});

const SEARCH_RESULT_LIMIT = integerSetting('SEARCH_RESULT_LIMIT', 50, {
  minimum: 1,
  maximum: 500
});

const WALLPAPER_DRIFT_ENABLED = booleanSetting('WALLPAPER_DRIFT_ENABLED', true);

const WALLPAPER_DRIFT_PARALLAX = integerSetting('WALLPAPER_DRIFT_PARALLAX', 50, { minimum: 0, maximum: 100 });

const EMAIL_AUTH_ENABLED = booleanSetting('EMAIL_AUTH_ENABLED', false);

const PASSKEY_AUTH_ENABLED = booleanSetting('PASSKEY_AUTH_ENABLED', true);

const REGISTRATION_ENABLED = booleanSetting('REGISTRATION_ENABLED', true);

const GUEST_MODE_ENABLED = booleanSetting('GUEST_MODE_ENABLED', true);

const SHARING_ENABLED = booleanSetting('SHARING_ENABLED', true);

const AUTOMATIC_BACKUPS_ENABLED = booleanSetting('AUTOMATIC_BACKUPS_ENABLED', true);

const ASSET_GC_ENABLED = booleanSetting('ASSET_GC_ENABLED', true);

const OPERATION_MAINTENANCE_ENABLED = booleanSetting('OPERATION_MAINTENANCE_ENABLED', true);

const XMIND_MCP_ENABLED = booleanSetting('XMIND_MCP_ENABLED', false);

const XMIND_TOKEN_ENCRYPTION_KEY = String(process.env.XMIND_TOKEN_ENCRYPTION_KEY || '').trim();

const XMIND_TOKEN_ENCRYPTION_PREVIOUS_KEYS = String(process.env.XMIND_TOKEN_ENCRYPTION_PREVIOUS_KEYS || '').trim();

const LOGIN_LOG_TIMEZONE = String(process.env.LOGIN_LOG_TIMEZONE || 'Asia/Shanghai').trim();

const XMIND_REQUEST_TIMEOUT_MS = integerSetting('XMIND_REQUEST_TIMEOUT_MS', 15_000, { minimum: 1000, maximum: 60_000 });

const XMIND_MAX_RESPONSE_BYTES = integerSetting('XMIND_MAX_RESPONSE_BYTES', 4 * 1024 * 1024, {
  minimum: 64 * 1024,
  maximum: 16 * 1024 * 1024
});

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();

const RESEND_FROM = String(process.env.RESEND_FROM || '').trim();

const RESEND_REPLY_TO = String(process.env.RESEND_REPLY_TO || '').trim();

const RESEND_WEBHOOK_SECRET = String(process.env.RESEND_WEBHOOK_SECRET || '').trim();

if (EMAIL_AUTH_ENABLED && (!RESEND_API_KEY || !RESEND_FROM || !RESEND_WEBHOOK_SECRET)) {
  throw new Error('EMAIL_AUTH_ENABLED requires RESEND_API_KEY, RESEND_FROM, and RESEND_WEBHOOK_SECRET');
}

const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS ?? PUBLIC_BASE_URL.origin)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const TRUSTED_PROXY_IPS = new Set(
  String(process.env.TRUSTED_PROXY_IPS ?? '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
);

for (const origin of ALLOWED_ORIGINS) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error(`ALLOWED_ORIGINS entries must be exact HTTP(S) origins without paths: ${origin}`);
  }
}
export {
  ROOT_DIR,
  PUBLIC_DIR,
  GUIDE_TEMPLATE,
  GUIDE_SOURCE_BOARD_ID,
  DATA_DIR,
  ASSETS_DIR,
  DATABASE_FILE,
  BACKUPS_DIR,
  LOGIN_LOG_DIR,
  PUBLIC_BASE_URL,
  PORT,
  HOST,
  MAX_CLIENTS_PER_BOARD,
  MAX_WEBSOCKET_CLIENTS,
  MAX_ASSET_SIZE,
  MAX_IMAGE_PIXELS,
  MAX_AVATAR_SIZE,
  MAX_AVATAR_PIXELS,
  AVATAR_OUTPUT_SIZE,
  AVATAR_UPLOAD_RATE_LIMIT,
  AVATAR_UPLOAD_RATE_WINDOW_MS,
  IMAGE_PROCESSING_CONCURRENCY,
  SESSION_READ_RATE_LIMIT,
  SESSION_READ_RATE_WINDOW_MS,
  ACCOUNT_CLEANUP_INTERVAL_MS,
  ASSET_GC_MIN_AGE_MS,
  ASSET_GC_INTERVAL_MS,
  OP_RETENTION_MS,
  OP_RECEIPT_LIMIT,
  MAINTENANCE_INTERVAL_MS,
  BACKUP_INTERVAL_MS,
  BACKUP_RETENTION_COUNT,
  BACKUP_INITIAL_DELAY_MS,
  SNAPSHOT_CHUNK_THRESHOLD_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  MAX_CANVASES,
  MAX_CANVAS_NAME_LENGTH,
  MAX_PREVIEW_SIZE,
  CANVAS_PREVIEW_STYLE_VERSION,
  MAX_BOARD_ITEMS,
  MAX_STATE_BYTES,
  BOARD_CACHE_MAX_ENTRIES,
  BOARD_CACHE_MAX_BYTES,
  BOARD_CACHE_IDLE_MS,
  BOARD_CACHE_SWEEP_MS,
  MAX_MESSAGE_SIZE,
  MAX_CLIENT_QUEUE_BYTES,
  MAX_CLIENT_INBOUND_QUEUE_BYTES,
  MAX_CLIENT_INBOUND_MESSAGES,
  HEARTBEAT_INTERVAL_MS,
  JOIN_TIMEOUT_MS,
  MAX_HTTP_CONNECTIONS,
  MAX_REQUESTS_PER_SOCKET,
  HTTP_HEADERS_TIMEOUT_MS,
  HTTP_REQUEST_TIMEOUT_MS,
  HTTP_KEEP_ALIVE_TIMEOUT_MS,
  MAX_DATA_DIR_BYTES,
  MIN_FREE_DISK_BYTES,
  MAX_PROCESS_RSS_BYTES,
  RESOURCE_MONITOR_INTERVAL_MS,
  OPS_RATE_LIMIT,
  SAVE_RATE_LIMIT,
  SEARCH_RATE_LIMIT,
  SEARCH_RATE_WINDOW_MS,
  ASSET_UPLOAD_RATE_LIMIT,
  ASSET_UPLOAD_RATE_WINDOW_MS,
  API_WRITE_RATE_LIMIT,
  API_WRITE_RATE_WINDOW_MS,
  AUTH_RATE_LIMIT,
  AUTH_RATE_WINDOW_MS,
  EMAIL_LINK_TTL_MS,
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_HOURLY_LIMIT,
  EMAIL_REQUEST_RETENTION_MS,
  RESEND_EVENT_RETENTION_MS,
  SESSION_TTL_MS,
  AUTH_CHALLENGE_TTL_MS,
  RECENT_AUTH_TTL_MS,
  DEVICE_PAIRING_TTL_MS,
  SHARING_MAX_MEMBERS,
  ASSET_UPLOAD_CONCURRENCY,
  ASSET_UPLOAD_GRANT_TTL_MS,
  HSTS_MAX_AGE_SECONDS,
  HTTPS_ONLY_ENABLED,
  JS_MINIFY_ENABLED,
  API_PAYLOAD_ENCRYPTION_ENABLED,
  API_PAYLOAD_ENCRYPTION_KEY,
  API_PAYLOAD_ENCRYPTION_SESSION_TTL_MS,
  API_PAYLOAD_ENCRYPTION_MAX_SESSIONS,
  API_PAYLOAD_ENCRYPTION_CLOCK_SKEW_MS,
  MAX_ENCRYPTED_API_PAYLOAD,
  SHUTDOWN_GRACE_MS,
  PRIVACY_LOCK_IDLE_MS,
  RESEND_MAX_ATTEMPTS,
  RESEND_RETRY_BASE_MS,
  RESEND_REQUEST_TIMEOUT_MS,
  MAX_PASSKEYS_PER_ACCOUNT,
  MAX_SESSIONS_PER_ACCOUNT,
  MAX_BATCH_OPERATIONS,
  DOCUMENT_VERSION,
  DERIVED_DATA_VERSION,
  MAX_SECTIONS,
  MAX_GROUPS,
  MAX_GROUP_DEPTH,
  SEARCH_RESULT_LIMIT,
  WALLPAPER_DRIFT_ENABLED,
  WALLPAPER_DRIFT_PARALLAX,
  EMAIL_AUTH_ENABLED,
  PASSKEY_AUTH_ENABLED,
  REGISTRATION_ENABLED,
  GUEST_MODE_ENABLED,
  SHARING_ENABLED,
  AUTOMATIC_BACKUPS_ENABLED,
  ASSET_GC_ENABLED,
  OPERATION_MAINTENANCE_ENABLED,
  XMIND_MCP_ENABLED,
  XMIND_TOKEN_ENCRYPTION_KEY,
  XMIND_TOKEN_ENCRYPTION_PREVIOUS_KEYS,
  LOGIN_LOG_TIMEZONE,
  XMIND_REQUEST_TIMEOUT_MS,
  XMIND_MAX_RESPONSE_BYTES,
  RESEND_API_KEY,
  RESEND_FROM,
  RESEND_REPLY_TO,
  RESEND_WEBHOOK_SECRET,
  ALLOWED_ORIGINS,
  TRUSTED_PROXY_IPS
};
