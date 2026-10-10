import { URL } from 'node:url';
import { ALLOWED_ORIGINS, HSTS_MAX_AGE_SECONDS, TRUSTED_PROXY_IPS } from './config.js';

const HSTS_HEADER =
  HSTS_MAX_AGE_SECONDS > 0 ? { 'strict-transport-security': `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains` } : {};

function clientIp(req) {
  const remoteAddress = String(req.socket.remoteAddress || '').trim();
  if (!TRUSTED_PROXY_IPS.has(remoteAddress)) return remoteAddress || 'unknown';
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  for (let index = forwarded.length - 1; index >= 0; index -= 1) {
    if (!TRUSTED_PROXY_IPS.has(forwarded[index])) return forwarded[index];
  }
  if (forwarded.length) return forwarded[0];
  return remoteAddress || 'unknown';
}

function isOriginAllowed(req, options = {}) {
  const origin = req.headers.origin;
  const strict = ALLOWED_ORIGINS.size > 0;
  if (!origin) {
    // Browsers always send Origin on WebSocket handshakes and on
    // non-GET/HEAD fetches. Origin-less requests are either same-origin
    // GET/HEAD (image tags, list fetches) or non-browser clients; only the
    // strict mode's write gate and the WebSocket gate reject them.
    return !strict || !options.requireOrigin;
  }
  if (strict) {
    return ALLOWED_ORIGINS.has(origin);
  }
  try {
    const originUrl = new URL(origin);
    const host = req.headers.host || 'localhost';
    return originUrl.host === host;
  } catch {
    return false;
  }
}

function enforceOriginForRequest(req) {
  if (ALLOWED_ORIGINS.size === 0) {
    return; // Default mode keeps the historical behavior: HTTP is open.
  }
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
  if (!isOriginAllowed(req, { requireOrigin: isWrite })) {
    throw Object.assign(new Error('Origin is not allowed.'), {
      statusCode: 403,
      code: 'ORIGIN_FORBIDDEN'
    });
  }
}

function securityHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-src 'self' https://www.kdocs.cn https://*.kdocs.cn https://*.wps.cn; object-src 'none'; base-uri 'self'; frame-ancestors 'self';",
    ...extra,
    ...HSTS_HEADER
  };
}

export { HSTS_HEADER, clientIp, enforceOriginForRequest, isOriginAllowed, securityHeaders };
