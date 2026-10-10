'use strict';

const { sha256, randomToken, normalizeEmail, httpError } = require('./account-helpers');

class EmailAuthService {
  constructor({
    database,
    cleanup,
    emailResendCooldownMs,
    emailHourlyLimit,
    emailLinkTtlMs,
    nextAccountIdentity,
    generateRecoveryCode,
    createRecoveryRecord,
    issueSession,
    sessionPayload,
    recordSecurityEvent
  }) {
    this.database = database;
    this.cleanup = cleanup;
    this.emailResendCooldownMs = emailResendCooldownMs;
    this.emailHourlyLimit = emailHourlyLimit;
    this.emailLinkTtlMs = emailLinkTtlMs;
    this.nextAccountIdentity = nextAccountIdentity;
    this.generateRecoveryCode = generateRecoveryCode;
    this.createRecoveryRecord = createRecoveryRecord;
    this.issueSession = issueSession;
    this.sessionPayload = sessionPayload;
    this.recordSecurityEvent = recordSecurityEvent;
  }

  emailForUser(userId) {
    const row = this.database
      .prepare(
        `
      SELECT subject, created_at FROM external_identities
      WHERE provider = 'email' AND user_id = ?
    `
      )
      .get(userId);
    return row ? { address: row.subject, verifiedAt: Number(row.created_at) } : null;
  }

