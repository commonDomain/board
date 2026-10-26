import { sessionClientFromRequest } from '../account-service.js';
import { emailMagicLink, sendAuthenticatedServiceResult, sendServiceResult } from './account-response.js';
import { EMAIL_AUTH_ENABLED, EMAIL_LINK_TTL_MS, EMAIL_RESEND_COOLDOWN_MS, REGISTRATION_ENABLED } from './config.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { servicesRuntime } from './runtime/services.js';
import { emailService } from './services.js';

async function handleAuthEmailStartPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/email/start') {
    if (!EMAIL_AUTH_ENABLED) {
      sendJson(res, 503, { error: '邮箱登录尚未配置', code: 'EMAIL_AUTH_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req);
    if (body?.intent === 'register' && !REGISTRATION_ENABLED) {
      sendJson(res, 503, { error: '新账号注册暂时关闭', code: 'REGISTRATION_DISABLED' });
      return true;
    }
    const request = servicesRuntime.accountService.createEmailAuthRequest(body?.email, body?.intent);
    try {
      const delivery = await emailService.sendMagicLink({
        requestId: request.requestId,
        email: request.email,
        intent: request.intent,
        link: emailMagicLink(request.token),
        expiresInMinutes: Math.ceil(EMAIL_LINK_TTL_MS / 60_000)
      });
      servicesRuntime.accountService.markEmailRequestSent(request.requestId, delivery.id);
    } catch (error) {
      servicesRuntime.accountService.markEmailRequestFailed(request.requestId);
      console.error(
        `Resend magic-link delivery failed (${error.code || 'EMAIL_DELIVERY_FAILED'}, ${error.providerStatusCode || 'unknown'}).`
      );
      sendJson(res, 503, { error: '邮件暂时无法发送，请稍后重试', code: 'EMAIL_DELIVERY_FAILED' });
      return true;
    }
    sendJson(res, 202, {
      ok: true,
      requestId: request.requestId,
      claimToken: request.claimToken,
      expiresAt: request.expiresAt,
      expiresIn: Math.floor(EMAIL_LINK_TTL_MS / 1000),
      resendAfter: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000)
    });
    return true;
  }
  return false;
}

async function handleAuthEmailVerifyPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/email/verify') {
    const body = await readJsonBody(req);
    sendServiceResult(
      res,
      servicesRuntime.accountService.confirmEmailAuthRequest(body?.token, { allowRegistration: REGISTRATION_ENABLED })
    );
    return true;
  }
  return false;
}

async function handleAuthEmailClaimPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;
  const isEmailClaimPoll = req.method === 'POST' && pathname === '/api/auth/email/claim';

  if (isEmailClaimPoll) {
    const body = await readJsonBody(req);
    const currentSession = servicesRuntime.accountService.readSession(req);
    await sendAuthenticatedServiceResult(
      req,
      res,
      await servicesRuntime.accountService.claimEmailAuthRequest(
        body?.requestId,
        body?.claimToken,
        currentSession,
        body?.confirmAccountSwitch === true,
        { allowRegistration: REGISTRATION_ENABLED, sessionClient: sessionClientFromRequest(req) }
      ),
      200,
      'email-login'
    );
    return true;
  }
  return false;
}

async function handleMeEmailStartPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/me/email/start') {
    if (!EMAIL_AUTH_ENABLED) {
      sendJson(res, 503, { error: '邮箱登录尚未配置', code: 'EMAIL_AUTH_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req);
    servicesRuntime.accountService.consumeRecentAuth(
      session.userId,
      session.tokenHash,
      'bind-email',
      body?.recentAuthToken
    );
    const currentEmail = servicesRuntime.accountService.emailForUser(session.userId);
    const request = servicesRuntime.accountService.createEmailAuthRequest(body?.email, 'bind', session.userId, {
      replaceExisting: Boolean(
        currentEmail &&
        currentEmail.address !==
          String(body?.email || '')
            .trim()
            .toLowerCase()
      )
    });
    try {
      const delivery = await emailService.sendMagicLink({
        requestId: request.requestId,
        email: request.email,
        intent: request.intent,
        link: emailMagicLink(request.token),
        expiresInMinutes: Math.ceil(EMAIL_LINK_TTL_MS / 60_000)
      });
      servicesRuntime.accountService.markEmailRequestSent(request.requestId, delivery.id);
    } catch (error) {
      servicesRuntime.accountService.markEmailRequestFailed(request.requestId);
      console.error(
        `Resend binding delivery failed (${error.code || 'EMAIL_DELIVERY_FAILED'}, ${error.providerStatusCode || 'unknown'}).`
      );
      sendJson(res, 503, { error: '邮件暂时无法发送，请稍后重试', code: 'EMAIL_DELIVERY_FAILED' });
      return true;
    }
    sendJson(res, 202, {
      ok: true,
      requestId: request.requestId,
      claimToken: request.claimToken,
      expiresAt: request.expiresAt,
      expiresIn: Math.floor(EMAIL_LINK_TTL_MS / 1000),
      resendAfter: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000)
    });
    return true;
  }
  return false;
}

async function handleMeEmailDelete(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'DELETE' && pathname === '/api/me/email') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await servicesRuntime.accountService.removeEmail(session.userId, body?.recoveryCode));
    return true;
  }
  return false;
}
export {
  handleAuthEmailStartPost,
  handleAuthEmailVerifyPost,
  handleAuthEmailClaimPost,
  handleMeEmailStartPost,
  handleMeEmailDelete
};
