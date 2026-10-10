import path from 'node:path';
import http from 'node:http';
import { URL } from 'node:url';
import { handleAccountApi } from './account-api.js';
import { handleNotebookApi, canReadNotebookAsset } from './notebooks.js';
import { handlePlanningApi } from './planning.js';
import { assetExtensionForMime, writeAssetBuffer } from './asset-storage.js';
import { isWebpBuffer } from './avatar-validation.js';
import { boardCacheBytes } from './board-cache.js';
import { boardCacheStats, boards, clients } from './board-registry.js';
import { createCanvas, ensureGuideCanvas, listCanvases } from './catalog.js';
import { requireCatalogBoardId } from './catalog-access.js';
import {
  deleteCanvas,
  importGuestCanvases,
  renameCanvas,
  reorderCanvases,
  setCanvasVisibility
} from './catalog-mutations.js';
import {AMAP_ENABLED} from './amap-config.js';
import {ASSETS_DIR,ASSET_UPLOAD_CONCURRENCY,ASSET_UPLOAD_GRANT_TTL_MS,BOARD_CACHE_MAX_BYTES,BOARD_CACHE_MAX_ENTRIES,CANVAS_PREVIEW_STYLE_VERSION,HTTPS_ONLY_ENABLED,HTTP_HEADERS_TIMEOUT_MS,HTTP_KEEP_ALIVE_TIMEOUT_MS,HTTP_REQUEST_TIMEOUT_MS,MAX_CANVASES,MAX_CANVAS_NAME_LENGTH,MAX_CLIENTS_PER_BOARD,MAX_DATA_DIR_BYTES,MAX_HTTP_CONNECTIONS,MAX_PREVIEW_SIZE,MAX_PROCESS_RSS_BYTES,MAX_REQUESTS_PER_SOCKET,MAX_WEBSOCKET_CLIENTS,MIN_FREE_DISK_BYTES,PUBLIC_BASE_URL,TRUSTED_PROXY_IPS} from './config.js';
import {PRIVATE_IMMUTABLE_CACHE_CONTROL} from './static-policy.js';
import { handleResendWebhook } from './email-webhook.js';
import { prepareEncryptedApiRequest } from './encrypted-request.js';
import { readJsonBody, readRequestBody } from './http-body.js';
import { sendBuffer, sendJson } from './http-response.js';
import { HSTS_HEADER, clientIp, enforceOriginForRequest } from './http-security.js';
import { handleAmapApi, handleAmapSecurityProxy } from './navigation-api.js';
import { ProtocolError } from './protocol-error.js';
import { apiEncryptionHandshakeLimit, apiWriteIpLimit, assetUploadIpLimit, searchIpLimit } from './rate-limits.js';
import { recoveryStatus } from './recovery-state.js';
import { resourceStatus } from './resource-state.js';
import { assertWriteCapacity, refreshResourceStatus } from './resources.js';
import { httpServerRuntime } from './runtime/http-server.js';
import { serverStateRuntime } from './runtime/server-state.js';
import { servicesRuntime } from './runtime/services.js';
import { searchCanvases } from './search.js';
import { apiPayloadEncryption } from './services.js';
import { serveStatic, serveStaticFile } from './static-assets.js';
import { handleXmindApi } from './xmind-api.js';

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const remoteAddress = String(req.socket.remoteAddress || '');
    const forwardedProtocol = TRUSTED_PROXY_IPS.has(remoteAddress)
      ? String(req.headers['x-forwarded-proto'] || '')
          .split(',')[0]
          .trim()
          .toLowerCase()
      : '';
    const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(req.headers.host || ''));
    if (HTTPS_ONLY_ENABLED && !localHost && !req.socket.encrypted && forwardedProtocol !== 'https') {
      const redirect = new URL(req.url, PUBLIC_BASE_URL.origin);
      redirect.protocol = 'https:';
      res.writeHead(308, { location: redirect.href, 'cache-control': 'no-store', ...HSTS_HEADER });
      res.end();
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/webhooks/resend') {
      await assertWriteCapacity(Number(req.headers['content-length']) || 64 * 1024);
      await handleResendWebhook(req, res);
      return;
    }
    enforceOriginForRequest(req);
    if (req.method === 'POST' && requestUrl.pathname === '/api/transport/handshake') {
      if (!apiEncryptionHandshakeLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'Too many transport handshakes.', code: 'RATE_LIMITED' });
        return;
      }
      const body = await readJsonBody(req, 8 * 1024);
      if (body?.version !== 'v1')
        throw Object.assign(new Error('Unsupported transport version.'), {
          statusCode: 400,
          code: 'API_ENCRYPTION_VERSION_INVALID'
        });
      sendJson(res, 200, apiPayloadEncryption.handshake(body?.clientPublicKey));
      return;
    }
    await prepareEncryptedApiRequest(req, res, requestUrl);
    const apiWrite = requestUrl.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (apiWrite && !apiWriteIpLimit(clientIp(req))) {
      sendJson(res, 429, { error: 'Too many write requests.', code: 'RATE_LIMITED' });
      return;
    }
    const capacityExempt =
      req.method === 'DELETE' ||
      ['/api/auth/logout', '/api/auth/pair/cancel', '/api/sharing/leave'].includes(requestUrl.pathname);
    if (apiWrite && !capacityExempt) {
      await assertWriteCapacity(Number(req.headers['content-length']) || 16 * 1024);
    }
    if (await handleAmapSecurityProxy(req, res, requestUrl)) return;
    if (await handleXmindApi(req, res, requestUrl)) return;
    if (await handleAccountApi(req, res, requestUrl)) return;
    if (await handleNotebookApi(req, res, requestUrl)) return;
    if (await handlePlanningApi(req, res, requestUrl)) return;
    if (await handleAmapApi(req, res, requestUrl)) return;
    if (req.method === 'GET' && requestUrl.pathname === '/api/canvases') {
      const session = servicesRuntime.accountService.requireSession(req);
      if (session?.userId) ensureGuideCanvas(session.userId);
      sendJson(res, 200, {
        canvases: listCanvases(session?.userId),
        maximum: MAX_CANVASES,
        maximumNameLength: MAX_CANVAS_NAME_LENGTH
      });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/search') {
      const session = servicesRuntime.accountService.requireSession(req);
      if (!searchIpLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'Too many search requests.', code: 'RATE_LIMITED' });
        return;
      }
      sendJson(
        res,
        200,
        searchCanvases(
          requestUrl.searchParams.get('q'),
          requestUrl.searchParams.get('limit'),
          requestUrl.searchParams.get('cursor'),
          session?.userId
        )
      );
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/imports/guest') {
      const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
      if (!session)
        throw Object.assign(new Error('Guest import requires an account.'), { statusCode: 401, code: 'AUTH_REQUIRED' });
      const body = await readJsonBody(req, 64 * 1024 * 1024);
      sendJson(res, 201, await importGuestCanvases(session.userId, body));
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/canvases') {
      const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      const canvas = createCanvas(body?.name, session?.userId, body?.visibility);
      sendJson(res, 201, { canvas, maximum: MAX_CANVASES });
      return;
    }

    if (req.method === 'PUT' && requestUrl.pathname === '/api/canvases/order') {
      const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      const canvases = reorderCanvases(body?.ids, session?.userId);
      sendJson(res, 200, { canvases, maximum: MAX_CANVASES });
      return;
    }

    const canvasMatch = requestUrl.pathname.match(/^\/api\/canvases\/([a-zA-Z0-9_-]{1,64})$/);
    if (canvasMatch && req.method === 'PATCH') {
      const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      let canvas;
      if (body?.name !== undefined) canvas = renameCanvas(canvasMatch[1], body.name, session?.userId);
      if (body?.visibility !== undefined)
        canvas = setCanvasVisibility(canvasMatch[1], body.visibility, session?.userId);
      if (!canvas)
        throw Object.assign(new Error('No canvas changes were supplied.'), {
          statusCode: 400,
          code: 'EMPTY_CANVAS_PATCH'
        });
      sendJson(res, 200, { canvas });
      return;
    }

    if (canvasMatch && req.method === 'DELETE') {
      const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
      const canvases = await deleteCanvas(canvasMatch[1], session?.userId);
      sendJson(res, 200, { ok: true, canvases, maximum: MAX_CANVASES });
      return;
    }

    const previewMatch = requestUrl.pathname.match(/^\/api\/canvases\/([a-zA-Z0-9_-]{1,64})\/preview$/);
    if (previewMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const session = servicesRuntime.accountService.requireSession(req);
      const boardId = requireCatalogBoardId(previewMatch[1], session?.userId);
      const row = servicesRuntime.database
        .prepare('SELECT preview_webp, preview_version, preview_style_version FROM canvas_catalog WHERE board_id = ?')
        .get(boardId);
      const storedStyleVersion = Number(row?.preview_style_version);
      if (
        !row?.preview_webp ||
        !Number.isSafeInteger(storedStyleVersion) ||
        storedStyleVersion < 1 ||
        storedStyleVersion > CANVAS_PREVIEW_STYLE_VERSION
      ) {
        sendJson(res, 404, { error: 'Canvas preview is not available.', code: 'PREVIEW_NOT_FOUND' });
        return;
      }
      const previewVersion = Number(row.preview_version);
      const requestedVersion = requestUrl.searchParams.get('v');
      const requestedStyle = requestUrl.searchParams.get('style');
      if (
        (requestedVersion !== null && requestedVersion !== String(previewVersion)) ||
        (requestedStyle !== null && requestedStyle !== String(storedStyleVersion))
      ) {
        sendJson(res, 404, {
          error: 'Canvas preview version is no longer available.',
          code: 'PREVIEW_VERSION_NOT_FOUND'
        });
        return;
      }
      const versionedUrl = requestedVersion === String(previewVersion);
      sendBuffer(req, res, 200, row.preview_webp, {
        'content-type': 'image/webp',
        'cache-control': versionedUrl ? PRIVATE_IMMUTABLE_CACHE_CONTROL : 'private, no-cache',
        vary: 'Cookie',
        etag: `"canvas-${boardId}-${previewVersion}-${storedStyleVersion}"`
      });
      return;
    }

    if (previewMatch && req.method === 'PUT') {
      const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
      const boardId = requireCatalogBoardId(previewMatch[1], session?.userId);
      if (session && !servicesRuntime.accountService.canManageBoard(session.userId, boardId)) {
        throw Object.assign(new Error('Only the canvas owner can update its preview.'), {
          statusCode: 403,
          code: 'CANVAS_OWNER_REQUIRED'
        });
      }
      const mimeType = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (mimeType !== 'image/webp') {
        sendJson(res, 415, { error: 'Canvas preview must be a WebP image.', code: 'INVALID_PREVIEW' });
        return;
      }
      const previewStyleVersion = Number(req.headers['x-canvas-preview-style-version']);
      if (!Number.isSafeInteger(previewStyleVersion) || previewStyleVersion !== CANVAS_PREVIEW_STYLE_VERSION) {
        sendJson(res, 409, { error: 'Canvas preview style is outdated.', code: 'PREVIEW_STYLE_OUTDATED' });
        return;
      }
      const preview = await readRequestBody(req, MAX_PREVIEW_SIZE);
      if (!isWebpBuffer(preview)) {
        sendJson(res, 400, { error: 'Canvas preview is not a valid WebP image.', code: 'INVALID_PREVIEW' });
        return;
      }
      servicesRuntime.database
        .prepare(
          'UPDATE canvas_catalog SET preview_webp = ?, preview_version = preview_version + 1, preview_style_version = ? WHERE board_id = ?'
        )
        .run(preview, previewStyleVersion, boardId);
      const row = servicesRuntime.database
        .prepare('SELECT preview_version, preview_style_version FROM canvas_catalog WHERE board_id = ?')
        .get(boardId);
      sendJson(res, 200, {
        ok: true,
        previewVersion: Number(row.preview_version),
        previewStyleVersion: Number(row.preview_style_version)
      });
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && requestUrl.pathname.startsWith('/assets/')) {
      const session = servicesRuntime.accountService.requireSession(req);
      let assetName;
      try {
        assetName = decodeURIComponent(requestUrl.pathname.slice('/assets/'.length));
      } catch {
        sendJson(res, 400, { error: 'Bad asset path.' });
        return;
      }
      if (!/^[a-f0-9]{64}(?:\.(?:png|jpg|webp)|\.(?:thumb|medium)\.webp)$/.test(assetName)) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (session) {
        const assetId = assetName.slice(0, 64);
        const references = servicesRuntime.database
          .prepare("SELECT owner_id FROM asset_references WHERE owner_type = 'board' AND asset_id = ?")
          .all(assetId);
        const temporaryGrant = servicesRuntime.database
          .prepare('SELECT 1 FROM asset_upload_grants WHERE asset_id = ? AND user_id = ? AND expires_at > ?')
          .get(assetId, session.userId, Date.now());
        if (
          !temporaryGrant &&
          !canReadNotebookAsset(servicesRuntime.database, session.userId, assetId) &&
          !references.some((reference) =>
            servicesRuntime.accountService.canAccessBoard(session.userId, reference.owner_id)
          )
        ) {
          sendJson(res, 404, { error: 'Not found' });
          return;
        }
      }
      const served = await serveStaticFile(
        req,
        res,
        path.join(ASSETS_DIR, assetName),
        PRIVATE_IMMUTABLE_CACHE_CONTROL,
        { validator: `sha256-${assetName}` }
      );
      if (!served) sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
      await refreshResourceStatus();
      sendJson(res, 200, {
        ok: !serverStateRuntime.isShuttingDown && resourceStatus.storageWritable && resourceStatus.memoryWritable,
        storage: 'sqlite-wal',
        maxClientsPerBoard: MAX_CLIENTS_PER_BOARD,
        maxWebSocketClients: MAX_WEBSOCKET_CLIENTS,
        boards: boards.size,
        boardCache: {
          bytes: boardCacheBytes(),
          maxBytes: BOARD_CACHE_MAX_BYTES,
          maxEntries: BOARD_CACHE_MAX_ENTRIES,
          ...boardCacheStats
        },
        clients: clients.size,
        resources: {
          dataDirectoryBytes: resourceStatus.dataDirectoryBytes,
          maxDataDirectoryBytes: MAX_DATA_DIR_BYTES,
          freeDiskBytes: resourceStatus.freeDiskBytes,
          minimumFreeDiskBytes: MIN_FREE_DISK_BYTES,
          rssBytes: resourceStatus.rssBytes,
          maxProcessRssBytes: MAX_PROCESS_RSS_BYTES,
          heapUsedBytes: resourceStatus.heapUsedBytes,
          externalBytes: resourceStatus.externalBytes,
          writable: resourceStatus.storageWritable && resourceStatus.memoryWritable,
          reason: resourceStatus.reason,
          checkedAt: resourceStatus.checkedAt
        },
        uptimeSeconds: Math.round(process.uptime()),
        recovery: recoveryStatus,
        amap: {
          enabled: servicesRuntime.amapService.enabled,
          configured: AMAP_ENABLED,
          circuitOpen: servicesRuntime.amapService.circuitUntil > Date.now(),
          circuitRetryAt:
            servicesRuntime.amapService.circuitUntil > Date.now()
              ? new Date(servicesRuntime.amapService.circuitUntil).toISOString()
              : null
        }
      });
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/assets') {
      const assetSession = servicesRuntime.accountService.requireSession(req, { requireCsrf: true });
      const mimeType = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!assetExtensionForMime(mimeType)) {
        sendJson(res, 415, { error: 'Unsupported image type.' });
        return;
      }
      if (!assetUploadIpLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'Too many asset uploads.', code: 'ASSET_UPLOAD_RATE_LIMITED' });
        return;
      }
      if (httpServerRuntime.assetUploadsInFlight >= ASSET_UPLOAD_CONCURRENCY) {
        sendJson(res, 429, { error: 'Asset uploads are busy.', code: 'ASSET_BUSY' });
        return;
      }
      httpServerRuntime.assetUploadsInFlight += 1;
      try {
        const body = await readRequestBody(req);
        const asset = await writeAssetBuffer(body, mimeType);
        if (assetSession) {
          servicesRuntime.database
            .prepare(
              `
            INSERT INTO asset_upload_grants (asset_id, user_id, expires_at) VALUES (?, ?, ?)
            ON CONFLICT(asset_id, user_id) DO UPDATE SET expires_at = excluded.expires_at
          `
            )
            .run(asset.assetId, assetSession.userId, Date.now() + ASSET_UPLOAD_GRANT_TTL_MS);
        }
        sendJson(res, 201, { ok: true, ...asset });
      } finally {
        httpServerRuntime.assetUploadsInFlight -= 1;
      }
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'API endpoint not found', code: 'API_NOT_FOUND' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const status = error.statusCode || (error instanceof ProtocolError ? 400 : 500);
    if (status >= 500) console.error(error);
    if (!res.headersSent) {
      const exposed = status < 500 || error.expose === true;
      sendJson(
        res,
        status,
        {
          error: exposed ? error.message : 'Internal server error',
          ...(exposed && error.code ? { code: error.code } : {}),
          ...(exposed && error.resetAt ? { resetAt: error.resetAt } : {})
        },
        error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {}
      );
    } else res.destroy();
  }
});

server.maxConnections = MAX_HTTP_CONNECTIONS;

server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;

server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;

server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;

server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;

export { server };

