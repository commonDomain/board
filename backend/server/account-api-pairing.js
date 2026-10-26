import { sessionClientFromRequest } from '../account-service.js';
import QRCode from 'qrcode';
import { authProviderPayload, sendAuthenticatedServiceResult } from './account-response.js';
import { PASSKEY_AUTH_ENABLED, REGISTRATION_ENABLED } from './config.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { servicesRuntime } from './runtime/services.js';

async function handleAuthPairStartPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/pair/start') {
    const body = await readJsonBody(req);
    if (!PASSKEY_AUTH_ENABLED) {
      sendJson(res, 503, { error: 'Passkey 登录暂时关闭', code: 'PASSKEY_AUTH_DISABLED' });
      return true;
    }
    if (body?.intent === 'register' && !REGISTRATION_ENABLED) {
      sendJson(res, 503, { error: '新账号注册暂时关闭', code: 'REGISTRATION_DISABLED' });
      return true;
    }
    const pairing = servicesRuntime.accountService.startDevicePairing(body?.intent);
    const qrDataUrl = await QRCode.toDataURL(pairing.pairUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#171528', light: '#FFFFFF' }
    });
    sendJson(res, 201, {
      id: pairing.id,
      claimToken: pairing.claimToken,
      pairUrl: pairing.pairUrl,
      qrDataUrl,
      verificationCode: pairing.verificationCode,
      intent: pairing.intent,
      expiresAt: pairing.expiresAt
    });
    return true;
  }
  return false;
}

async function handleAuthPairInspectPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/pair/inspect') {
    const body = await readJsonBody(req);
    sendJson(res, 200, {
      ...servicesRuntime.accountService.inspectDevicePairing(body?.approveToken),
      authProviders: authProviderPayload()
    });
    return true;
  }
  return false;
}

async function handleAuthPairApprovePost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/pair/approve') {
    const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
    const body = await readJsonBody(req);
    sendJson(res, 200, servicesRuntime.accountService.approveDevicePairing(body?.approveToken, session));
    return true;
  }
  return false;
}

async function handleAuthPairStatusGet(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/auth/pair/status') {
    const result = servicesRuntime.accountService.claimDevicePairing(
      requestUrl.searchParams.get('id'),
      req.headers['x-pair-claim-token'],
      sessionClientFromRequest(req)
    );
    await sendAuthenticatedServiceResult(req, res, result, 200, 'paired-login');
    return true;
  }
  return false;
}

async function handleAuthPairCancelPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/pair/cancel') {
    const body = await readJsonBody(req);
    sendJson(res, 200, servicesRuntime.accountService.cancelDevicePairing(body?.id, body?.claimToken));
    return true;
  }
  return false;
}
export {
  handleAuthPairStartPost,
  handleAuthPairInspectPost,
  handleAuthPairApprovePost,
  handleAuthPairStatusGet,
  handleAuthPairCancelPost
};
