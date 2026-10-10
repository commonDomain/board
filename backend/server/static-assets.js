import zlib from 'node:zlib';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import {COMPRESSIBLE_EXT,IMMUTABLE_CACHE_CONTROL,MIME_TYPES,STATIC_BUILD_ID_LENGTH} from './static-policy.js';
import {JS_MINIFY_ENABLED,PUBLIC_BASE_URL,PUBLIC_DIR,WALLPAPER_DRIFT_ENABLED,WALLPAPER_DRIFT_PARALLAX} from './config.js';
import { appendVary, ifNoneMatchMatches } from './http-cache.js';
import { HSTS_HEADER, securityHeaders } from './http-security.js';

let staticBuildId = null;

let staticAssets = new Map();

let staticAssetsRefresh = null;

async function collectStaticAssets(directory, prefix = '', assets = staticAssets) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectStaticAssets(absolute, relative, assets);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() === '.html') continue;
    const [sourceBody, stat] = await Promise.all([fsp.readFile(absolute), fsp.stat(absolute)]);
    let body = sourceBody;
    if (JS_MINIFY_ENABLED && path.extname(entry.name).toLowerCase() === '.js' && !relative.startsWith('vendor/')) {
      const { transform } = await import('esbuild');
      const transformed = await transform(sourceBody.toString('utf8'), {
        loader: 'js',
        minify: true,
        drop: ['debugger'],
        target: 'es2022',
        legalComments: 'none'
      });
      body = Buffer.from(transformed.code, 'utf8');
    }
    assets.set(relative, {
      filePath: absolute,
      hash: crypto.createHash('sha256').update(body).digest('hex'),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      body: body === sourceBody ? null : body
    });
  }
}

async function initializeStaticAssets() {
  const nextAssets = new Map();
  await collectStaticAssets(PUBLIC_DIR, '', nextAssets);
  const buildHash = crypto.createHash('sha256');
  for (const [relative, asset] of Array.from(nextAssets.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    buildHash.update(relative).update('\0').update(asset.hash).update('\0');
  }
  staticAssets = nextAssets;
  staticBuildId = buildHash.digest('hex').slice(0, STATIC_BUILD_ID_LENGTH);
}

async function staticAssetsChanged(directory, prefix = '', seen = new Set()) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await staticAssetsChanged(absolute, relative, seen)) return true;
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() === '.html') continue;
    const current = staticAssets.get(relative);
    if (!current) return true;
    const stat = await fsp.stat(absolute);
    if (stat.size !== current.size || stat.mtimeMs !== current.mtimeMs) return true;
    seen.add(relative);
  }
  return prefix === '' && seen.size !== staticAssets.size;
}

async function ensureStaticAssetsCurrent() {
  if (!staticAssetsRefresh) {
    staticAssetsRefresh = (async () => {
      if (await staticAssetsChanged(PUBLIC_DIR)) await initializeStaticAssets();
    })().finally(() => {
      staticAssetsRefresh = null;
    });
  }
  return staticAssetsRefresh;
}

