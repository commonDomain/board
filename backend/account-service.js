'use strict';
const crypto = require('node:crypto');
const {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  CHALLENGE_TTL_MS,
  EMAIL_LINK_TTL_MS,
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_HOURLY_LIMIT,
  EMAIL_REQUEST_RETENTION_MS,
  RESEND_EVENT_RETENTION_MS,
  DEVICE_PAIRING_TTL_MS,
  MAX_PASSKEYS_PER_ACCOUNT,
  MAX_SESSIONS_PER_ACCOUNT,
  RECENT_AUTH_TTL_MS,
  randomCrockford,
  grouped,
  normalizeUsername,
  normalizeEmail,
  recoveryHash,
  httpError,
  clearCookie,
  sessionClientFromRequest
} = require('./account-helpers');
const { initializeAccountSchema } = require('./account-schema');
const { EmailAuthService } = require('./account-email');
const {
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
} = require('./account-sessions');
const {
  startDevicePairing,
  inspectDevicePairing,
  approveDevicePairing,
  cancelDevicePairing,
  claimDevicePairing
} = require('./account-pairing');
const {
  listPasskeys,
  renamePasskey,
  beginRegistration,
  finishRegistration,
  insertCredential,
  beginLogin,
  credentialForVerification,
  updateCredentialCounter,
  finishLogin,
  beginAddPasskey,
  finishAddPasskey
} = require('./account-passkeys');
const {
  verifyRecovery,
  verifyUserRecovery,
  removeEmail,
  authorizeAccountDeletion,
  deleteAccount,
  beginRecovery,
  finishRecovery,
  issueRecentAuth,
  consumeRecentAuth,
  authorizeWithRecovery,
  beginSensitiveAction,
  finishSensitiveAction
} = require('./account-recovery');
const {
  groupForUser,
  getSharing,
  regenerateInviteCode,
  joinGroup,
  removeMember,
  leaveGroup,
  visibleOwnerIds,
  canAccessBoard,
  canReferenceAsset,
  canManageBoard
} = require('./account-sharing');

