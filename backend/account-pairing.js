'use strict';
const { sha256, randomToken, randomCrockford, httpError } = require('./account-helpers');

function startDevicePairing(account, intentInput) {
  account.cleanup();
  const intent = ['login', 'register', 'recovery'].includes(intentInput) ? intentInput : 'login';
  const id = randomToken(18);
  const approveToken = randomToken(32);
  const claimToken = randomToken(32);
  const verificationCode = randomCrockford(6);
  const now = Date.now();
  const expiresAt = now + account.devicePairingTtlMs;
  account.database
    .prepare(
      `
      INSERT INTO device_pairings
        (id, approve_token_hash, claim_token_hash, verification_code, intent, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `
    )
    .run(id, sha256(approveToken), sha256(claimToken), verificationCode, intent, expiresAt, now);
  const pairUrl = new URL('pair.html', account.publicBaseUrl);
  // A URL fragment is not sent with the HTTP request, keeping this one-time
  // approval secret out of static-file and reverse-proxy access logs.
  pairUrl.hash = `token=${encodeURIComponent(approveToken)}`;
  return { id, claimToken, approveToken, pairUrl: pairUrl.href, verificationCode, intent, expiresAt };
}

function inspectDevicePairing(account, approveToken) {
  account.cleanup();
  const row = account.database
    .prepare(
      `
      SELECT id, verification_code, intent, status, expires_at
      FROM device_pairings WHERE approve_token_hash = ?
    `
    )
    .get(sha256(String(approveToken || '')));
  if (!row || row.status !== 'pending') throw httpError(410, '二维码已失效，请在电脑端重新生成', 'PAIRING_EXPIRED');
  return {
    id: row.id,
    verificationCode: row.verification_code,
    intent: row.intent,
    expiresAt: Number(row.expires_at)
  };
}

function approveDevicePairing(account, approveToken, session) {
  account.cleanup();
  const now = Date.now();
  const pairing = account.database
    .prepare(
      `
      SELECT intent, created_at FROM device_pairings
      WHERE approve_token_hash = ? AND status = 'pending' AND expires_at > ?
    `
    )
    .get(sha256(String(approveToken || '')), now);
  if (!pairing) throw httpError(410, '二维码已失效或已经使用', 'PAIRING_EXPIRED');
  const userId = session?.userId;
  if (!userId) throw httpError(401, '请先完成账号验证', 'AUTH_REQUIRED');
  if (pairing.intent === 'register') {
    const user = account.database.prepare('SELECT created_at FROM user_accounts WHERE id = ?').get(userId);
    if (
      !user ||
      Number(user.created_at) < Number(pairing.created_at) ||
      Number(session.createdAt || 0) < Number(pairing.created_at)
    ) {
      throw httpError(409, '请先完成本次注册，再授权电脑', 'PAIRING_INTENT_MISMATCH');
    }
  }
  if (pairing.intent === 'recovery') {
    const recovered = account.database
      .prepare(
        `
        SELECT 1 FROM account_security_events
        WHERE user_id = ? AND event_type = 'account-recovered' AND created_at >= ? LIMIT 1
      `
      )
      .get(userId, pairing.created_at);
    if (!recovered || Number(session.createdAt || 0) < Number(pairing.created_at)) {
      throw httpError(409, '请先完成本次账号恢复，再授权电脑', 'PAIRING_INTENT_MISMATCH');
    }
  }
  const result = account.database
    .prepare(
      `
      UPDATE device_pairings
      SET status = 'approved', user_id = ?, approved_at = ?
      WHERE approve_token_hash = ? AND status = 'pending' AND expires_at > ?
    `
    )
    .run(userId, now, sha256(String(approveToken || '')), now);
  if (!result.changes) throw httpError(410, '二维码已失效或已经使用', 'PAIRING_EXPIRED');
  return { ok: true };
}

function cancelDevicePairing(account, id, claimToken) {
  const result = account.database
    .prepare(
      `
      UPDATE device_pairings SET status = 'cancelled'
      WHERE id = ? AND claim_token_hash = ? AND status = 'pending'
    `
    )
    .run(String(id || ''), sha256(String(claimToken || '')));
  return { ok: Boolean(result.changes) };
}

function claimDevicePairing(account, id, claimToken, client = {}) {
  account.cleanup();
  const claimHash = sha256(String(claimToken || ''));
  let session;
  let claimedUserId;
  account.database.exec('BEGIN IMMEDIATE');
  try {
    const row = account.database
      .prepare(
        `
        SELECT status, user_id, expires_at FROM device_pairings
        WHERE id = ? AND claim_token_hash = ?
      `
      )
      .get(String(id || ''), claimHash);
    if (!row) throw httpError(410, '二维码已失效，请重新生成', 'PAIRING_EXPIRED');
    if (row.status === 'pending') {
      account.database.exec('COMMIT');
      return { body: { status: 'pending', expiresAt: Number(row.expires_at) } };
    }
    if (row.status !== 'approved' || !row.user_id) throw httpError(410, '二维码已失效或已经使用', 'PAIRING_EXPIRED');
    const now = Date.now();
    const updated = account.database
      .prepare(
        `
        UPDATE device_pairings SET status = 'claimed', claimed_at = ?
        WHERE id = ? AND claim_token_hash = ? AND status = 'approved'
      `
      )
      .run(now, String(id || ''), claimHash);
    if (!updated.changes) throw httpError(409, '登录授权已被领取', 'PAIRING_ALREADY_CLAIMED');
    claimedUserId = row.user_id;
    session = account.issueSession(row.user_id, 'session-created', client);
    account.database.exec('COMMIT');
  } catch (error) {
    try {
      account.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return {
    headers: { 'set-cookie': session.cookie },
    body: { status: 'approved', ...account.sessionPayload({ userId: claimedUserId, ...session }) }
  };
}
module.exports = {
  startDevicePairing,
  inspectDevicePairing,
  approveDevicePairing,
  cancelDevicePairing,
  claimDevicePairing
};
