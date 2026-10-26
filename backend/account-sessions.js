'use strict';
const {
  SESSION_COOKIE,
  sha256,
  randomToken,
  httpError,
  parseCookies,
  serializeCookie,
  clearCookie
} = require('./account-helpers');

function createChallenge(account, purpose, challenge, userId, payload = {}) {
  const id = randomToken(24);
  const now = Date.now();
  account.database
    .prepare(
      `
      INSERT INTO auth_challenges (id, purpose, challenge, user_id, payload_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(id, purpose, challenge, userId || null, JSON.stringify(payload), now + account.challengeTtlMs, now);
  return id;
}

function consumeChallenge(account, id, purpose) {
  const row = account.database.prepare('SELECT * FROM auth_challenges WHERE id = ? AND purpose = ?').get(id, purpose);
  if (!row || Number(row.expires_at) <= Date.now()) {
    if (row) account.database.prepare('DELETE FROM auth_challenges WHERE id = ?').run(id);
    throw httpError(400, '认证请求已过期，请重试', 'AUTH_CHALLENGE_EXPIRED');
  }
  account.database.prepare('DELETE FROM auth_challenges WHERE id = ?').run(id);
  return { ...row, payload: JSON.parse(row.payload_json) };
}

function invalidateRecoveryChallenges(account, userId) {
  account.database.prepare("DELETE FROM auth_challenges WHERE purpose = 'recovery' AND user_id = ?").run(userId);
}

function issueSession(account, userId, eventType = 'session-created', client = {}) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const now = Date.now();
  const expiresAt = now + account.sessionTtlMs;
  const tokenHash = sha256(token);
  account.database
    .prepare(
      `
      INSERT INTO user_sessions
        (token_hash, user_id, csrf_token, system_name, app_name, device_class, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      tokenHash,
      userId,
      csrfToken,
      String(client.systemName || '未知系统').slice(0, 80),
      String(client.appName || '未知 APP').slice(0, 80),
      client.deviceClass === 'mobile' ? 'mobile' : 'desktop',
      expiresAt,
      now
    );
  account.database
    .prepare(
      `
      DELETE FROM user_sessions
      WHERE user_id = ? AND token_hash <> ? AND token_hash NOT IN (
        SELECT token_hash FROM user_sessions
        WHERE user_id = ? AND token_hash <> ?
        ORDER BY created_at DESC, token_hash DESC LIMIT ?
      )
    `
    )
    .run(userId, tokenHash, userId, tokenHash, Math.max(0, account.maxSessions - 1));
  account.recordSecurityEvent(userId, eventType);
  return {
    token,
    tokenHash,
    csrfToken,
    expiresAt,
    cookie: serializeCookie(token, Math.floor(account.sessionTtlMs / 1000))
  };
}

function readSession(account, req, options = {}) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = account.database
    .prepare(
      `
      SELECT s.token_hash, s.user_id, s.csrf_token, s.expires_at, s.created_at,
             u.account_id, u.username, u.avatar_asset_id
      FROM user_sessions AS s
      JOIN user_accounts AS u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `
    )
    .get(sha256(token));
  if (!row || Number(row.expires_at) <= Date.now()) return null;
  if (options.requireCsrf && req.headers['x-csrf-token'] !== row.csrf_token) {
    throw httpError(403, '请求验证失败，请刷新后重试', 'CSRF_INVALID');
  }
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    accountId: row.account_id,
    username: row.username,
    avatarAssetId: row.avatar_asset_id,
    csrfToken: row.csrf_token,
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at)
  };
}

function requireSession(account, req, options = {}) {
  const session = account.readSession(req, options);
  if (!session) throw httpError(401, '登录已过期，请重新登录', 'AUTH_EXPIRED');
  return session;
}

function recordSecurityEvent(account, userId, eventType, details = {}) {
  const now = Date.now();
  account.database
    .prepare(
      `
      INSERT INTO account_security_events (user_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, ?)
    `
    )
    .run(userId, eventType, JSON.stringify(details), now);
  account.database
    .prepare(
      `
      DELETE FROM account_security_events
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM account_security_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200
      )
    `
    )
    .run(userId, userId);
}

function listSecurityEvents(account, userId, limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  return account.database
    .prepare(
      `
      SELECT id, event_type, details_json, created_at
      FROM account_security_events WHERE user_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?
    `
    )
    .all(userId, safeLimit)
    .map((row) => ({
      id: String(row.id),
      type: row.event_type,
      details: JSON.parse(row.details_json || '{}'),
      createdAt: Number(row.created_at)
    }));
}

function listSessions(account, userId, currentTokenHash) {
  return account.database
    .prepare(
      `
      SELECT token_hash, system_name, app_name, device_class, created_at, expires_at FROM user_sessions
      WHERE user_id = ? ORDER BY created_at DESC
    `
    )
    .all(userId)
    .map((row) => ({
      id: row.token_hash,
      current: row.token_hash === currentTokenHash,
      systemName: row.system_name,
      appName: row.app_name,
      deviceClass: row.device_class,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at)
    }));
}

function revokeSession(account, userId, tokenHash, currentTokenHash) {
  if (!/^[a-f0-9]{64}$/.test(String(tokenHash || ''))) {
    throw httpError(404, '会话不存在', 'SESSION_NOT_FOUND');
  }
  const result = account.database
    .prepare('DELETE FROM user_sessions WHERE user_id = ? AND token_hash = ?')
    .run(userId, tokenHash);
  if (!result.changes) throw httpError(404, '会话不存在', 'SESSION_NOT_FOUND');
  const currentRevoked = tokenHash === currentTokenHash;
  if (!currentRevoked) account.recordSecurityEvent(userId, 'session-revoked');
  return { sessions: account.listSessions(userId, currentTokenHash), currentRevoked };
}

function revokeOtherSessions(account, userId, currentTokenHash) {
  const result = account.database
    .prepare('DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?')
    .run(userId, currentTokenHash);
  if (result.changes) account.recordSecurityEvent(userId, 'other-sessions-revoked', { count: Number(result.changes) });
  return { sessions: account.listSessions(userId, currentTokenHash), revoked: Number(result.changes) };
}

function logout(account, session) {
  if (session) account.database.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(session.tokenHash);
  return { headers: { 'set-cookie': clearCookie() }, body: { ok: true } };
}
module.exports = {
  createChallenge,
  consumeChallenge,
  invalidateRecoveryChallenges,
  issueSession,
  readSession,
  requireSession,
  recordSecurityEvent,
  listSecurityEvents,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  logout
};