class AccountService {
  constructor(database, options = {}) {
    this.database = database;
    this.rpName = options.rpName || process.env.PASSKEY_RP_NAME || 'Muse Board';
    const publicBaseUrl = options.publicBaseUrl || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}/`;
    this.rpID = options.rpID || process.env.PASSKEY_RP_ID || new URL(publicBaseUrl).hostname;
    this.publicBaseUrl = new URL(publicBaseUrl).href;
    this.expectedOrigin =
      options.expectedOrigin || process.env.PASSKEY_EXPECTED_ORIGIN || new URL(publicBaseUrl).origin;
    this.emailLinkTtlMs = Number(options.emailLinkTtlMs || process.env.EMAIL_LINK_TTL_MS || EMAIL_LINK_TTL_MS);
    this.emailResendCooldownMs = Number(
      options.emailResendCooldownMs || process.env.EMAIL_RESEND_COOLDOWN_MS || EMAIL_RESEND_COOLDOWN_MS
    );
    this.emailHourlyLimit = Number(options.emailHourlyLimit || process.env.EMAIL_HOURLY_LIMIT || EMAIL_HOURLY_LIMIT);
    this.emailRequestRetentionMs = Number(
      options.emailRequestRetentionMs || process.env.EMAIL_REQUEST_RETENTION_MS || EMAIL_REQUEST_RETENTION_MS
    );
    this.resendEventRetentionMs = Number(
      options.resendEventRetentionMs || process.env.RESEND_EVENT_RETENTION_MS || RESEND_EVENT_RETENTION_MS
    );
    this.sessionTtlMs = Number(options.sessionTtlMs || process.env.SESSION_TTL_MS || SESSION_TTL_MS);
    this.challengeTtlMs = Number(options.challengeTtlMs || process.env.AUTH_CHALLENGE_TTL_MS || CHALLENGE_TTL_MS);
    this.devicePairingTtlMs = Number(
      options.devicePairingTtlMs || process.env.DEVICE_PAIRING_TTL_MS || DEVICE_PAIRING_TTL_MS
    );
    this.sharingMaxMembers = Number(options.sharingMaxMembers || process.env.SHARING_MAX_MEMBERS || 5);
    this.maxPasskeys = Number(options.maxPasskeys || process.env.MAX_PASSKEYS_PER_ACCOUNT || MAX_PASSKEYS_PER_ACCOUNT);
    this.maxSessions = Number(options.maxSessions || process.env.MAX_SESSIONS_PER_ACCOUNT || MAX_SESSIONS_PER_ACCOUNT);
    this.recentAuthTtlMs = Number(options.recentAuthTtlMs || process.env.RECENT_AUTH_TTL_MS || RECENT_AUTH_TTL_MS);
    this.sharingEnabled = options.sharingEnabled !== false;
    const expectedOriginUrl = new URL(this.expectedOrigin);
    if (expectedOriginUrl.origin !== this.expectedOrigin || !['http:', 'https:'].includes(expectedOriginUrl.protocol)) {
      throw new Error('PASSKEY_EXPECTED_ORIGIN must be an exact HTTP(S) origin without a path.');
    }
    if (expectedOriginUrl.hostname !== this.rpID && !expectedOriginUrl.hostname.endsWith(`.${this.rpID}`)) {
      throw new Error('PASSKEY_RP_ID must equal or be a registrable suffix of PASSKEY_EXPECTED_ORIGIN.');
    }
    this.emailAuth = new EmailAuthService({
      database: this.database,
      cleanup: (...args) => this.cleanup(...args),
      emailResendCooldownMs: this.emailResendCooldownMs,
      emailHourlyLimit: this.emailHourlyLimit,
      emailLinkTtlMs: this.emailLinkTtlMs,
      nextAccountIdentity: (...args) => this.nextAccountIdentity(...args),
      generateRecoveryCode: (...args) => this.generateRecoveryCode(...args),
      createRecoveryRecord: (...args) => this.createRecoveryRecord(...args),
      issueSession: (...args) => this.issueSession(...args),
      sessionPayload: (...args) => this.sessionPayload(...args),
      recordSecurityEvent: (...args) => this.recordSecurityEvent(...args)
    });
    this.initializeSchema();
  }

  initializeSchema() {
    initializeAccountSchema(this.database);
  }

  cleanup() {
    const now = Date.now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(now);
      this.database.prepare('DELETE FROM recent_auth_grants WHERE expires_at <= ?').run(now);
      this.database.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(now);
      this.database.prepare('DELETE FROM asset_upload_grants WHERE expires_at <= ?').run(now);
      this.database.prepare('DELETE FROM device_pairings WHERE expires_at <= ?').run(now);
      this.database
        .prepare('DELETE FROM email_auth_requests WHERE created_at <= ?')
        .run(now - this.emailRequestRetentionMs);
      this.database
        .prepare('DELETE FROM resend_webhook_events WHERE received_at <= ?')
        .run(now - this.resendEventRetentionMs);
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }

  nextAccountIdentity() {
    let compact;
    let accountId;
    do {
      compact = randomCrockford(12);
      accountId = `MB-${grouped(compact)}`;
    } while (this.database.prepare('SELECT 1 FROM user_accounts WHERE account_id = ?').get(accountId));
    return {
      userId: crypto.randomUUID(),
      accountId,
      username: `用户-${compact.slice(-6)}`
    };
  }

  generateRecoveryCode() {
    return grouped(randomCrockford(16));
  }

  async createRecoveryRecord(code) {
    const salt = crypto.randomBytes(16).toString('hex');
    return { salt, hash: await recoveryHash(code, salt) };
  }

  createChallenge(purpose, challenge, userId, payload = {}) {
    return createChallenge(this, purpose, challenge, userId, payload);
  }

  consumeChallenge(id, purpose) {
    return consumeChallenge(this, id, purpose);
  }

  invalidateRecoveryChallenges(userId) {
    return invalidateRecoveryChallenges(this, userId);
  }

  issueSession(userId, eventType = 'session-created', client = {}) {
    return issueSession(this, userId, eventType, client);
  }

  readSession(req, options = {}) {
    return readSession(this, req, options);
  }

  requireSession(req, options = {}) {
    return requireSession(this, req, options);
  }

  publicUser(userId) {
    const user = this.database
      .prepare(
        `
      SELECT id, account_id, username, avatar_asset_id, created_at
      FROM user_accounts WHERE id = ?
    `
      )
      .get(userId);
    if (!user) return null;
    return {
      id: user.id,
      accountId: user.account_id,
      username: user.username,
      accountSuffix: user.account_id.replace(/-/g, '').slice(-4),
      avatarUrl: user.avatar_asset_id ? `/api/avatars/${user.avatar_asset_id}` : null,
      createdAt: Number(user.created_at)
    };
  }

  sessionPayload(session) {
    return {
      authenticated: true,
      user: this.publicUser(session.userId),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      passkeys: this.listPasskeys(session.userId),
      email: this.emailForUser(session.userId),
      sharing: this.getSharing(session.userId),
      limits: { passkeys: this.maxPasskeys, sessions: this.maxSessions }
    };
  }

  recordSecurityEvent(userId, eventType, details = {}) {
    return recordSecurityEvent(this, userId, eventType, details);
  }

  listSecurityEvents(userId, limit = 30) {
    return listSecurityEvents(this, userId, limit);
  }

  listSessions(userId, currentTokenHash) {
    return listSessions(this, userId, currentTokenHash);
  }

  revokeSession(userId, tokenHash, currentTokenHash) {
    return revokeSession(this, userId, tokenHash, currentTokenHash);
  }

  revokeOtherSessions(userId, currentTokenHash) {
    return revokeOtherSessions(this, userId, currentTokenHash);
  }

  startDevicePairing(intentInput) {
    return startDevicePairing(this, intentInput);
  }

  inspectDevicePairing(approveToken) {
    return inspectDevicePairing(this, approveToken);
  }

  approveDevicePairing(approveToken, session) {
    return approveDevicePairing(this, approveToken, session);
  }

  cancelDevicePairing(id, claimToken) {
    return cancelDevicePairing(this, id, claimToken);
  }

  claimDevicePairing(id, claimToken, client = {}) {
    return claimDevicePairing(this, id, claimToken, client);
  }

  emailForUser(userId) {
    return this.emailAuth.emailForUser(userId);
  }

  createEmailAuthRequest(emailInput, intentInput, requestedUserId = null, options = {}) {
    return this.emailAuth.createEmailAuthRequest(emailInput, intentInput, requestedUserId, options);
  }

  markEmailRequestSent(requestId, providerEmailId) {
    return this.emailAuth.markEmailRequestSent(requestId, providerEmailId);
  }

  markEmailRequestFailed(requestId) {
    return this.emailAuth.markEmailRequestFailed(requestId);
  }

  confirmEmailAuthRequest(tokenInput, options = {}) {
    return this.emailAuth.confirmEmailAuthRequest(tokenInput, options);
  }

  async claimEmailAuthRequest(
    requestIdInput,
    claimTokenInput,
    currentSession = null,
    confirmAccountSwitch = false,
    options = {}
  ) {
    return this.emailAuth.claimEmailAuthRequest(
      requestIdInput,
      claimTokenInput,
      currentSession,
      confirmAccountSwitch,
      options
    );
  }

  consumeEmailBinding(row, existing) {
    return this.emailAuth.consumeEmailBinding(row, existing);
  }

  recordResendWebhook(eventIdInput, event) {
    return this.emailAuth.recordResendWebhook(eventIdInput, event);
  }

  listPasskeys(userId) {
    return listPasskeys(this, userId);
  }

  renamePasskey(userId, credentialId, value) {
    return renamePasskey(this, userId, credentialId, value);
  }

  async beginRegistration() {
    return beginRegistration(this);
  }

  async finishRegistration(flowId, response, client = {}) {
    return finishRegistration(this, flowId, response, client);
  }

  insertCredential(userId, credential, registrationInfo, transports, now = Date.now()) {
    return insertCredential(this, userId, credential, registrationInfo, transports, now);
  }

  async beginLogin() {
    return beginLogin(this);
  }

  credentialForVerification(credentialId) {
    return credentialForVerification(this, credentialId);
  }

  updateCredentialCounter(storedRow, newCounter) {
    return updateCredentialCounter(this, storedRow, newCounter);
  }

  async finishLogin(flowId, response, client = {}) {
    return finishLogin(this, flowId, response, client);
  }

  async verifyRecovery(accountIdInput, recoveryCodeInput) {
    return verifyRecovery(this, accountIdInput, recoveryCodeInput);
  }

  async verifyUserRecovery(userId, recoveryCodeInput) {
    return verifyUserRecovery(this, userId, recoveryCodeInput);
  }

  async removeEmail(userId, recoveryCodeInput) {
    return removeEmail(this, userId, recoveryCodeInput);
  }

  async authorizeAccountDeletion(userId, accountIdInput, recoveryCodeInput) {
    return authorizeAccountDeletion(this, userId, accountIdInput, recoveryCodeInput);
  }

  deleteAccount(userId) {
    return deleteAccount(this, userId);
  }

  async beginRecovery(accountId, recoveryCode) {
    return beginRecovery(this, accountId, recoveryCode);
  }

  async finishRecovery(flowId, response, client = {}) {
    return finishRecovery(this, flowId, response, client);
  }

  async beginAddPasskey(userId) {
    return beginAddPasskey(this, userId);
  }

  issueRecentAuth(userId, sessionTokenHash, action) {
    return issueRecentAuth(this, userId, sessionTokenHash, action);
  }

  consumeRecentAuth(userId, sessionTokenHash, action, tokenInput) {
    return consumeRecentAuth(this, userId, sessionTokenHash, action, tokenInput);
  }

  async authorizeWithRecovery(userId, sessionTokenHash, action, recoveryCode) {
    return authorizeWithRecovery(this, userId, sessionTokenHash, action, recoveryCode);
  }

  async finishAddPasskey(userId, flowId, response) {
    return finishAddPasskey(this, userId, flowId, response);
  }

  async beginSensitiveAction(userId, action, targetId = null) {
    return beginSensitiveAction(this, userId, action, targetId);
  }

  async finishSensitiveAction(userId, sessionTokenHash, flowId, response) {
    return finishSensitiveAction(this, userId, sessionTokenHash, flowId, response);
  }

  logout(session) {
    return logout(this, session);
  }

  updateUsername(userId, value) {
    const username = normalizeUsername(value);
    const current = this.database.prepare('SELECT username FROM user_accounts WHERE id = ?').get(userId);
    if (!current) throw httpError(404, '账号不存在', 'ACCOUNT_NOT_FOUND');
    if (current.username === username) return this.publicUser(userId);
    this.database
      .prepare('UPDATE user_accounts SET username = ?, updated_at = ? WHERE id = ?')
      .run(username, Date.now(), userId);
    this.recordSecurityEvent(userId, 'username-changed');
    return this.publicUser(userId);
  }

  setAvatar(userId, assetId) {
    this.database
      .prepare('UPDATE user_accounts SET avatar_asset_id = ?, updated_at = ? WHERE id = ?')
      .run(assetId, Date.now(), userId);
    this.recordSecurityEvent(userId, assetId ? 'avatar-changed' : 'avatar-removed');
    return this.publicUser(userId);
  }

  groupForUser(userId) {
    return groupForUser(this, userId);
  }

  getSharing(userId) {
    return getSharing(this, userId);
  }

  regenerateInviteCode(userId) {
    return regenerateInviteCode(this, userId);
  }

  joinGroup(userId, codeInput) {
    return joinGroup(this, userId, codeInput);
  }

  removeMember(ownerUserId, targetUserId) {
    return removeMember(this, ownerUserId, targetUserId);
  }

  leaveGroup(userId) {
    return leaveGroup(this, userId);
  }

  visibleOwnerIds(userId) {
    return visibleOwnerIds(this, userId);
  }

  canAccessBoard(userId, boardId) {
    return canAccessBoard(this, userId, boardId);
  }

  canReferenceAsset(userId, assetId) {
    return canReferenceAsset(this, userId, assetId);
  }

  canManageBoard(userId, boardId) {
    return canManageBoard(this, userId, boardId);
  }
}

module.exports = {
  AccountService,
  SESSION_COOKIE,
  clearCookie,
  httpError,
  normalizeEmail,
  normalizeUsername,
  sessionClientFromRequest
};
