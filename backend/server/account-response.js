import { sessionClientFromRequest } from '../account-service.js';
import { URL } from 'node:url';
import {
  EMAIL_AUTH_ENABLED,
  GUEST_MODE_ENABLED,
  MAX_AVATAR_SIZE,
  MAX_PASSKEYS_PER_ACCOUNT,
  MAX_SESSIONS_PER_ACCOUNT,
  PASSKEY_AUTH_ENABLED,
  PRIVACY_LOCK_IDLE_MS,
  PUBLIC_BASE_URL,
  REGISTRATION_ENABLED,
  SHARING_ENABLED,
  SHARING_MAX_MEMBERS
} from './config.js';
import { sendJson } from './http-response.js';
import { clientIp } from './http-security.js';
import { loginAuditLog } from './services.js';

function authProviderPayload() {
  return {
    email: EMAIL_AUTH_ENABLED,
    passkey: PASSKEY_AUTH_ENABLED,
    registration: REGISTRATION_ENABLED,
    guest: GUEST_MODE_ENABLED,
    sharing: SHARING_ENABLED,
    sharingMaxMembers: SHARING_MAX_MEMBERS,
    maxAvatarSize: MAX_AVATAR_SIZE,
    maxPasskeys: MAX_PASSKEYS_PER_ACCOUNT,
    maxSessions: MAX_SESSIONS_PER_ACCOUNT,
    privacyLockIdleMs: PRIVACY_LOCK_IDLE_MS
  };
}

function emailMagicLink(token) {
  const target = new URL('email-auth.html', PUBLIC_BASE_URL);
  target.hash = `token=${encodeURIComponent(token)}`;
  return target.href;
}

function sendServiceResult(res, result, status = 200) {
  sendJson(res, result.status || status, result.body ?? result, result.headers || {});
}

async function sendAuthenticatedServiceResult(req, res, result, status = 200, event = 'login') {
  const body = result?.body ?? result;
  if (body?.authenticated && body.user) {
    const client = sessionClientFromRequest(req);
    try {
      await loginAuditLog.record({
        event,
        ip: clientIp(req),
        accountId: body.user.accountId,
        username: body.user.username,
        systemName: client.systemName,
        appName: client.appName,
        deviceClass: client.deviceClass,
        userAgent: req.headers['user-agent']
      });
    } catch (error) {
      console.error(`Unable to write login audit log: ${error.message}`);
    }
  }
  sendServiceResult(res, result, status);
}

function recordAuthenticatedUserOnline(req, session, event = 'online') {
  if (!session?.userId) return;
  const client = sessionClientFromRequest(req);
  void loginAuditLog
    .recordOnline({
      event,
      sessionKey: session.tokenHash,
      ip: clientIp(req),
      accountId: session.accountId,
      username: session.username,
      systemName: client.systemName,
      appName: client.appName,
      deviceClass: client.deviceClass,
      userAgent: req.headers['user-agent']
    })
    .catch((error) => console.error(`Unable to write online audit log: ${error.message}`));
}

export {
  authProviderPayload,
  emailMagicLink,
  recordAuthenticatedUserOnline,
  sendAuthenticatedServiceResult,
  sendServiceResult
};
