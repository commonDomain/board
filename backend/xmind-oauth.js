'use strict';
const crypto = require('node:crypto');
const { providerConfig, isProviderHost, XMindError, base64url, sha256 } = require('./xmind-document');

async function boundedOAuthFetch(service, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), service.timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > service.maxResponseBytes)
      throw new XMindError('XMind 响应过大', { code: 'XMIND_RESPONSE_TOO_LARGE' });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > service.maxResponseBytes)
      throw new XMindError('XMind 响应过大', { code: 'XMIND_RESPONSE_TOO_LARGE' });
    return new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (error) {
    if (error instanceof XMindError) throw error;
    if (error.name === 'AbortError') throw new XMindError('XMind 请求超时', { code: 'XMIND_TIMEOUT', statusCode: 504 });
    throw new XMindError('无法连接 XMind 服务', { code: 'XMIND_UNAVAILABLE' });
  } finally {
    clearTimeout(timer);
  }
}

async function oauthServerInfo(service, providerId = 'global') {
  const provider = providerConfig(providerId);
  const cached = service.oauthCache?.get(provider.id);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const { discoverOAuthServerInfo } = await import('@modelcontextprotocol/client');
  let value;
  try {
    value = await discoverOAuthServerInfo(new URL(provider.mcpUrl), { fetchFn: service.boundedOAuthFetch.bind(service) });
  } catch (error) {
    if (error instanceof XMindError) throw error;
    throw new XMindError('无法发现 XMind OAuth 服务', { code: 'XMIND_OAUTH_DISCOVERY_FAILED' });
  }
  const authorizationServerUrl = new URL(value.authorizationServerUrl);
  if (authorizationServerUrl.protocol !== 'https:' || !isProviderHost(authorizationServerUrl.hostname, provider)) {
    throw new XMindError('XMind OAuth 服务地址校验失败', { code: 'XMIND_OAUTH_ISSUER_INVALID' });
  }
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (!value.authorizationServerMetadata?.[field]) continue;
    const endpoint = new URL(value.authorizationServerMetadata[field]);
    if (endpoint.protocol !== 'https:' || !isProviderHost(endpoint.hostname, provider)) {
      throw new XMindError(`XMind OAuth ${field} 校验失败`, { code: 'XMIND_OAUTH_ENDPOINT_INVALID' });
    }
  }
  if (
    value.resourceMetadata?.resource &&
    new URL(value.resourceMetadata.resource).href !== new URL(provider.mcpUrl).href
  ) {
    throw new XMindError('XMind OAuth resource 校验失败', { code: 'XMIND_OAUTH_RESOURCE_INVALID' });
  }
  const normalized = {
    ...value,
    authorizationServerUrl: authorizationServerUrl.href,
    provider: provider.id,
    mcpUrl: provider.mcpUrl
  };
  service.oauthCache ||= new Map();
  service.oauthCache.set(provider.id, { value: normalized, expiresAt: Date.now() + 5 * 60_000 });
  return normalized;
}

