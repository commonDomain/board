import crypto from 'node:crypto';
import { URL } from 'node:url';
import { AmapError } from '../amap-service.js';
import { getBoard } from './board-cache.js';
import { requireCatalogBoardId } from './catalog-access.js';
import {AMAP_JS_KEY,AMAP_JS_SECURITY_CODE,AMAP_MAX_RESPONSE_BYTES,AMAP_REQUEST_TIMEOUT_MS} from './amap-config.js';
import {PUBLIC_BASE_URL} from './config.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { HSTS_HEADER, clientIp } from './http-security.js';
import { servicesRuntime } from './runtime/services.js';
import { publicAssetUrl } from './static-assets.js';
import { cleanString, isSafeId } from './validation.js';

function escapeHtmlAttribute(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
  );
}

function navigationItemForRequest(userId, boardIdInput, itemIdInput, allowedTypes) {
  const boardId = requireCatalogBoardId(boardIdInput, userId);
  const itemId = cleanString(itemIdInput, 128, '');
  if (!isSafeId(itemId)) throw Object.assign(new Error('导航组件无效'), { statusCode: 400, code: 'AMAP_INVALID_ITEM' });
  const board = getBoard(boardId);
  const item = board.state.items.find((entry) => entry.id === itemId && allowedTypes.includes(entry.type));
  if (!item) throw Object.assign(new Error('导航组件不存在'), { statusCode: 404, code: 'AMAP_ITEM_NOT_FOUND' });
  return { board, item };
}

async function handleAmapApi(req, res, requestUrl) {
  if (!requestUrl.pathname.startsWith('/api/navigation')) return false;
  const requireAmapSession = (options = {}) => {
    const session = servicesRuntime.accountService.requireSession(req, options);
    if (!session?.userId)
      throw Object.assign(new Error('登录后才能使用导航工具'), { statusCode: 401, code: 'AMAP_AUTH_REQUIRED' });
    return session;
  };
  if (req.method === 'GET' && requestUrl.pathname === '/api/navigation/capabilities') {
    const session = requireAmapSession();
    sendJson(res, 200, servicesRuntime.amapService.capabilities(session.userId, clientIp(req)));
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/navigation/map-frame') {
    const session = requireAmapSession();
    requireCatalogBoardId(requestUrl.searchParams.get('boardId'), session.userId);
    const itemId = cleanString(requestUrl.searchParams.get('itemId'), 128, '');
    if (!isSafeId(itemId))
      throw Object.assign(new Error('导航组件无效'), { statusCode: 400, code: 'AMAP_INVALID_ITEM' });
    if (!servicesRuntime.amapService.enabled)
      throw new AmapError('导航功能尚未配置', { statusCode: 503, code: 'AMAP_DISABLED' });
    servicesRuntime.amapService.consumeBurst(session.userId, clientIp(req));
    const nonce = crypto.randomBytes(18).toString('base64url');
    const html = `<!doctype html><html lang="zh-CN" data-item-id="${escapeHtmlAttribute(itemId)}" data-instance-nonce="${nonce}" data-amap-key="${escapeHtmlAttribute(AMAP_JS_KEY)}" data-service-host="${escapeHtmlAttribute(new URL('_AMapService', PUBLIC_BASE_URL).href)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><script src="${publicAssetUrl('api-transport.js')}"></script><script src="${publicAssetUrl('app-security.js')}"></script><link rel="stylesheet" href="${publicAssetUrl('amap-frame.css')}"><title>地图</title></head><body><div id="map" role="application" aria-label="高德地图"></div><div id="status" role="status">正在加载地图…</div><script src="${publicAssetUrl('amap-frame.js')}" defer></script></body></html>`;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'content-security-policy':
        "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://webapi.amap.com https://jsapi-service.amap.com; style-src 'self' 'unsafe-inline' https://webapi.amap.com; img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; connect-src 'self' https://*.amap.com https://*.autonavi.com; font-src 'self' data: https://*.amap.com; worker-src 'self' blob: https://*.amap.com https://*.autonavi.com; object-src 'none'; base-uri 'none'; frame-ancestors 'self';",
      'x-content-type-options': 'nosniff',
      ...HSTS_HEADER
    });
    res.end(html);
    return true;
  }
  const actions = {
    '/api/navigation/suggest': { types: ['amap-search', 'amap-route'], method: 'suggest' },
    '/api/navigation/search': { types: ['amap-search', 'amap-route'], method: 'search' },
    '/api/navigation/locate': { types: ['amap-map'], method: 'locate' },
    '/api/navigation/routes': { types: ['amap-route'], method: 'route' }
  };
  const action = actions[requestUrl.pathname];
  if (req.method === 'POST' && action) {
    const session = requireAmapSession({ requireCsrf: true });
    const body = await readJsonBody(req, 32 * 1024);
    navigationItemForRequest(session.userId, body?.boardId, body?.itemId, action.types);
    const result = await servicesRuntime.amapService[action.method](body, session.userId, clientIp(req));
    sendJson(res, 200, result);
    return true;
  }
  sendJson(res, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  return true;
}

async function handleAmapSecurityProxy(req, res, requestUrl) {
  if (!requestUrl.pathname.startsWith('/_AMapService')) return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    return true;
  }
  const session = servicesRuntime.accountService.requireSession(req);
  if (!session?.userId || !servicesRuntime.amapService.enabled) {
    sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
    return true;
  }
  servicesRuntime.amapService.consumeBurst(session.userId, clientIp(req));
  const suffix = requestUrl.pathname.slice('/_AMapService'.length) || '/';
  if (/^\/v3\/log\/init\/?$/.test(suffix)) {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  if (!/^\/v4\/map\/styles\/?$/.test(suffix)) {
    sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
    return true;
  }
  const target = new URL(`https://webapi.amap.com${suffix}`);
  for (const [key, value] of requestUrl.searchParams) {
    if (key !== 'jscode') target.searchParams.append(key, value);
  }
  target.searchParams.set('jscode', AMAP_JS_SECURITY_CODE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AMAP_REQUEST_TIMEOUT_MS);
  try {
    const { upstream, body } = await servicesRuntime.amapService.withConcurrency(async () => {
      const response = await fetch(target, {
        signal: controller.signal,
        headers: { accept: req.headers.accept || '*/*' }
      });
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > AMAP_MAX_RESPONSE_BYTES)
        throw new Error('AMap proxy response too large');
      const responseBody = Buffer.from(await response.arrayBuffer());
      if (responseBody.length > AMAP_MAX_RESPONSE_BYTES) throw new Error('AMap proxy response too large');
      return { upstream: response, body: responseBody };
    });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      ...HSTS_HEADER
    });
    res.end(body);
  } catch {
    sendJson(res, 502, { error: '地图安全代理请求失败', code: 'AMAP_PROXY_FAILED' });
  } finally {
    clearTimeout(timer);
  }
  return true;
}

export { escapeHtmlAttribute, handleAmapApi, handleAmapSecurityProxy, navigationItemForRequest };

