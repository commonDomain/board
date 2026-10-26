import { EMAIL_AUTH_ENABLED } from './config.js';
import { readRequestBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { servicesRuntime } from './runtime/services.js';
import { emailService } from './services.js';

async function handleResendWebhook(req, res) {
  if (!EMAIL_AUTH_ENABLED) {
    sendJson(res, 404, { error: 'API endpoint not found', code: 'API_NOT_FOUND' });
    return;
  }
  const rawBody = await readRequestBody(req, 64 * 1024);
  const headers = {
    id: String(req.headers['svix-id'] || ''),
    timestamp: String(req.headers['svix-timestamp'] || ''),
    signature: String(req.headers['svix-signature'] || '')
  };
  if (!headers.id || !headers.timestamp || !headers.signature) {
    sendJson(res, 400, { error: 'Webhook signature headers are missing.', code: 'WEBHOOK_SIGNATURE_INVALID' });
    return;
  }
  let event;
  try {
    event = emailService.verifyWebhook(rawBody.toString('utf8'), headers);
  } catch {
    sendJson(res, 400, { error: 'Webhook signature is invalid.', code: 'WEBHOOK_SIGNATURE_INVALID' });
    return;
  }
  sendJson(res, 200, servicesRuntime.accountService.recordResendWebhook(headers.id, event));
}

export { handleResendWebhook };
