import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import publication from '../static-publication.js';

const { readStaticPublication, publicationUnavailable } = publication;

async function collectStaticAssets(directory, prefix = '', assets = new Map(), documents = new Map(), minifyJs = false) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) { await collectStaticAssets(absolute, relative, assets, documents, minifyJs); continue; }
    if (!entry.isFile()) continue;
    const [sourceBody, stat] = await Promise.all([fs.readFile(absolute), fs.stat(absolute)]);
    if (path.extname(entry.name).toLowerCase() === '.html') {
      documents.set(relative, { hash: crypto.createHash('sha256').update(sourceBody).digest('hex'), size: stat.size, mtimeMs: stat.mtimeMs, source: sourceBody.toString('utf8') });
      continue;
    }
    let body = sourceBody;
    if (minifyJs && path.extname(entry.name).toLowerCase() === '.js' && !relative.startsWith('vendor/')) {
      const { transform } = await import('esbuild');
      const transformed = await transform(sourceBody.toString('utf8'), { loader: 'js', minify: true, drop: ['debugger'], target: 'es2022', legalComments: 'none' });
      body = Buffer.from(transformed.code, 'utf8');
    }
    assets.set(relative, { filePath: absolute, hash: crypto.createHash('sha256').update(body).digest('hex'),
      size: stat.size, mtimeMs: stat.mtimeMs, body: body === sourceBody ? null : body });
  }
}

function createStaticAssetRegistry({ directory, minifyJs = false, fingerprintConfig = {}, idLength = 24, checkInterval = 5000 }) {
  const root = path.dirname(directory);
  let snapshot = { assets: new Map(), documents: new Map(), buildId: null };
  let checkedAt = -Infinity, checkedPublication = null, refreshing = null;

  async function changed(target = directory, prefix = '', seen = new Set(), candidate = snapshot) {
    const entries = await fs.readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(target, entry.name);
      if (entry.isDirectory()) { if (await changed(absolute, relative, seen, candidate)) return true; continue; }
      if (!entry.isFile()) continue;
      const current = candidate.assets.get(relative) || candidate.documents.get(relative);
      if (!current) return true;
      const stat = await fs.stat(absolute);
      if (stat.size !== current.size || stat.mtimeMs !== current.mtimeMs) return true;
      seen.add(relative);
    }
    return prefix === '' && seen.size !== candidate.assets.size + candidate.documents.size;
  }

  async function refresh(force = false) {
    // Even cache hits check the O(1) publication gate, never a whole directory.
    const before = await readStaticPublication(root);
    if (!force && snapshot.buildId && before === checkedPublication && performance.now() - checkedAt < checkInterval) return snapshot;
    if (!refreshing) {
      refreshing = (async () => {
        let candidate = snapshot;
        if (force || !snapshot.buildId || await changed()) {
          candidate = { assets: new Map(), documents: new Map() };
          await collectStaticAssets(directory, '', candidate.assets, candidate.documents, minifyJs);
          const hash = crypto.createHash('sha256');
          for (const [relative, asset] of [...candidate.assets, ...candidate.documents].sort(([a], [b]) => a.localeCompare(b))) {
            hash.update(relative).update('\0').update(asset.hash).update('\0');
          }
          hash.update(JSON.stringify(fingerprintConfig));
          candidate.buildId = hash.digest('hex').slice(0, idLength);
          if (await changed(directory, '', new Set(), candidate)) throw publicationUnavailable();
        }
        if (await readStaticPublication(root) !== before) throw publicationUnavailable();
        snapshot = candidate;
        checkedPublication = before;
        checkedAt = performance.now();
        return snapshot;
      })().catch(error => {
        if (error.code === 'ENOENT' || error.code === 'ESTALE') throw publicationUnavailable();
        throw error;
      }).finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  return { initialize: () => refresh(true), ensureCurrent: () => refresh(), changed,
    get snapshot() { return snapshot; }, checkPublication: () => readStaticPublication(root) };
}

export { createStaticAssetRegistry, collectStaticAssets };
