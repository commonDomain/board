'use strict';
const { PHONE_PASSKEY_HINTS, httpError } = require('./account-helpers');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} = require('@simplewebauthn/server');

function listPasskeys(account, userId) {
  return account.database
    .prepare(
      `
      SELECT credential_id, name, device_type, backed_up, created_at, last_used_at
      FROM passkey_credentials WHERE user_id = ? ORDER BY created_at
    `
    )
    .all(userId)
    .map((row) => ({
      id: row.credential_id,
      name: row.name,
      deviceType: row.device_type,
      backedUp: Boolean(row.backed_up),
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at)
    }));
}

function renamePasskey(account, userId, credentialId, value) {
  const name = String(value || '')
    .normalize('NFKC')
    .trim();
  if (!name || Array.from(name).length > 40 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw httpError(400, 'Passkey 名称必须包含 1–40 个有效字符', 'INVALID_PASSKEY_NAME');
  }
  const result = account.database
    .prepare('UPDATE passkey_credentials SET name = ? WHERE credential_id = ? AND user_id = ?')
    .run(name, credentialId, userId);
  if (!result.changes) throw httpError(404, 'Passkey 不存在', 'PASSKEY_NOT_FOUND');
  return account.listPasskeys(userId);
}

async function beginRegistration(account) {
  account.cleanup();
  const identity = account.nextAccountIdentity();
  const options = await generateRegistrationOptions({
    rpName: account.rpName,
    rpID: account.rpID,
    userID: Buffer.from(identity.userId, 'utf8'),
    userName: identity.accountId,
    userDisplayName: identity.username,
    timeout: account.challengeTtlMs,
    attestationType: 'none',
    preferredAuthenticatorType: 'localDevice',
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required'
    }
  });
  options.hints = [...PHONE_PASSKEY_HINTS];
  const flowId = account.createChallenge('register', options.challenge, identity.userId, identity);
  return { flowId, options, pendingUser: { accountId: identity.accountId, username: identity.username } };
}

async function finishRegistration(account, flowId, response, client = {}) {
  const flow = account.consumeChallenge(flowId, 'register');
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: flow.challenge,
    expectedOrigin: account.expectedOrigin,
    expectedRPID: account.rpID,
    requireUserVerification: true
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw httpError(400, 'Passkey 验证失败，请重试', 'PASSKEY_VERIFICATION_FAILED');
  }
  const recoveryCode = account.generateRecoveryCode();
  const recovery = await account.createRecoveryRecord(recoveryCode);
  const now = Date.now();
  const identity = flow.payload;
  const credential = verification.registrationInfo.credential;
  let session;
  account.database.exec('BEGIN IMMEDIATE');
  try {
    account.database
      .prepare(
        `
        INSERT INTO user_accounts
          (id, account_id, username, avatar_asset_id, recovery_salt, recovery_hash, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
      `
      )
      .run(identity.userId, identity.accountId, identity.username, recovery.salt, recovery.hash, now, now);
    account.insertCredential(
      identity.userId,
      credential,
      verification.registrationInfo,
      response.response?.transports,
      now
    );
    session = account.issueSession(identity.userId, 'account-created-with-passkey', client);
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
      ...account.sessionPayload({ userId: identity.userId, ...session }),
      recoveryCode
    }
  };
}

function insertCredential(account, userId, credential, registrationInfo, transports, now = Date.now()) {
  const count = Number(
    account.database.prepare('SELECT COUNT(*) AS count FROM passkey_credentials WHERE user_id = ?').get(userId).count
  );
  if (count >= account.maxPasskeys) {
    throw httpError(409, `每个账号最多可保存 ${account.maxPasskeys} 枚 Passkey`, 'PASSKEY_LIMIT_REACHED');
  }
  account.database
    .prepare(
      `
      INSERT INTO passkey_credentials
        (credential_id, user_id, public_key, counter, transports_json, device_type, backed_up, name, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Passkey', ?, NULL)
    `
    )
    .run(
      credential.id,
      userId,
      Buffer.from(credential.publicKey),
      Number(credential.counter) || 0,
      JSON.stringify(Array.isArray(transports) ? transports : credential.transports || []),
      registrationInfo.credentialDeviceType,
      registrationInfo.credentialBackedUp ? 1 : 0,
      now
    );
}

