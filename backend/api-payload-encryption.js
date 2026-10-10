'use strict';

const crypto = require('node:crypto');

const VERSION = 'v1';
const CURVE = 'prime256v1';

function decodeKey(value) {
  const key = Buffer.from(String(value || '').trim(), 'base64');
  if (key.length !== 32) throw new Error('API_PAYLOAD_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

function privateKeyFromSeed(seed) {
  let candidate = Buffer.from(seed);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const ecdh = crypto.createECDH(CURVE);
      ecdh.setPrivateKey(candidate);
      return ecdh;
    } catch {
      candidate = crypto.createHash('sha256').update(candidate).update(String(attempt)).digest();
    }
  }
  throw new Error('API payload encryption key cannot be used for ECDH');
}

function aad({ sessionId, direction, method, path, status = 0, timestamp }) {
  return Buffer.from([VERSION, sessionId, direction, method, path, status, timestamp].join('\n'));
}

function deriveKey(sharedSecret, salt, direction) {
  return Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, `muse-api-${VERSION}:${direction}`, 32));
}

function encrypt(key, plaintext, authenticationData) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(authenticationData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString('base64url'), ciphertext };
}

function decrypt(key, ivText, ciphertext, authenticationData) {
  const iv = Buffer.from(String(ivText || ''), 'base64url');
  if (iv.length !== 12 || ciphertext.length < 16) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(authenticationData);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
}

class ApiPayloadEncryption {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.ttlMs = Number(options.ttlMs) || 10 * 60_000;
    this.maxSessions = Number(options.maxSessions) || 10_000;
    this.clockSkewMs = Number(options.clockSkewMs) || 60_000;
    this.sessions = new Map();
    if (this.enabled) {
      this.serverEcdh = privateKeyFromSeed(decodeKey(options.key));
      this.serverPublicKey = this.serverEcdh.getPublicKey(undefined, 'uncompressed');
    }
  }

  isExempt(method, pathname) {
    if (!String(pathname).startsWith('/api/')) return true;
    if (pathname === '/api/transport/handshake' || pathname === '/api/health' || pathname === '/api/webhooks/resend' || pathname === '/api/xmind/oauth/callback') return true;
    if (!['GET', 'HEAD'].includes(String(method).toUpperCase())) return false;
    return /^\/api\/(?:assets\/[^/]+|avatars\/[^/]+|canvases\/[^/]+\/preview|xmind\/maps\/[^/]+\/thumbnail|navigation\/map-frame)$/.test(pathname);
  }

  handshake(clientPublicKeyText) {
    if (!this.enabled) return { enabled: false, version: VERSION };
    const clientPublicKey = Buffer.from(String(clientPublicKeyText || ''), 'base64url');
    if (clientPublicKey.length !== 65) throw Object.assign(new Error('Invalid transport public key'), { statusCode: 400, code: 'API_ENCRYPTION_HANDSHAKE_INVALID' });
    let sharedSecret;
    try { sharedSecret = this.serverEcdh.computeSecret(clientPublicKey); } catch {
      throw Object.assign(new Error('Invalid transport public key'), { statusCode: 400, code: 'API_ENCRYPTION_HANDSHAKE_INVALID' });
    }
    this.prune();
    const sessionId = crypto.randomBytes(18).toString('base64url');
    const salt = crypto.randomBytes(32);
    const expiresAt = Date.now() + this.ttlMs;
    this.sessions.set(sessionId, {
      requestKey: deriveKey(sharedSecret, salt, 'request'),
      responseKey: deriveKey(sharedSecret, salt, 'response'),
      expiresAt,
      nonces: new Map()
    });
    return { enabled: true, version: VERSION, sessionId, serverPublicKey: this.serverPublicKey.toString('base64url'), salt: salt.toString('base64url'), expiresAt };
  }

  prune(now = Date.now()) {
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
  }

  decryptRequest({ method, path, headers, ciphertext }) {
    const sessionId = String(headers['x-muse-session'] || '');
    const timestamp = Number(headers['x-muse-timestamp']);
    const iv = String(headers['x-muse-iv'] || '');
    const session = this.sessions.get(sessionId);
    const now = Date.now();
    if (!session || session.expiresAt <= now) {
      this.sessions.delete(sessionId);
      throw Object.assign(new Error('Encrypted API session expired'), { statusCode: 409, code: 'API_ENCRYPTION_SESSION_EXPIRED' });
    }
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > this.clockSkewMs) {
      throw Object.assign(new Error('Encrypted API request timestamp is invalid'), { statusCode: 400, code: 'API_ENCRYPTION_TIMESTAMP_INVALID' });
    }
    const nonce = `${timestamp}:${iv}`;
    if (session.nonces.has(nonce)) throw Object.assign(new Error('Encrypted API request was already used'), { statusCode: 409, code: 'API_ENCRYPTION_REPLAYED' });
    for (const [value, seenAt] of session.nonces) if (now - seenAt > this.clockSkewMs) session.nonces.delete(value);
    session.nonces.set(nonce, now);
    let plaintext;
    try {
      plaintext = decrypt(session.requestKey, iv, ciphertext, aad({ sessionId, direction: 'request', method, path, timestamp }));
    } catch {
      throw Object.assign(new Error('Encrypted API request authentication failed'), { statusCode: 400, code: 'API_ENCRYPTION_INVALID' });
    }
    if (plaintext.length < 4) throw Object.assign(new Error('Encrypted API request is malformed'), { statusCode: 400, code: 'API_ENCRYPTION_INVALID' });
    const headerLength = plaintext.readUInt32BE(0);
    if (headerLength > 65_536 || plaintext.length < 4 + headerLength) {
      throw Object.assign(new Error('Encrypted API request is malformed'), { statusCode: 400, code: 'API_ENCRYPTION_INVALID' });
    }
    let envelope;
    try { envelope = JSON.parse(plaintext.subarray(4, 4 + headerLength).toString('utf8')); } catch {
      throw Object.assign(new Error('Encrypted API request is malformed'), { statusCode: 400, code: 'API_ENCRYPTION_INVALID' });
    }
    return {
      sessionId,
      responseKey: session.responseKey,
      query: typeof envelope.query === 'string' ? envelope.query : '',
      contentType: typeof envelope.contentType === 'string' ? envelope.contentType.slice(0, 256) : '',
      body: plaintext.subarray(4 + headerLength)
    };
  }

  encryptResponse(context, method, path, status, body) {
    const timestamp = Date.now();
    const encrypted = encrypt(context.responseKey, body, aad({ sessionId: context.sessionId, direction: 'response', method, path, status, timestamp }));
    return { ...encrypted, timestamp };
  }
}

module.exports = { ApiPayloadEncryption };
