'use strict';
const {
  PHONE_PASSKEY_HINTS,
  sha256,
  randomToken,
  normalizeAccountId,
  recoveryHash,
  timingSafeHexEqual,
  httpError,
  clearCookie
} = require('./account-helpers');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} = require('@simplewebauthn/server');

async function verifyRecovery(account, accountIdInput, recoveryCodeInput) {
  const normalized = normalizeAccountId(accountIdInput);
  const user = account.database
    .prepare("SELECT * FROM user_accounts WHERE replace(account_id, '-', '') = ?")
    .get(normalized);
  const salt = user?.recovery_salt || '00000000000000000000000000000000';
  const calculated = await recoveryHash(recoveryCodeInput, salt);
  const valid = Boolean(user && timingSafeHexEqual(calculated, user.recovery_hash));
  if (!valid) throw httpError(400, '账号 ID 或恢复码不正确', 'RECOVERY_INVALID');
  return user;
}

async function verifyUserRecovery(account, userId, recoveryCodeInput) {
  const user = account.database.prepare('SELECT * FROM user_accounts WHERE id = ?').get(userId);
  const salt = user?.recovery_salt || '00000000000000000000000000000000';
  const calculated = await recoveryHash(recoveryCodeInput, salt);
  if (!user || !timingSafeHexEqual(calculated, user.recovery_hash)) {
    throw httpError(400, '恢复码不正确', 'RECOVERY_INVALID');
  }
  return user;
}

async function removeEmail(account, userId, recoveryCodeInput) {
  await account.verifyUserRecovery(userId, recoveryCodeInput);
  const passkeyCount = Number(
    account.database.prepare('SELECT COUNT(*) AS count FROM passkey_credentials WHERE user_id = ?').get(userId).count
  );
  if (!passkeyCount) throw httpError(409, '请先添加 Passkey，再解绑邮箱', 'LAST_LOGIN_METHOD');
  const removed = account.database
    .prepare("DELETE FROM external_identities WHERE provider = 'email' AND user_id = ?")
    .run(userId);
  if (!removed.changes) throw httpError(404, '当前账号未绑定邮箱', 'EMAIL_NOT_BOUND');
  account.recordSecurityEvent(userId, 'email-removed');
  return { email: null };
}

async function authorizeAccountDeletion(account, userId, accountIdInput, recoveryCodeInput) {
  const user = await account.verifyUserRecovery(userId, recoveryCodeInput);
  if (normalizeAccountId(accountIdInput) !== normalizeAccountId(user.account_id)) {
    throw httpError(400, '账号 ID 不匹配', 'ACCOUNT_ID_MISMATCH');
  }
  return user;
}

function deleteAccount(account, userId) {
  const result = account.database.prepare('DELETE FROM user_accounts WHERE id = ?').run(userId);
  if (!result.changes) throw httpError(404, '账号不存在', 'USER_NOT_FOUND');
  return { headers: { 'set-cookie': clearCookie() }, body: { ok: true } };
}

async function beginRecovery(account, accountId, recoveryCode) {
  const user = await account.verifyRecovery(accountId, recoveryCode);
  const excludeCredentials = account.database
    .prepare('SELECT credential_id, transports_json FROM passkey_credentials WHERE user_id = ?')
    .all(user.id)
    .map((row) => ({ id: row.credential_id, transports: JSON.parse(row.transports_json || '[]') }));
  const options = await generateRegistrationOptions({
    rpName: account.rpName,
    rpID: account.rpID,
    userID: Buffer.from(user.id, 'utf8'),
    userName: user.account_id,
    userDisplayName: user.username,
    timeout: account.challengeTtlMs,
    attestationType: 'none',
    excludeCredentials,
    preferredAuthenticatorType: 'localDevice',
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required'
    }
  });
  options.hints = [...PHONE_PASSKEY_HINTS];
  const flowId = account.createChallenge('recovery', options.challenge, user.id, {});
  return { flowId, options, accountId: user.account_id };
}

