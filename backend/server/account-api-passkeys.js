import { sessionClientFromRequest } from '../account-service.js';
import { sendAuthenticatedServiceResult } from './account-response.js';
import { PASSKEY_AUTH_ENABLED, REGISTRATION_ENABLED } from './config.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { servicesRuntime } from './runtime/services.js';

async function handleAuthRegisterOptionsPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/register/options') {
    if (!PASSKEY_AUTH_ENABLED || !REGISTRATION_ENABLED) {
      sendJson(res, 503, {
        error: !REGISTRATION_ENABLED ? '新账号注册暂时关闭' : 'Passkey 登录暂时关闭',
        code: !REGISTRATION_ENABLED ? 'REGISTRATION_DISABLED' : 'PASSKEY_AUTH_DISABLED'
      });
      return true;
    }
    sendJson(res, 200, await servicesRuntime.accountService.beginRegistration());
    return true;
  }
  return false;
}

async function handleAuthRegisterVerifyPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/register/verify') {
    if (!PASSKEY_AUTH_ENABLED || !REGISTRATION_ENABLED) {
      sendJson(res, 503, {
        error: !REGISTRATION_ENABLED ? '新账号注册暂时关闭' : 'Passkey 登录暂时关闭',
        code: !REGISTRATION_ENABLED ? 'REGISTRATION_DISABLED' : 'PASSKEY_AUTH_DISABLED'
      });
      return true;
    }
    const body = await readJsonBody(req, 256 * 1024);
    await sendAuthenticatedServiceResult(
      req,
      res,
      await servicesRuntime.accountService.finishRegistration(
        body?.flowId,
        body?.response,
        sessionClientFromRequest(req)
      ),
      201,
      'passkey-registration'
    );
    return true;
  }
  return false;
}

async function handleAuthLoginOptionsPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/login/options') {
    if (!PASSKEY_AUTH_ENABLED) {
      sendJson(res, 503, { error: 'Passkey 登录暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
      return true;
    }
    sendJson(res, 200, await servicesRuntime.accountService.beginLogin());
    return true;
  }
  return false;
}

async function handleAuthLoginVerifyPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/login/verify') {
    if (!PASSKEY_AUTH_ENABLED) {
      sendJson(res, 503, { error: 'Passkey 登录暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req, 128 * 1024);
    await sendAuthenticatedServiceResult(
      req,
      res,
      await servicesRuntime.accountService.finishLogin(body?.flowId, body?.response, sessionClientFromRequest(req)),
      200,
      'passkey-login'
    );
    return true;
  }
  return false;
}

async function handleAuthRecoveryStartPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/recovery/start') {
    if (!PASSKEY_AUTH_ENABLED) {
      sendJson(res, 503, { error: 'Passkey 恢复暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req);
    sendJson(res, 200, await servicesRuntime.accountService.beginRecovery(body?.accountId, body?.recoveryCode));
    return true;
  }
  return false;
}

async function handleAuthRecoveryFinishPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/recovery/finish') {
    if (!PASSKEY_AUTH_ENABLED) {
      sendJson(res, 503, { error: 'Passkey 恢复暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req, 256 * 1024);
    await sendAuthenticatedServiceResult(
      req,
      res,
      await servicesRuntime.accountService.finishRecovery(body?.flowId, body?.response, sessionClientFromRequest(req)),
      200,
      'account-recovery'
    );
    return true;
  }
  return false;
}

async function handleMePasskeysOptionsPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/me/passkeys/options') {
    if (!PASSKEY_AUTH_ENABLED) {
      sendJson(res, 503, { error: 'Passkey 管理暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req);
    servicesRuntime.accountService.consumeRecentAuth(
      session.userId,
      session.tokenHash,
      'add-passkey',
      body?.recentAuthToken
    );
    sendJson(res, 200, await servicesRuntime.accountService.beginAddPasskey(session.userId));
    return true;
  }
  return false;
}

async function handleMePasskeysVerifyPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/me/passkeys/verify') {
    if (!PASSKEY_AUTH_ENABLED) {
      sendJson(res, 503, { error: 'Passkey 管理暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req, 256 * 1024);
    sendJson(res, 200, {
      passkeys: await servicesRuntime.accountService.finishAddPasskey(session.userId, body?.flowId, body?.response)
    });
    return true;
  }
  return false;
}

async function handleMePasskeysIdPatch(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;
  const passkeyMatch = pathname.match(/^\/api\/me\/passkeys\/([^/]+)$/);
  if (req.method === 'PATCH' && passkeyMatch) {
    const body = await readJsonBody(req);
    sendJson(res, 200, {
      passkeys: servicesRuntime.accountService.renamePasskey(
        session.userId,
        decodeURIComponent(passkeyMatch[1]),
        body?.name
      )
    });
    return true;
  }
  return false;
}

async function handleMeSecurityOptionsPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/me/security/options') {
    const body = await readJsonBody(req);
    sendJson(
      res,
      200,
      await servicesRuntime.accountService.beginSensitiveAction(session.userId, body?.action, body?.targetId)
    );
    return true;
  }
  return false;
}

async function handleMeSecurityRecoveryPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/me/security/recovery') {
    const body = await readJsonBody(req);
    sendJson(
      res,
      200,
      await servicesRuntime.accountService.authorizeWithRecovery(
        session.userId,
        session.tokenHash,
        body?.action,
        body?.recoveryCode
      )
    );
    return true;
  }
  return false;
}

async function handleMeSecurityVerifyPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/me/security/verify') {
    const body = await readJsonBody(req, 128 * 1024);
    sendJson(
      res,
      200,
      await servicesRuntime.accountService.finishSensitiveAction(
        session.userId,
        session.tokenHash,
        body?.flowId,
        body?.response
      )
    );
    return true;
  }
  return false;
}
export {
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
};
