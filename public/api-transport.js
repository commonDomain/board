(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const VERSION = 'v1';
  let transportPromise = null;

  function bytesToBase64Url(bytes) {
    let binary = '';
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function isExempt(method, pathname) {
    if (!pathname.startsWith('/api/')) return true;
    if (pathname === '/api/transport/handshake' || pathname === '/api/health' || pathname === '/api/webhooks/resend' || pathname === '/api/xmind/oauth/callback') return true;
    if (!['GET', 'HEAD'].includes(method)) return false;
    return /^\/api\/(?:assets\/[^/]+|avatars\/[^/]+|canvases\/[^/]+\/preview|xmind\/maps\/[^/]+\/thumbnail|navigation\/map-frame)$/.test(pathname);
  }

  function additionalData(sessionId, direction, method, path, status, timestamp) {
    return encoder.encode([VERSION, sessionId, direction, method, path, status, timestamp].join('\n'));
  }

  async function importAesKey(secretBits, salt, direction) {
    const material = await crypto.subtle.importKey('raw', secretBits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(`muse-api-${VERSION}:${direction}`) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function createTransport() {
    if (!window.isSecureContext || !crypto?.subtle) return { enabled: false };
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const clientPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const response = await nativeFetch('/api/transport/handshake', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: VERSION, clientPublicKey: bytesToBase64Url(clientPublicKey) })
    });
    if (!response.ok) throw new Error('无法建立接口加密会话');
    const handshake = await response.json();
    if (!handshake.enabled) return { enabled: false };
    const serverPublicKey = await crypto.subtle.importKey('raw', base64UrlToBytes(handshake.serverPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: serverPublicKey }, pair.privateKey, 256);
    const salt = base64UrlToBytes(handshake.salt);
    return {
      enabled: true,
      sessionId: handshake.sessionId,
      expiresAt: Number(handshake.expiresAt) || 0,
      requestKey: await importAesKey(sharedSecret, salt, 'request'),
      responseKey: await importAesKey(sharedSecret, salt, 'response')
    };
  }

  async function transport() {
    if (!transportPromise) transportPromise = createTransport().catch((error) => { transportPromise = null; throw error; });
    const value = await transportPromise;
    if (value.enabled && value.expiresAt - Date.now() < 15_000) {
      transportPromise = createTransport();
      return transportPromise;
    }
    return value;
  }

  async function encryptedFetch(input, init, retried = false) {
    const source = new Request(input, init);
    const url = new URL(source.url, location.href);
    const method = source.method.toUpperCase();
    if (url.origin !== location.origin || isExempt(method, url.pathname)) return nativeFetch(input, init);
    const session = await transport();
    if (!session.enabled) return nativeFetch(input, init);

    const body = ['GET', 'HEAD'].includes(method) ? new Uint8Array() : new Uint8Array(await source.clone().arrayBuffer());
    const contentType = source.headers.get('content-type') || '';
    const envelopeHeader = encoder.encode(JSON.stringify({ query: url.search, contentType }));
    const envelope = new Uint8Array(4 + envelopeHeader.length + body.length);
    new DataView(envelope.buffer).setUint32(0, envelopeHeader.length);
    envelope.set(envelopeHeader, 4);
    envelope.set(body, 4 + envelopeHeader.length);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const timestamp = Date.now();
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM', iv,
      additionalData: additionalData(session.sessionId, 'request', method, url.pathname, 0, timestamp)
    }, session.requestKey, envelope));

    const headers = new Headers(source.headers);
    headers.delete('content-length');
    headers.delete('content-type');
    headers.set('x-muse-encrypted', VERSION);
    headers.set('x-muse-session', session.sessionId);
    headers.set('x-muse-iv', bytesToBase64Url(iv));
    headers.set('x-muse-timestamp', String(timestamp));
    const requestInit = {
      method, headers, credentials: source.credentials, cache: source.cache, redirect: source.redirect,
      referrer: source.referrer, referrerPolicy: source.referrerPolicy, integrity: source.integrity,
      keepalive: source.keepalive, signal: source.signal
    };
    if (['GET', 'HEAD'].includes(method)) headers.set('x-muse-payload', bytesToBase64Url(ciphertext));
    else {
      headers.set('content-type', 'application/octet-stream');
      requestInit.body = ciphertext;
    }
    url.search = '';
    const response = await nativeFetch(url.href, requestInit);
    if (response.headers.get('x-muse-encrypted') !== VERSION) {
      if (!retried && response.status === 409) {
        const problem = await response.clone().json().catch(() => null);
        if (problem?.code === 'API_ENCRYPTION_SESSION_EXPIRED') {
          transportPromise = null;
          return encryptedFetch(input, init, true);
        }
      }
      return response;
    }
    const responseSessionId = response.headers.get('x-muse-session') || '';
    const responseTimestamp = Number(response.headers.get('x-muse-timestamp'));
    const responseIv = base64UrlToBytes(response.headers.get('x-muse-iv'));
    if (responseSessionId !== session.sessionId || !Number.isSafeInteger(responseTimestamp)) throw new Error('接口加密响应无效');
    let plaintext;
    try {
      plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: responseIv,
        additionalData: additionalData(session.sessionId, 'response', method, url.pathname, response.status, responseTimestamp)
      }, session.responseKey, await response.arrayBuffer());
    } catch {
      throw new Error('接口加密响应校验失败');
    }
    const responseHeaders = new Headers(response.headers);
    for (const name of ['x-muse-encrypted', 'x-muse-session', 'x-muse-iv', 'x-muse-timestamp', 'content-length']) responseHeaders.delete(name);
    responseHeaders.set('content-type', response.headers.get('x-muse-original-content-type') || 'application/json; charset=utf-8');
    responseHeaders.delete('x-muse-original-content-type');
    return new Response(plaintext, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  }

  window.fetch = encryptedFetch;
})();