async function beginLogin(account) {
  const options = await generateAuthenticationOptions({
    rpID: account.rpID,
    timeout: account.challengeTtlMs,
    userVerification: 'required',
    allowCredentials: []
  });
  options.hints = [...PHONE_PASSKEY_HINTS];
  const flowId = account.createChallenge('login', options.challenge, null, {});
  return { flowId, options };
}

function credentialForVerification(account, credentialId) {
  const row = account.database.prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?').get(credentialId);
  if (!row) return null;
  return {
    row,
    credential: {
      id: row.credential_id,
      publicKey: new Uint8Array(row.public_key),
      counter: Number(row.counter),
      transports: JSON.parse(row.transports_json || '[]')
    }
  };
}

function updateCredentialCounter(account, storedRow, newCounter) {
  const updated = account.database
    .prepare(
      `
      UPDATE passkey_credentials SET counter = ?, last_used_at = ?
      WHERE credential_id = ? AND counter = ?
    `
    )
    .run(newCounter, Date.now(), storedRow.credential_id, Number(storedRow.counter));
  if (!updated.changes) {
    throw httpError(409, 'Passkey 已在另一个请求中使用，请重试', 'PASSKEY_COUNTER_CONFLICT');
  }
}

async function finishLogin(account, flowId, response, client = {}) {
  const flow = account.consumeChallenge(flowId, 'login');
  const stored = account.credentialForVerification(response?.id);
  if (!stored) throw httpError(400, '无法使用该 Passkey 登录', 'PASSKEY_NOT_FOUND');
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: flow.challenge,
    expectedOrigin: account.expectedOrigin,
    expectedRPID: account.rpID,
    credential: stored.credential,
    requireUserVerification: true
  });
  if (!verification.verified) throw httpError(400, 'Passkey 验证失败，请重试', 'PASSKEY_VERIFICATION_FAILED');
  account.updateCredentialCounter(stored.row, verification.authenticationInfo.newCounter);
  const session = account.issueSession(stored.row.user_id, 'passkey-login', client);
  return {
    headers: { 'set-cookie': session.cookie },
    body: { ok: true, ...account.sessionPayload({ userId: stored.row.user_id, ...session }) }
  };
}

async function beginAddPasskey(account, userId) {
  const user = account.database.prepare('SELECT * FROM user_accounts WHERE id = ?').get(userId);
  if (!user) throw httpError(404, '账号不存在', 'USER_NOT_FOUND');
  const passkeyCount = Number(
    account.database.prepare('SELECT COUNT(*) AS count FROM passkey_credentials WHERE user_id = ?').get(userId).count
  );
  if (passkeyCount >= account.maxPasskeys) {
    throw httpError(409, `每个账号最多可保存 ${account.maxPasskeys} 枚 Passkey`, 'PASSKEY_LIMIT_REACHED');
  }
  const excludeCredentials = account.database
    .prepare('SELECT credential_id, transports_json FROM passkey_credentials WHERE user_id = ?')
    .all(userId)
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
  return { flowId: account.createChallenge('add-passkey', options.challenge, userId, {}), options };
}

async function finishAddPasskey(account, userId, flowId, response) {
  const flow = account.consumeChallenge(flowId, 'add-passkey');
  if (flow.user_id !== userId) throw httpError(403, '认证流程与当前账号不匹配', 'AUTH_FLOW_MISMATCH');
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: flow.challenge,
    expectedOrigin: account.expectedOrigin,
    expectedRPID: account.rpID,
    requireUserVerification: true
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw httpError(400, '新 Passkey 验证失败', 'PASSKEY_VERIFICATION_FAILED');
  }
  account.database.exec('BEGIN IMMEDIATE');
  try {
    account.insertCredential(
      userId,
      verification.registrationInfo.credential,
      verification.registrationInfo,
      response.response?.transports
    );
    account.recordSecurityEvent(userId, 'passkey-added');
    account.database.exec('COMMIT');
  } catch (error) {
    try {
      account.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return account.listPasskeys(userId);
}
module.exports = {
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
};