async function clientInfo(service, serverInfo = null) {
  serverInfo ||= await service.oauthServerInfo();
  const issuer = String(serverInfo.authorizationServerMetadata?.issuer || serverInfo.authorizationServerUrl);
  const stored = service.database
    .prepare('SELECT client_id, metadata_json FROM xmind_oauth_client WHERE issuer = ?')
    .get(issuer);
  if (stored) return { client_id: stored.client_id, ...JSON.parse(stored.metadata_json) };
  const { registerClient } = await import('@modelcontextprotocol/client');
  const clientMetadata = {
    client_name: 'Muse Board',
    redirect_uris: [service.callbackUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web'
  };
  let registered;
  try {
    registered = await registerClient(serverInfo.authorizationServerUrl, {
      metadata: serverInfo.authorizationServerMetadata,
      clientMetadata,
      scope: 'mcp:connect',
      fetchFn: service.boundedOAuthFetch.bind(service)
    });
  } catch (error) {
    if (error instanceof XMindError) throw error;
    throw new XMindError('XMind OAuth 动态客户端注册失败', { code: 'XMIND_REGISTRATION_FAILED' });
  }
  if (!registered.client_id)
    throw new XMindError('XMind 未返回 OAuth client_id', { code: 'XMIND_REGISTRATION_FAILED' });
  service.database
    .prepare(
      'INSERT OR REPLACE INTO xmind_oauth_client (issuer, client_id, metadata_json, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(issuer, registered.client_id, JSON.stringify(registered), Date.now());
  return registered;
}

async function startOAuth(service, userId, providerId = 'global') {
  if (!service.enabled) throw new XMindError('XMind MCP 尚未启用', { code: 'XMIND_DISABLED', statusCode: 503 });
  const provider = providerConfig(providerId);
  const serverInfo = await service.oauthServerInfo(provider.id);
  const client = await service.clientInfo(serverInfo);
  const { startAuthorization } = await import('@modelcontextprotocol/client');
  const state = base64url(crypto.randomBytes(32));
  const authorization = await startAuthorization(serverInfo.authorizationServerUrl, {
    metadata: serverInfo.authorizationServerMetadata,
    clientInformation: client,
    redirectUrl: service.callbackUrl,
    scope: 'mcp:connect',
    state,
    resource: new URL(provider.mcpUrl)
  });
  const now = Date.now();
  service.database.prepare('DELETE FROM xmind_oauth_flows WHERE expires_at <= ? OR user_id = ?').run(now, userId);
  service.database
    .prepare(
      'INSERT INTO xmind_oauth_flows (state_hash, user_id, provider, verifier_ciphertext, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      sha256(state),
      userId,
      provider.id,
      service.encrypt({ verifier: authorization.codeVerifier }, `flow:${userId}`),
      now + 10 * 60_000,
      now
    );
  return {
    authorizationUrl: authorization.authorizationUrl.href,
    provider: provider.id,
    providerLabel: provider.label
  };
}

async function finishOAuth(service, params) {
  const state = String(params.get('state') || '');
  const code = String(params.get('code') || '');
  const issuer = String(params.get('iss') || '');
  const row = service.database.prepare('SELECT * FROM xmind_oauth_flows WHERE state_hash = ?').get(sha256(state));
  if (!row || Number(row.expires_at) <= Date.now() || !code)
    throw new XMindError('XMind 授权已过期，请重新发起', { code: 'XMIND_OAUTH_STATE_INVALID', statusCode: 400 });
  service.database.prepare('DELETE FROM xmind_oauth_flows WHERE state_hash = ?').run(row.state_hash);
  const provider = providerConfig(row.provider);
  const serverInfo = await service.oauthServerInfo(provider.id);
  const client = await service.clientInfo(serverInfo);
  const { verifier } = service.decrypt(row.verifier_ciphertext, `flow:${row.user_id}`);
  const { exchangeAuthorization } = await import('@modelcontextprotocol/client');
  let token;
  try {
    token = await exchangeAuthorization(serverInfo.authorizationServerUrl, {
      metadata: serverInfo.authorizationServerMetadata,
      clientInformation: client,
      authorizationCode: code,
      iss: issuer || undefined,
      codeVerifier: verifier,
      redirectUri: service.callbackUrl,
      resource: new URL(provider.mcpUrl),
      fetchFn: service.boundedOAuthFetch.bind(service)
    });
  } catch (error) {
    if (error instanceof XMindError) throw error;
    throw new XMindError('XMind OAuth 授权码兑换失败', { code: 'XMIND_OAUTH_FAILED', statusCode: 401 });
  }
  const now = Date.now();
  const normalized = {
    ...token,
    obtained_at: now,
    expires_at: now + Math.max(30, Number(token.expires_in) || 3600) * 1000
  };
  service.database
    .prepare(
      `INSERT INTO xmind_connections (user_id, provider, token_ciphertext, status, connected_at, updated_at) VALUES (?, ?, ?, 'connected', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,token_ciphertext=excluded.token_ciphertext,status='connected',connected_at=excluded.connected_at,updated_at=excluded.updated_at`
    )
    .run(row.user_id, provider.id, service.encrypt(normalized, `token:${row.user_id}`), now, now);
  service.listCache.delete(row.user_id);
  return { userId: row.user_id };
}
module.exports = { boundedOAuthFetch, oauthServerInfo, clientInfo, startOAuth, finishOAuth };
