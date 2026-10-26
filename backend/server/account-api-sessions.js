import { clearCookie } from '../account-service.js';
import { authProviderPayload, recordAuthenticatedUserOnline, sendServiceResult } from './account-response.js';
import { sendJson } from './http-response.js';
import { clientIp } from './http-security.js';
import { sessionReadLimit } from './rate-limits.js';
import { servicesRuntime } from './runtime/services.js';

async function handleAuthSessionGet(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/auth/session') {
    if (!sessionReadLimit(clientIp(req))) {
      sendJson(res, 429, { error: '会话检查过于频繁，请稍后重试。', code: 'RATE_LIMITED' });
      return true;
    }
    const session = servicesRuntime.accountService.readSession(req);
    if (session) recordAuthenticatedUserOnline(req, session, 'session-online');
    sendJson(res, 200, {
      ...(session ? servicesRuntime.accountService.sessionPayload(session) : { authenticated: false }),
      authProviders: authProviderPayload()
    });
    return true;
  }
  return false;
}

async function handleAuthLogoutPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const session = servicesRuntime.accountService.readSession(req, { requireCsrf: true });
    sendServiceResult(res, servicesRuntime.accountService.logout(session));
    return true;
  }
  return false;
}

async function handleMeSessionsGet(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/me/sessions') {
    sendJson(res, 200, { sessions: servicesRuntime.accountService.listSessions(session.userId, session.tokenHash) });
    return true;
  }
  return false;
}

async function handleMeSessionsDelete(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'DELETE' && pathname === '/api/me/sessions') {
    sendJson(res, 200, servicesRuntime.accountService.revokeOtherSessions(session.userId, session.tokenHash));
    return true;
  }
  return false;
}

async function handleMeSessionsIdDelete(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;
  const sessionMatch = pathname.match(/^\/api\/me\/sessions\/([a-f0-9]{64})$/);
  if (req.method === 'DELETE' && sessionMatch) {
    const result = servicesRuntime.accountService.revokeSession(session.userId, sessionMatch[1], session.tokenHash);
    sendJson(res, 200, result, result.currentRevoked ? { 'set-cookie': clearCookie() } : {});
    return true;
  }
  return false;
}

async function handleMeSecurityEventsGet(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/me/security/events') {
    sendJson(res, 200, { events: servicesRuntime.accountService.listSecurityEvents(session.userId) });
    return true;
  }
  return false;
}
export {
  handleAuthSessionGet,
  handleAuthLogoutPost,
  handleMeSessionsGet,
  handleMeSessionsDelete,
  handleMeSessionsIdDelete,
  handleMeSecurityEventsGet
};