function fingerprintedAssetUrl(relative) {
  return `static/${staticBuildId}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

function publicAssetUrl(relative) {
  return new URL(fingerprintedAssetUrl(relative), PUBLIC_BASE_URL).href;
}

function rewriteStaticHtml(source) {
  let html = String(source).replace(/\b(src|href)=(['"])([^'"]+)\2/g, (match, attribute, quote, url) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return match;
    const parsed = url.match(/^([^?#]+)([?#].*)?$/);
    if (!parsed) return match;
    const relative = parsed[1].replace(/^\.\//, '');
    if (!staticAssets.has(relative)) return match;
    return `${attribute}=${quote}${fingerprintedAssetUrl(relative)}${parsed[2] || ''}${quote}`;
  });
  html = html.replace(
    /<html\b(?![^>]*\bdata-static-build=)/i,
    `<html data-static-build="${staticBuildId}" data-wallpaper-drift="${WALLPAPER_DRIFT_ENABLED ? 'on' : 'off'}"` +
      ` data-wallpaper-parallax="${WALLPAPER_DRIFT_PARALLAX}"`
  );
  return html;
}

async function gzipBuffer(body) {
  return new Promise((resolve, reject) => {
    zlib.gzip(body, (error, compressed) => (error ? reject(error) : resolve(compressed)));
  });
}

async function serveHtmlFile(req, res, filePath) {
  await ensureStaticAssetsCurrent();
  let source;
  try {
    source = await fsp.readFile(filePath, 'utf8');
  } catch {
    return false;
  }
  const identity = Buffer.from(rewriteStaticHtml(source), 'utf8');
  const useGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = useGzip ? await gzipBuffer(identity) : identity;
  const etag = `"${crypto.createHash('sha256').update(body).digest('base64url')}"`;
  const headers = securityHeaders({
    'content-type': MIME_TYPES['.html'],
    'content-length': body.length,
    'cache-control': 'no-cache',
    etag,
    vary: 'Accept-Encoding',
    ...(useGzip ? { 'content-encoding': 'gzip' } : {})
  });
  if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
    delete headers['content-length'];
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

async function serveStaticFile(req, res, filePath, cacheControl, options = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  if (
    options.expectedStat &&
    (stat.size !== options.expectedStat.size || stat.mtimeMs !== options.expectedStat.mtimeMs)
  ) {
    res.writeHead(410, { 'cache-control': 'no-store', ...HSTS_HEADER });
    res.end('Static asset changed; reload the document for the current build.');
    return true;
  }
  const extension = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[extension] || 'application/octet-stream';
  const useGzip = COMPRESSIBLE_EXT.has(extension) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const representation = useGzip ? 'gzip' : 'identity';
  const validator = options.validator || `${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}`;
  const etag = `W/"${validator}-${representation}"`;
  const headers = securityHeaders({
    'content-type': mime,
    'cache-control': cacheControl,
    ...(String(cacheControl).startsWith('private') ? { vary: 'Cookie' } : {}),
    etag
  });
  if (useGzip) {
    headers['content-encoding'] = 'gzip';
    headers.vary = appendVary(headers.vary, 'Accept-Encoding');
  }
  if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  if (options.body) {
    const body = useGzip ? await gzipBuffer(options.body) : options.body;
    res.end(body);
    return true;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  if (useGzip)
    stream
      .pipe(zlib.createGzip())
      .on('error', () => res.destroy())
      .pipe(res);
  else stream.pipe(res);
  return true;
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const fingerprinted = pathname.match(/^\/static\/([a-f0-9]+)\/(.+)$/);
  if (fingerprinted) {
    const asset = fingerprinted[1] === staticBuildId ? staticAssets.get(fingerprinted[2]) : null;
    if (!asset) {
      res.writeHead(404, { 'cache-control': 'no-store', ...HSTS_HEADER });
      res.end('Not found');
      return;
    }
    await serveStaticFile(req, res, asset.filePath, IMMUTABLE_CACHE_CONTROL, {
      validator: asset.hash,
      expectedStat: asset,
      body: asset.body
    });
    return;
  }
  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (path.extname(filePath).toLowerCase() === '.html') {
    if (await serveHtmlFile(req, res, filePath)) return;
  } else if (
    await serveStaticFile(req, res, filePath, 'no-cache', {
      body: staticAssets.get(relative.replace(/\\/g, '/'))?.body || null
    })
  ) {
    return;
  }
  if (pathname !== '/index.html' && (await serveHtmlFile(req, res, path.join(PUBLIC_DIR, 'index.html')))) {
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}

export {
  collectStaticAssets,
  ensureStaticAssetsCurrent,
  fingerprintedAssetUrl,
  gzipBuffer,
  initializeStaticAssets,
  publicAssetUrl,
  rewriteStaticHtml,
  serveHtmlFile,
  serveStatic,
  serveStaticFile,
  staticAssetsChanged
};

