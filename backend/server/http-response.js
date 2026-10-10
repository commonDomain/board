import { ifNoneMatchMatches } from './http-cache.js';
import { HSTS_HEADER } from './http-security.js';
import { apiPayloadEncryption } from './services.js';

function sendJson(res, status, body, extraHeaders = {}) {
  const serialized = Buffer.from(JSON.stringify(body), 'utf8');
  if (res.apiEncryptionContext) {
    const context = res.apiEncryptionContext;
    const encrypted = apiPayloadEncryption.encryptResponse(context, context.method, context.path, status, serialized);
    res.writeHead(status, {
      'content-type': 'application/octet-stream',
      'content-length': encrypted.ciphertext.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-muse-encrypted': 'v1',
      'x-muse-session': context.sessionId,
      'x-muse-iv': encrypted.iv,
      'x-muse-timestamp': String(encrypted.timestamp),
      'x-muse-original-content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
      ...HSTS_HEADER
    });
    res.end(encrypted.ciphertext);
    return;
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
    ...HSTS_HEADER
  });
  res.end(serialized);
}

function sendBuffer(req, res, status, body, headers = {}) {
  const responseHeaders = {
    'content-type': 'application/octet-stream',
    'content-length': body.length,
    'x-content-type-options': 'nosniff',
    ...headers,
    ...HSTS_HEADER
  };
  if (responseHeaders.etag && ifNoneMatchMatches(req.headers['if-none-match'], responseHeaders.etag)) {
    delete responseHeaders['content-length'];
    res.writeHead(304, responseHeaders);
    res.end();
    return;
  }
  res.writeHead(status, responseHeaders);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export { sendBuffer, sendJson };
