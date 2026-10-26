import { servicesRuntime } from './runtime/services.js';
import { requireCatalogBoardId } from './catalog-access.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { createMemoryRateLimiter } from './rate-limits.js';
import { DEFAULT_THEME, isThemeId, normalizeTheme } from '../../public/app/theme-model.js';

// Interface themes are personal: each account keeps a default and an optional
// choice per canvas. They never enter canvas documents, history or sync.
const reads = createMemoryRateLimiter(120, 60000);
const writes = createMemoryRateLimiter(120, 60000);
const schemaReady = new WeakSet();
const statements = new WeakMap();

function fail(statusCode, message, code = 'THEME_INVALID') {
  throw Object.assign(new Error(message), { statusCode, code });
}

export function ensureThemePreferenceSchema(db) {
  if (schemaReady.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS user_theme_defaults (
    user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
    theme TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS user_canvas_themes (
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    theme TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, board_id)
  ) STRICT;`);
  schemaReady.add(db);
}

function statement(db, sql) {
  let cache = statements.get(db);
  if (!cache) { cache = new Map(); statements.set(db, cache); }
  let prepared = cache.get(sql);
  if (!prepared) { prepared = db.prepare(sql); cache.set(sql, prepared); }
  return prepared;
}

export function readThemePreferences(db, account, userId) {
  ensureThemePreferenceSchema(db);
  const fallback = normalizeTheme(statement(db, 'SELECT theme FROM user_theme_defaults WHERE user_id=?').get(userId)?.theme, null);
  const canvases = {};
  for (const row of statement(db, 'SELECT board_id, theme FROM user_canvas_themes WHERE user_id=?').all(userId)) {
    const theme = normalizeTheme(row.theme, null);
    if (theme && account.canAccessBoard(userId, row.board_id)) canvases[row.board_id] = theme;
  }
  return { default: fallback || DEFAULT_THEME, canvases };
}

function requireTheme(value, allowNull = false) {
  if (allowNull && value === null) return null;
  if (!isThemeId(value)) fail(400, '未知的主题');
  return value;
}

export async function handleThemeApi(req, res, url) {
  const match = url.pathname.match(/^\/api\/themes(?:\/(default|canvases)(?:\/([^/]+))?)?$/);
  if (!match) return false;
  const account = servicesRuntime.accountService, db = servicesRuntime.database;
  const session = account.requireSession(req, { requireCsrf: req.method !== 'GET' });
  if (!session?.userId) fail(401, '登录后才能保存主题', 'AUTH_REQUIRED');
  const userId = session.userId;
  if (req.method === 'GET' && !match[1]) {
    if (!reads(userId)) fail(429, '读取过于频繁，请稍后重试', 'THEME_LIMITED');
    sendJson(res, 200, readThemePreferences(db, account, userId));
    return true;
  }
  if (req.method !== 'PUT') fail(405, '不支持的操作');
  if (!writes(userId)) fail(429, '操作过于频繁，请稍后重试', 'THEME_LIMITED');
  const input = await readJsonBody(req, 1024);
  // Revalidate after the body arrives: the session may have ended meanwhile.
  account.requireSession(req, { requireCsrf: true });
  ensureThemePreferenceSchema(db);
  const now = Date.now();
  if (match[1] === 'default' && !match[2]) {
    const theme = requireTheme(input?.theme);
    statement(db, `INSERT INTO user_theme_defaults VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme, updated_at=excluded.updated_at`).run(userId, theme, now);
  } else if (match[1] === 'canvases' && match[2]) {
    let raw;
    try { raw = decodeURIComponent(match[2]); } catch { fail(400, '画布标识无效'); }
    const boardId = requireCatalogBoardId(raw, userId);
    const theme = requireTheme(input?.theme ?? null, true);
    if (theme === null) statement(db, 'DELETE FROM user_canvas_themes WHERE user_id=? AND board_id=?').run(userId, boardId);
    else statement(db, `INSERT INTO user_canvas_themes VALUES (?,?,?,?)
      ON CONFLICT(user_id, board_id) DO UPDATE SET theme=excluded.theme, updated_at=excluded.updated_at`).run(userId, boardId, theme, now);
  } else {
    fail(404, '接口不存在', 'NOT_FOUND');
  }
  sendJson(res, 200, readThemePreferences(db, account, userId));
  return true;
}
