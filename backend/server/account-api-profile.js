import { sendServiceResult } from './account-response.js';
import { deleteAccountAndCanvases } from './catalog-mutations.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { servicesRuntime } from './runtime/services.js';
import { notifySharingChanged, sharingUserIds } from './session-access.js';

async function handleMeGet(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/me') {
    sendJson(res, 200, servicesRuntime.accountService.sessionPayload(session));
    return true;
  }
  return false;
}

async function handleMePatch(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'PATCH' && pathname === '/api/me') {
    const body = await readJsonBody(req);
    const user = servicesRuntime.accountService.updateUsername(session.userId, body?.username);
    notifySharingChanged(sharingUserIds(session.userId), 'profile');
    sendJson(res, 200, { user });
    return true;
  }
  return false;
}

async function handleMeAccountDelete(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'DELETE' && pathname === '/api/me/account') {
    const body = await readJsonBody(req);
    await servicesRuntime.accountService.authorizeAccountDeletion(session.userId, body?.accountId, body?.recoveryCode);
    sendServiceResult(res, await deleteAccountAndCanvases(session.userId));
    return true;
  }
  return false;
}
export { handleMeGet, handleMePatch, handleMeAccountDelete };
