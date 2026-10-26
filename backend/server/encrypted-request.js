import { MAX_ENCRYPTED_API_PAYLOAD } from './config.js';
import { readRequestBody } from './http-body.js';
import { apiPayloadEncryption } from './services.js';

async function prepareEncryptedApiRequest(req, res, requestUrl) {
  if (!apiPayloadEncryption.enabled || apiPayloadEncryption.isExempt(req.method, requestUrl.pathname)) return;
  if (req.headers['x-muse-encrypted'] !== 'v1') {
    throw Object.assign(new Error('This API requires an encrypted payload.'), {
      statusCode: 426,
      code: 'API_ENCRYPTION_REQUIRED'
    });
  }
  let ciphertext;
  if (req.method === 'GET' || req.method === 'HEAD') {
    ciphertext = Buffer.from(String(req.headers['x-muse-payload'] || ''), 'base64url');
  } else {
    ciphertext = await readRequestBody(req, MAX_ENCRYPTED_API_PAYLOAD);
  }
  if (!ciphertext.length)
    throw Object.assign(new Error('Encrypted API payload is missing.'), {
      statusCode: 400,
      code: 'API_ENCRYPTION_INVALID'
    });
  const decrypted = apiPayloadEncryption.decryptRequest({
    method: req.method,
    path: requestUrl.pathname,
    headers: req.headers,
    ciphertext
  });
  if (decrypted.query && (!decrypted.query.startsWith('?') || decrypted.query.length > 65_536)) {
    throw Object.assign(new Error('Encrypted API query is invalid.'), {
      statusCode: 400,
      code: 'API_ENCRYPTION_INVALID'
    });
  }
  requestUrl.search = decrypted.query;
  req.decryptedApiBody = decrypted.body;
  req.headers['content-type'] = decrypted.contentType || 'application/octet-stream';
  req.headers['content-length'] = String(decrypted.body.length);
  res.apiEncryptionContext = {
    sessionId: decrypted.sessionId,
    responseKey: decrypted.responseKey,
    method: req.method,
    path: requestUrl.pathname
  };
}

export { prepareEncryptedApiRequest };