  createEmailAuthRequest(emailInput, intentInput, requestedUserId = null, options = {}) {
    this.cleanup();
    const email = normalizeEmail(emailInput);
    const intent = ['login', 'register', 'bind'].includes(intentInput) ? intentInput : null;
    if (!intent) throw httpError(400, '邮箱认证方式无效', 'INVALID_EMAIL_INTENT');
    if (intent === 'bind' && !requestedUserId) throw httpError(401, '请先登录后再绑定邮箱', 'AUTH_REQUIRED');
    const now = Date.now();
    const latest = this.database
      .prepare(
        `
      SELECT created_at FROM email_auth_requests WHERE email = ? ORDER BY created_at DESC LIMIT 1
    `
      )
      .get(email);
    if (latest && Number(latest.created_at) > now - this.emailResendCooldownMs) {
      const retryAfter = Math.max(1, Math.ceil((Number(latest.created_at) + this.emailResendCooldownMs - now) / 1000));
      const error = httpError(429, `请等待 ${retryAfter} 秒后再发送`, 'EMAIL_COOLDOWN');
      error.retryAfter = retryAfter;
      throw error;
    }
    const hourlyCount = Number(
      this.database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM email_auth_requests WHERE email = ? AND created_at > ?
    `
        )
        .get(email, now - 60 * 60 * 1000).count
    );
    if (hourlyCount >= this.emailHourlyLimit) {
      throw httpError(429, '该邮箱的请求过于频繁，请稍后重试', 'EMAIL_RATE_LIMITED');
    }
    const id = randomToken(18);
    const token = randomToken(32);
    const claimToken = randomToken(32);
    const expiresAt = now + this.emailLinkTtlMs;
    this.database
      .prepare(
        `
      INSERT INTO email_auth_requests
        (id, token_hash, claim_token_hash, email, intent, requested_user_id, delivery_status, expires_at, created_at, replace_existing)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `
      )
      .run(
        id,
        sha256(token),
        sha256(claimToken),
        email,
        intent,
        requestedUserId,
        expiresAt,
        now,
        options.replaceExisting ? 1 : 0
      );
    return { requestId: id, token, claimToken, email, intent, expiresAt };
  }

  markEmailRequestSent(requestId, providerEmailId) {
    const now = Date.now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const request = this.database
        .prepare('SELECT email, intent FROM email_auth_requests WHERE id = ? AND consumed_at IS NULL')
        .get(requestId);
      if (!request) throw httpError(400, '邮箱认证请求已失效', 'EMAIL_LINK_EXPIRED');
      const result = this.database
        .prepare(
          `
        UPDATE email_auth_requests SET provider_email_id = ?, delivery_status = 'sent'
        WHERE id = ? AND consumed_at IS NULL
      `
        )
        .run(String(providerEmailId || ''), requestId);
      if (!result.changes) throw httpError(400, '邮箱认证请求已失效', 'EMAIL_LINK_EXPIRED');
      this.database
        .prepare(
          `
        UPDATE email_auth_requests SET consumed_at = ?, delivery_status = 'superseded'
        WHERE email = ? AND intent = ? AND id <> ? AND consumed_at IS NULL
      `
        )
        .run(now, request.email, request.intent, requestId);
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }

  markEmailRequestFailed(requestId) {
    this.database
      .prepare(
        `
      UPDATE email_auth_requests SET delivery_status = 'failed', consumed_at = ? WHERE id = ?
    `
      )
      .run(Date.now(), requestId);
  }

  confirmEmailAuthRequest(tokenInput, options = {}) {
    this.cleanup();
    const token = String(tokenInput || '').trim();
    if (!token) throw httpError(400, '邮箱链接无效或已过期', 'EMAIL_LINK_EXPIRED');
    const row = this.database
      .prepare(
        `
      SELECT * FROM email_auth_requests WHERE token_hash = ?
    `
      )
      .get(sha256(token));
    if (!row || row.consumed_at != null || Number(row.expires_at) <= Date.now() || row.delivery_status === 'failed') {
      throw httpError(400, '邮箱链接无效或已过期，请重新发送', 'EMAIL_LINK_EXPIRED');
    }
    const existing = this.database
      .prepare(
        `
      SELECT user_id FROM external_identities WHERE provider = 'email' AND subject = ?
    `
      )
      .get(row.email);
    if (row.intent === 'login' && !existing) {
      this.database.prepare('UPDATE email_auth_requests SET consumed_at = ? WHERE id = ?').run(Date.now(), row.id);
      throw httpError(404, '该邮箱尚未注册，请返回注册账号', 'EMAIL_REGISTRATION_REQUIRED');
    }
    const willCreateUser = row.intent === 'register' && !existing;
    if (willCreateUser && options.allowRegistration === false) {
      throw httpError(503, '新账号注册暂时关闭', 'REGISTRATION_DISABLED');
    }
    if (row.intent === 'bind' && existing && existing.user_id !== row.requested_user_id) {
      throw httpError(409, '该邮箱已绑定其他账号，无法自动合并', 'EMAIL_ALREADY_BOUND');
    }
    const confirmedAt = row.confirmed_at == null ? Date.now() : Number(row.confirmed_at);
    this.database
      .prepare(
        'UPDATE email_auth_requests SET confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ? AND consumed_at IS NULL'
      )
      .run(confirmedAt, row.id);
    return { body: { ok: true, status: 'confirmed', intent: row.intent } };
  }

  async claimEmailAuthRequest(
    requestIdInput,
    claimTokenInput,
    currentSession = null,
    confirmAccountSwitch = false,
    options = {}
  ) {
    this.cleanup();
    const requestId = String(requestIdInput || '').trim();
    const claimToken = String(claimTokenInput || '').trim();
    if (!requestId || !claimToken) throw httpError(400, '邮箱登录请求无效或已过期', 'EMAIL_CLAIM_EXPIRED');
    const row = this.database
      .prepare(
        `
      SELECT * FROM email_auth_requests WHERE id = ? AND claim_token_hash = ?
    `
      )
      .get(requestId, sha256(claimToken));
    if (!row || row.consumed_at != null || Number(row.expires_at) <= Date.now() || row.delivery_status === 'failed') {
      throw httpError(400, '邮箱登录请求无效或已过期，请重新发送', 'EMAIL_CLAIM_EXPIRED');
    }
    if (row.confirmed_at == null) return { status: 202, body: { ok: true, status: 'pending' } };

    const existing = this.database
      .prepare(
        `
      SELECT user_id FROM external_identities WHERE provider = 'email' AND subject = ?
    `
      )
      .get(row.email);
    if (row.intent === 'bind') {
      if (!currentSession || currentSession.userId !== row.requested_user_id) {
        throw httpError(401, '请在发起绑定的浏览器中完成操作', 'EMAIL_CLAIM_BROWSER_MISMATCH');
      }
      return this.consumeEmailBinding(row, existing);
    }
    if (row.intent === 'login' && !existing) {
      this.database.prepare('UPDATE email_auth_requests SET consumed_at = ? WHERE id = ?').run(Date.now(), row.id);
      throw httpError(404, '该邮箱尚未注册，请返回注册账号', 'EMAIL_REGISTRATION_REQUIRED');
    }

    const willCreateUser = row.intent === 'register' && !existing;
    if (willCreateUser && options.allowRegistration === false) {
      throw httpError(503, '新账号注册暂时关闭', 'REGISTRATION_DISABLED');
    }
    const targetUserId = existing?.user_id || null;
    if (
      currentSession &&
      (willCreateUser || (targetUserId && targetUserId !== currentSession.userId)) &&
      !confirmAccountSwitch
    ) {
      throw httpError(409, '当前浏览器已登录其他账号，请确认后再切换', 'ACCOUNT_SWITCH_CONFIRMATION_REQUIRED');
    }

    let newIdentity = null;
    let newRecovery = null;
    let recoveryCode = null;
    if (willCreateUser) {
      newIdentity = this.nextAccountIdentity();
      recoveryCode = this.generateRecoveryCode();
      newRecovery = await this.createRecoveryRecord(recoveryCode);
    }
    const now = Date.now();
    let userId = targetUserId;
    let session;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const consumed = this.database
        .prepare(
          `
        UPDATE email_auth_requests SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
      `
        )
        .run(now, row.id, now);
      if (!consumed.changes) throw httpError(400, '邮箱链接已被使用', 'EMAIL_LINK_EXPIRED');
      if (!userId) {
        this.database
          .prepare(
            `
          INSERT INTO user_accounts
            (id, account_id, username, avatar_asset_id, recovery_salt, recovery_hash, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
        `
          )
          .run(
            newIdentity.userId,
            newIdentity.accountId,
            newIdentity.username,
            newRecovery.salt,
            newRecovery.hash,
            now,
            now
          );
        this.database
          .prepare(
            `
          INSERT INTO external_identities (provider, subject, user_id, email, created_at, updated_at)
          VALUES ('email', ?, ?, ?, ?, ?)
        `
          )
          .run(row.email, newIdentity.userId, row.email, now, now);
        userId = newIdentity.userId;
      }
      if (currentSession && currentSession.userId !== userId) {
        this.database.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(currentSession.tokenHash);
      }
      session = this.issueSession(
        userId,
        willCreateUser ? 'account-created-with-email' : 'email-login',
        options.sessionClient
      );
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
    return {
      headers: { 'set-cookie': session.cookie },
      body: {
        ok: true,
        status: 'approved',
        intent: row.intent,
        created: willCreateUser,
        ...this.sessionPayload({ userId, ...session }),
        ...(recoveryCode ? { recoveryCode } : {})
      }
    };
  }

  consumeEmailBinding(row, existing) {
    const now = Date.now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const consumed = this.database
        .prepare(
          `
        UPDATE email_auth_requests SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
      `
        )
        .run(now, row.id, now);
      if (!consumed.changes) throw httpError(400, '邮箱链接已被使用', 'EMAIL_LINK_EXPIRED');
      if (existing && existing.user_id !== row.requested_user_id) {
        throw httpError(409, '该邮箱已绑定其他账号，无法自动合并', 'EMAIL_ALREADY_BOUND');
      }
      const current = this.emailForUser(row.requested_user_id);
      if (current && current.address !== row.email && !row.replace_existing) {
        throw httpError(409, '当前账号已绑定邮箱', 'EMAIL_ALREADY_CONFIGURED');
      }
      if (current && current.address !== row.email) {
        this.database
          .prepare("DELETE FROM external_identities WHERE provider = 'email' AND user_id = ?")
          .run(row.requested_user_id);
      }
      if (!existing) {
        this.database
          .prepare(
            `
          INSERT INTO external_identities (provider, subject, user_id, email, created_at, updated_at)
          VALUES ('email', ?, ?, ?, ?, ?)
        `
          )
          .run(row.email, row.requested_user_id, row.email, now, now);
      }
      if (!current) this.recordSecurityEvent(row.requested_user_id, 'email-bound');
      else if (current.address !== row.email) this.recordSecurityEvent(row.requested_user_id, 'email-changed');
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
    return { body: { ok: true, intent: 'bind', email: this.emailForUser(row.requested_user_id) } };
  }

  recordResendWebhook(eventIdInput, event) {
    const allowed = new Set([
      'email.sent',
      'email.delivered',
      'email.delivery_delayed',
      'email.failed',
      'email.bounced',
      'email.complained',
      'email.suppressed'
    ]);
    const eventId = String(eventIdInput || '').trim();
    const eventType = String(event?.type || '').trim();
    const providerEmailId = String(event?.data?.email_id || '').trim();
    if (!eventId || !allowed.has(eventType) || !providerEmailId) return { ignored: true };
    const parsedEventAt = Date.parse(event.created_at || event.data?.created_at || '');
    const eventAt = Number.isFinite(parsedEventAt) ? parsedEventAt : Date.now();
    const receivedAt = Date.now();
    const inserted = this.database
      .prepare(
        `
      INSERT OR IGNORE INTO resend_webhook_events
        (event_id, provider_email_id, event_type, event_at, received_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(eventId, providerEmailId, eventType, eventAt, receivedAt);
    if (!inserted.changes) return { duplicate: true };
    const status = eventType.slice('email.'.length);
    const updated = this.database
      .prepare(
        `
      UPDATE email_auth_requests
      SET delivery_status = ?, last_event_at = ?
      WHERE provider_email_id = ? AND (last_event_at IS NULL OR last_event_at <= ?)
    `
      )
      .run(status, eventAt, providerEmailId, eventAt);
    return { ok: true, matched: Boolean(updated.changes) };
  }
}

module.exports = { EmailAuthService };
