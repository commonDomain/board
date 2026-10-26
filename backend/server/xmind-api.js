import { XMindError } from '../xmind-service.js';
import { getBoard } from './board-cache.js';
import { requireCatalogBoardId } from './catalog-access.js';
import { XMIND_MCP_ENABLED } from './config.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { HSTS_HEADER } from './http-security.js';
import { ensureXmindBoardLink } from './integration-links.js';
import { xmindDetachGrants } from './integration-state.js';
import { servicesRuntime } from './runtime/services.js';
import { cleanString } from './validation.js';

function sendXmindOAuthPage(res, ok) {
  const payload = JSON.stringify({ type: 'muse:xmind-oauth', ok: Boolean(ok) }).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XMind 授权</title></head><body><p>${ok ? 'XMind 授权成功，可以关闭此窗口。' : 'XMind 授权未完成，请返回画板重试。'}</p><script>if(window.opener){window.opener.postMessage(${payload},location.origin);window.close();}</script></body></html>`;
  res.writeHead(ok ? 200 : 400, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...HSTS_HEADER
  });
  res.end(html);
}

async function handleXmindApi(req, res, requestUrl) {
  if (!requestUrl.pathname.startsWith('/api/xmind')) return false;
  if (req.method === 'GET' && requestUrl.pathname === '/api/xmind/oauth/callback') {
    try {
      await servicesRuntime.xmindService.finishOAuth(requestUrl.searchParams);
      sendXmindOAuthPage(res, true);
    } catch {
      sendXmindOAuthPage(res, false);
    }
    return true;
  }
  const session = servicesRuntime.accountService.requireSession(req, {
    requireCsrf: !['GET', 'HEAD'].includes(req.method)
  });
  if (req.method === 'GET' && requestUrl.pathname === '/api/xmind/status') {
    sendJson(res, 200, servicesRuntime.xmindService.status(session.userId));
    return true;
  }
  if (!XMIND_MCP_ENABLED) throw new XMindError('XMind MCP 尚未启用', { code: 'XMIND_DISABLED', statusCode: 503 });
  if (req.method === 'POST' && requestUrl.pathname === '/api/xmind/oauth/start') {
    const body = await readJsonBody(req, 4 * 1024);
    sendJson(
      res,
      200,
      await servicesRuntime.xmindService.startOAuth(session.userId, cleanString(body?.provider, 16, 'global'))
    );
    return true;
  }
  if (req.method === 'DELETE' && requestUrl.pathname === '/api/xmind/connection') {
    servicesRuntime.xmindService.disconnect(session.userId);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/xmind/maps') {
    const query = cleanString(requestUrl.searchParams.get('q'), 200, '').toLocaleLowerCase();
    const maps = await servicesRuntime.xmindService.listMaps(session.userId, {
      force: requestUrl.searchParams.get('refresh') === '1'
    });
    const filtered = query ? maps.filter((entry) => entry.name.toLocaleLowerCase().includes(query)) : maps;
    sendJson(res, 200, {
      maps: filtered.map(({ thumbnailUrl, ...entry }) => ({ ...entry, thumbnailAvailable: Boolean(thumbnailUrl) })),
      scope: 'recent'
    });
    return true;
  }
  const thumbnailMatch = requestUrl.pathname.match(/^\/api\/xmind\/maps\/([^/]+)\/thumbnail$/);
  if (req.method === 'GET' && thumbnailMatch) {
    const remoteMapId = decodeURIComponent(thumbnailMatch[1]).slice(0, 512);
    const thumbnail = await servicesRuntime.xmindService.thumbnail(session.userId, remoteMapId);
    res.writeHead(200, {
      'content-type': thumbnail.contentType,
      'content-length': thumbnail.body.length,
      'cache-control': 'private, max-age=60',
      'x-content-type-options': 'nosniff',
      ...HSTS_HEADER
    });
    res.end(thumbnail.body);
    return true;
  }
  const readMatch = requestUrl.pathname.match(/^\/api\/xmind\/maps\/([^/]+)\/read$/);
  if (req.method === 'POST' && readMatch) {
    const body = await readJsonBody(req, 32 * 1024);
    if (body?.boardId) requireCatalogBoardId(body.boardId, session.userId);
    const remoteMapId = decodeURIComponent(readMatch[1]).slice(0, 512);
    const result = await servicesRuntime.xmindService.readMap(session.userId, remoteMapId);
    sendJson(res, 200, { remoteMapId, ...result, markdown: undefined });
    return true;
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/xmind/links/check') {
    const body = await readJsonBody(req, 32 * 1024);
    const boardId = requireCatalogBoardId(body?.boardId, session.userId);
    const itemIds = Array.isArray(body?.itemIds)
      ? body.itemIds.map((value) => cleanString(value, 128, '')).filter(Boolean)
      : [];
    sendJson(
      res,
      200,
      await servicesRuntime.xmindService.checkRemoteChanges(session.userId, boardId, itemIds, {
        force: body?.force === true
      })
    );
    return true;
  }
  const linkMatch = requestUrl.pathname.match(/^\/api\/xmind\/links\/([^/]+)\/(preview|refresh|sync|detach)$/);
  if (req.method === 'POST' && linkMatch) {
    const body = await readJsonBody(req, 64 * 1024);
    const boardId = requireCatalogBoardId(body?.boardId, session.userId);
    const itemId = decodeURIComponent(linkMatch[1]).slice(0, 128);
    const ensured = ensureXmindBoardLink(boardId, itemId, session.userId);
    const link = ensured.link;
    if (linkMatch[2] === 'preview') {
      const board = getBoard(boardId);
      const item = ensured.item || board.state.items.find((entry) => entry.id === itemId && entry.type === 'mindmap');
      if (!item) throw new XMindError('连接脑图不存在', { code: 'XMIND_LINK_NOT_FOUND', statusCode: 404 });
      sendJson(
        res,
        200,
        servicesRuntime.xmindService.syncSummary(session.userId, boardId, itemId, item.tree, item.relations || [])
      );
      return true;
    }
    if (linkMatch[2] === 'detach') {
      const grantKey = `${session.userId}:${boardId}:${itemId}`;
      const expiresAt = Date.now() + 30_000;
      xmindDetachGrants.set(grantKey, expiresAt);
      const cleanup = setTimeout(() => {
        if (xmindDetachGrants.get(grantKey) === expiresAt) xmindDetachGrants.delete(grantKey);
      }, 30_000);
      cleanup.unref?.();
      sendJson(res, 200, { ok: true, expiresIn: 30 });
      return true;
    }
    if (linkMatch[2] === 'refresh') {
      const latest = await servicesRuntime.xmindService.acceptRemote(session.userId, boardId, itemId);
      sendJson(res, 200, { remoteMapId: link.remote_map_id, ...latest, markdown: undefined });
      return true;
    }
    const board = getBoard(boardId);
    const item = board.state.items.find((entry) => entry.id === itemId && entry.type === 'mindmap');
    if (!item) throw new XMindError('连接脑图不存在', { code: 'XMIND_LINK_NOT_FOUND', statusCode: 404 });
    const result = await servicesRuntime.xmindService.sync(
      session.userId,
      boardId,
      itemId,
      cleanString(body?.expectedHash, 128, ''),
      item.tree,
      item.relations || [],
      body?.force === true
    );
    sendJson(res, 200, result);
    return true;
  }
  sendJson(res, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  return true;
}

export { handleXmindApi, sendXmindOAuthPage };
