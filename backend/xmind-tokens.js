'use strict';
const crypto = require('node:crypto');
const {
  MCP_PROVIDERS,
  providerConfig,
  XMindError,
  base64url,
  keyId,
  isAuthorizationFailure
} = require('./xmind-document');

function encrypt(service, value, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', service.key, iv);
  cipher.setAAD(Buffer.from(String(aad)));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    kid: keyId(service.key),
    iv: base64url(iv),
    tag: base64url(cipher.getAuthTag()),
    body: base64url(body)
  });
}

function decrypt(service, value, aad) {
  const envelope = JSON.parse(value);
  if (envelope.v !== 1)
    throw new XMindError('XMind 凭证版本无法读取，请重新授权', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
  const candidates = envelope.kid ? service.keys.filter((key) => keyId(key) === envelope.kid) : service.keys;
  for (const key of candidates) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
      decipher.setAAD(Buffer.from(String(aad)));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(envelope.body, 'base64url')), decipher.final()]).toString('utf8')
      );
    } catch {}
  }
  throw new XMindError('XMind 凭证无法解密，请重新授权', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
}

function status(service, userId) {
  const row = service.database
    .prepare('SELECT provider, status, connected_at, updated_at FROM xmind_connections WHERE user_id = ?')
    .get(userId);
  const provider = row?.provider && MCP_PROVIDERS[row.provider] ? row.provider : null;
  return {
    enabled: service.enabled,
    connected: row?.status === 'connected',
    reauthorize: row?.status === 'reauthorize',
    connectedAt: row?.connected_at || null,
    provider,
    providerLabel: provider ? MCP_PROVIDERS[provider].label : null
  };
}

function disconnect(service, userId) {
  service.database.prepare('DELETE FROM xmind_connections WHERE user_id = ?').run(userId);
  service.listCache.delete(userId);
}

function tokenRow(service, userId) {
  const row = service.database
    .prepare('SELECT provider, token_ciphertext, status FROM xmind_connections WHERE user_id = ?')
    .get(userId);
  if (!row || row.status !== 'connected')
    throw new XMindError('请重新连接 XMind', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
  return row;
}

async function accessToken(service, userId, forceRefresh = false) {
  const row = service.tokenRow(userId);
  let token;
  try {
    token = service.decrypt(row.token_ciphertext, `token:${userId}`);
  } catch {
    service.markReauthorize(userId);
    throw new XMindError('XMind 凭证无法读取，请重新授权', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
  }
  if (!forceRefresh && Number(token.expires_at) > Date.now() + 30_000) return token.access_token;
  if (!token.refresh_token) {
    service.markReauthorize(userId);
    throw new XMindError('XMind 授权已过期，请重新授权', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
  }
  try {
    const provider = providerConfig(row.provider);
    const serverInfo = await service.oauthServerInfo(provider.id);
    const client = await service.clientInfo(serverInfo);
    const { refreshAuthorization } = await import('@modelcontextprotocol/client');
    const refreshed = await refreshAuthorization(serverInfo.authorizationServerUrl, {
      metadata: serverInfo.authorizationServerMetadata,
      clientInformation: client,
      refreshToken: token.refresh_token,
      resource: new URL(provider.mcpUrl),
      fetchFn: service.boundedOAuthFetch.bind(service)
    });
    const now = Date.now();
    token = {
      ...token,
      ...refreshed,
      refresh_token: refreshed.refresh_token || token.refresh_token,
      obtained_at: now,
      expires_at: now + Math.max(30, Number(refreshed.expires_in) || 3600) * 1000
    };
    service.database
      .prepare("UPDATE xmind_connections SET token_ciphertext=?, status='connected', updated_at=? WHERE user_id=?")
      .run(service.encrypt(token, `token:${userId}`), now, userId);
    return token.access_token;
  } catch (error) {
    if (isAuthorizationFailure(error)) {
      service.markReauthorize(userId);
      throw new XMindError('XMind 授权已失效，请重新授权', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
    }
    if (error instanceof XMindError) throw error;
    if (error?.name === 'AbortError' || /timeout/i.test(String(error?.code || error?.message || ''))) {
      throw new XMindError('XMind 请求超时，请稍后重试', { code: 'XMIND_TIMEOUT', statusCode: 504 });
    }
    throw new XMindError('XMind 授权服务暂时不可用，请稍后重试', { code: 'XMIND_UNAVAILABLE', statusCode: 503 });
  }
}

function markReauthorize(service, userId) {
  service.database
    .prepare("UPDATE xmind_connections SET status='reauthorize', updated_at=? WHERE user_id=?")
    .run(Date.now(), userId);
}
module.exports = { encrypt, decrypt, status, disconnect, tokenRow, accessToken, markReauthorize };
