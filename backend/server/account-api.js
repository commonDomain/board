import { authIpLimit } from './rate-limits.js';
import { clientIp } from './http-security.js';
import { PASSKEY_AUTH_ENABLED, SHARING_ENABLED } from './config.js';
import { sendJson } from './http-response.js';
import { servicesRuntime } from './runtime/services.js';
import { disconnectInvalidSessions } from './session-access.js';
import {
  handleAuthEmailStartPost,
  handleAuthEmailVerifyPost,
  handleAuthEmailClaimPost,
  handleMeEmailStartPost,
  handleMeEmailDelete
} from './account-api-email.js';
import {
  handleAuthSessionGet,
  handleAuthLogoutPost,
  handleMeSessionsGet,
  handleMeSessionsDelete,
  handleMeSessionsIdDelete,
  handleMeSecurityEventsGet
} from './account-api-sessions.js';
import {
  handleAuthPairStartPost,
  handleAuthPairInspectPost,
  handleAuthPairApprovePost,
  handleAuthPairStatusGet,
  handleAuthPairCancelPost
} from './account-api-pairing.js';
import {
  handleAuthRegisterOptionsPost,
  handleAuthRegisterVerifyPost,
  handleAuthLoginOptionsPost,
  handleAuthLoginVerifyPost,
  handleAuthRecoveryStartPost,
  handleAuthRecoveryFinishPost,
  handleMePasskeysOptionsPost,
  handleMePasskeysVerifyPost,
  handleMePasskeysIdPatch,
  handleMeSecurityOptionsPost,
  handleMeSecurityRecoveryPost,
  handleMeSecurityVerifyPost
} from './account-api-passkeys.js';
import { handleAvatarsIdGet, handleMeAvatarPost, handleMeAvatarDelete } from './account-api-avatars.js';
import { handleMeGet, handleMePatch, handleMeAccountDelete } from './account-api-profile.js';
import {
  handleSharingGet,
  handleSharingInviteCodePost,
  handleSharingJoinPost,
  handleSharingMembersIdDelete,
  handleSharingLeavePost
} from './account-api-sharing.js';

async function handleAccountApi(req, res, requestUrl) {
  try {
    return await handleAccountApiRequest(req, res, requestUrl);
  } finally {
    if (!['GET', 'HEAD'].includes(req.method)) disconnectInvalidSessions();
  }
}

async function handleAccountApiRequest(req, res, requestUrl) {
  const pathname = requestUrl.pathname;
  const isEmailClaimPoll = req.method === 'POST' && pathname === '/api/auth/email/claim';
  if (
    req.method === 'POST' &&
    pathname.startsWith('/api/auth/') &&
    pathname !== '/api/auth/logout' &&
    !isEmailClaimPoll &&
    !authIpLimit(clientIp(req))
  ) {
    sendJson(res, 429, { error: '认证请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' });
    return true;
  }
  if (await handleAuthSessionGet(req, res, requestUrl)) return true;
  if (!PASSKEY_AUTH_ENABLED && pathname.startsWith('/api/auth/pair/')) {
    sendJson(res, 503, { error: 'Passkey 登录暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
    return true;
  }
  if (await handleAuthEmailStartPost(req, res, requestUrl)) return true;
  if (await handleAuthEmailVerifyPost(req, res, requestUrl)) return true;
  if (await handleAuthEmailClaimPost(req, res, requestUrl)) return true;
  if (await handleAuthPairStartPost(req, res, requestUrl)) return true;
  if (await handleAuthPairInspectPost(req, res, requestUrl)) return true;
  if (await handleAuthPairApprovePost(req, res, requestUrl)) return true;
  if (await handleAuthPairStatusGet(req, res, requestUrl)) return true;
  if (await handleAuthPairCancelPost(req, res, requestUrl)) return true;
  if (await handleAuthRegisterOptionsPost(req, res, requestUrl)) return true;
  if (await handleAuthRegisterVerifyPost(req, res, requestUrl)) return true;
  if (await handleAuthLoginOptionsPost(req, res, requestUrl)) return true;
  if (await handleAuthLoginVerifyPost(req, res, requestUrl)) return true;
  if (await handleAuthRecoveryStartPost(req, res, requestUrl)) return true;
  if (await handleAuthRecoveryFinishPost(req, res, requestUrl)) return true;
  if (await handleAuthLogoutPost(req, res, requestUrl)) return true;

  if (
    !pathname.startsWith('/api/me') &&
    !pathname.startsWith('/api/sharing') &&
    !pathname.startsWith('/api/avatars/')
  ) {
    return false;
  }
  if (await handleAvatarsIdGet(req, res, requestUrl)) return true;

  const session = servicesRuntime.accountService.requireSession(req, {
    requireCsrf: req.method !== 'GET' && req.method !== 'HEAD'
  });
  if (
    !PASSKEY_AUTH_ENABLED &&
    (pathname.startsWith('/api/me/passkeys') ||
      pathname === '/api/me/security/options' ||
      pathname === '/api/me/security/verify')
  ) {
    sendJson(res, 503, { error: 'Passkey 管理暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
    return true;
  }
  if (!SHARING_ENABLED && pathname.startsWith('/api/sharing')) {
    sendJson(res, 503, { error: '实时共享暂时关闭', code: 'SHARING_DISABLED' });
    return true;
  }
  if (await handleMeGet(req, res, requestUrl, session)) return true;
  if (await handleMePatch(req, res, requestUrl, session)) return true;
  if (await handleMeEmailStartPost(req, res, requestUrl, session)) return true;
  if (await handleMeAvatarPost(req, res, requestUrl, session)) return true;
  if (await handleMeAvatarDelete(req, res, requestUrl, session)) return true;
  if (await handleMeEmailDelete(req, res, requestUrl, session)) return true;
  if (await handleMeSessionsGet(req, res, requestUrl, session)) return true;
  if (await handleMeSessionsDelete(req, res, requestUrl, session)) return true;

  if (await handleMeSessionsIdDelete(req, res, requestUrl, session)) return true;
  if (await handleMeSecurityEventsGet(req, res, requestUrl, session)) return true;
  if (await handleMeAccountDelete(req, res, requestUrl, session)) return true;
  if (await handleMePasskeysOptionsPost(req, res, requestUrl, session)) return true;
  if (await handleMePasskeysVerifyPost(req, res, requestUrl, session)) return true;

  if (await handleMePasskeysIdPatch(req, res, requestUrl, session)) return true;
  if (await handleMeSecurityOptionsPost(req, res, requestUrl, session)) return true;
  if (await handleMeSecurityRecoveryPost(req, res, requestUrl, session)) return true;
  if (await handleMeSecurityVerifyPost(req, res, requestUrl, session)) return true;
  if (await handleSharingGet(req, res, requestUrl, session)) return true;
  if (await handleSharingInviteCodePost(req, res, requestUrl, session)) return true;
  if (await handleSharingJoinPost(req, res, requestUrl, session)) return true;

  if (await handleSharingMembersIdDelete(req, res, requestUrl, session)) return true;
  if (await handleSharingLeavePost(req, res, requestUrl, session)) return true;
  return false;
}

export { handleAccountApi, handleAccountApiRequest };