async function finishRecovery(account, flowId, response, client = {}) {
  const flow = account.consumeChallenge(flowId, 'recovery');
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: flow.challenge,
    expectedOrigin: account.expectedOrigin,
    expectedRPID: account.rpID,
    requireUserVerification: true
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw httpError(400, '新 Passkey 验证失败，请重试', 'PASSKEY_VERIFICATION_FAILED');
  }
  const recoveryCode = account.generateRecoveryCode();
  const recovery = await account.createRecoveryRecord(recoveryCode);
  const now = Date.now();
  let session;
  account.database.exec('BEGIN IMMEDIATE');
  try {
    account.database.prepare('DELETE FROM passkey_credentials WHERE user_id = ?').run(flow.user_id);
    account.database.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(flow.user_id);
    account.invalidateRecoveryChallenges(flow.user_id);
    account.insertCredential(
      flow.user_id,
      verification.registrationInfo.credential,
      verification.registrationInfo,
      response.response?.transports,
      now
    );
    account.database
      .prepare(
        `
        UPDATE user_accounts SET recovery_salt = ?, recovery_hash = ?, updated_at = ? WHERE id = ?
      `
      )
      .run(recovery.salt, recovery.hash, now, flow.user_id);
    session = account.issueSession(flow.user_id, 'account-recovered', client);
    account.database.exec('COMMIT');
  } catch (error) {
    try {
      account.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return {
    headers: { 'set-cookie': session.cookie },
    body: {
      ok: true,
      ...account.sessionPayload({ userId: flow.user_id, ...session }),
      recoveryCode
    }
  };
}

function issueRecentAuth(account, userId, sessionTokenHash, action) {
  if (!['add-passkey', 'bind-email'].includes(action)) {
    throw httpError(400, '不支持的身份确认操作', 'INVALID_SENSITIVE_ACTION');
  }
  const token = randomToken(32);
  const now = Date.now();
  account.database
    .prepare(
      `
      INSERT INTO recent_auth_grants (token_hash, user_id, session_token_hash, action, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(sha256(token), userId, sessionTokenHash, action, now + account.recentAuthTtlMs, now);
  return { recentAuthToken: token, expiresAt: now + account.recentAuthTtlMs };
}

function consumeRecentAuth(account, userId, sessionTokenHash, action, tokenInput) {
  const tokenHash = sha256(String(tokenInput || ''));
  const now = Date.now();
  const removed = account.database
    .prepare(
      `
      DELETE FROM recent_auth_grants
      WHERE token_hash = ? AND user_id = ? AND session_token_hash = ? AND action = ? AND expires_at > ?
      RETURNING token_hash
    `
    )
    .get(tokenHash, userId, sessionTokenHash, action, now);
  if (!removed) throw httpError(403, '请重新确认身份后再继续', 'RECENT_AUTH_REQUIRED');
  return true;
}

async function authorizeWithRecovery(account, userId, sessionTokenHash, action, recoveryCode) {
  const passkeyCount = Number(
    account.database.prepare('SELECT COUNT(*) AS count FROM passkey_credentials WHERE user_id = ?').get(userId).count
  );
  if (passkeyCount > 0) throw httpError(409, '请使用已有 Passkey 确认身份', 'PASSKEY_REAUTH_REQUIRED');
  await account.verifyUserRecovery(userId, recoveryCode);
  return account.issueRecentAuth(userId, sessionTokenHash, action);
}

async function beginSensitiveAction(account, userId, action, targetId = null) {
  if (!['delete-passkey', 'rotate-recovery', 'authorize-add-passkey', 'authorize-bind-email'].includes(action)) {
    throw httpError(400, '不支持的安全操作', 'INVALID_SENSITIVE_ACTION');
  }
  const allowCredentials = account.database
    .prepare('SELECT credential_id, transports_json FROM passkey_credentials WHERE user_id = ?')
    .all(userId)
    .map((row) => ({ id: row.credential_id, transports: JSON.parse(row.transports_json || '[]') }));
  const options = await generateAuthenticationOptions({
    rpID: account.rpID,
    timeout: account.challengeTtlMs,
    userVerification: 'required',
    allowCredentials
  });
  return {
    flowId: account.createChallenge('sensitive', options.challenge, userId, { action, targetId }),
    options
  };
}

async function finishSensitiveAction(account, userId, sessionTokenHash, flowId, response) {
  const flow = account.consumeChallenge(flowId, 'sensitive');
  if (flow.user_id !== userId) throw httpError(403, '认证流程与当前账号不匹配', 'AUTH_FLOW_MISMATCH');
  const stored = account.credentialForVerification(response?.id);
  if (!stored || stored.row.user_id !== userId) throw httpError(400, '无法使用该 Passkey 验证', 'PASSKEY_NOT_FOUND');
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: flow.challenge,
    expectedOrigin: account.expectedOrigin,
    expectedRPID: account.rpID,
    credential: stored.credential,
    requireUserVerification: true
  });
  if (!verification.verified) throw httpError(400, 'Passkey 验证失败', 'PASSKEY_VERIFICATION_FAILED');
  account.updateCredentialCounter(stored.row, verification.authenticationInfo.newCounter);
  if (flow.payload.action === 'authorize-add-passkey' || flow.payload.action === 'authorize-bind-email') {
    const action = flow.payload.action === 'authorize-add-passkey' ? 'add-passkey' : 'bind-email';
    return account.issueRecentAuth(userId, sessionTokenHash, action);
  }
  if (flow.payload.action === 'delete-passkey') {
    const target = account.database
      .prepare('SELECT user_id FROM passkey_credentials WHERE credential_id = ?')
      .get(flow.payload.targetId);
    if (!target || target.user_id !== userId) throw httpError(404, 'Passkey 不存在', 'PASSKEY_NOT_FOUND');
    const count = Number(
      account.database.prepare('SELECT COUNT(*) AS count FROM passkey_credentials WHERE user_id = ?').get(userId).count
    );
    if (count <= 1) throw httpError(409, '至少需要保留一枚 Passkey', 'LAST_PASSKEY');
    account.database.prepare('DELETE FROM passkey_credentials WHERE credential_id = ?').run(flow.payload.targetId);
    account.recordSecurityEvent(userId, 'passkey-deleted');
    return { passkeys: account.listPasskeys(userId) };
  }
  const recoveryCode = account.generateRecoveryCode();
  const recovery = await account.createRecoveryRecord(recoveryCode);
  account.database.exec('BEGIN IMMEDIATE');
  try {
    account.database
      .prepare('UPDATE user_accounts SET recovery_salt = ?, recovery_hash = ?, updated_at = ? WHERE id = ?')
      .run(recovery.salt, recovery.hash, Date.now(), userId);
    account.invalidateRecoveryChallenges(userId);
    account.recordSecurityEvent(userId, 'recovery-code-rotated');
    account.database.exec('COMMIT');
  } catch (error) {
    try {
      account.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return { recoveryCode };
}
module.exports = {
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
};
