import path from 'node:path';
import fsp from 'node:fs/promises';
import { assetMimeFromFilename, collectStoredAssetReferences } from './asset-references.js';
import { assetDerivativeWrites, assetWrites } from './asset-storage.js';
import { ASSETS_DIR, ASSET_GC_MIN_AGE_MS } from './config.js';
import { backupRuntime } from './runtime/backup.js';
import { servicesRuntime } from './runtime/services.js';

async function collectOrphanedAssets() {
  if (backupRuntime.backupInFlight) return { removedFiles: 0, removedBytes: 0, skipped: 'backup-in-progress' };
  let references;
  try {
    references = collectStoredAssetReferences();
  } catch (error) {
    if (error.code !== 'ASSET_GC_UNSAFE_REFERENCES') throw error;
    console.warn(error.message);
    return { removedFiles: 0, removedBytes: 0, skipped: 'unreadable-backup-manifest' };
  }
  const referencedAssetIds = new Set(Array.from(references, (filename) => filename.slice(0, 64)));
  const cutoff = Date.now() - ASSET_GC_MIN_AGE_MS;
  const entries = await fsp.readdir(ASSETS_DIR, { withFileTypes: true });
  let removedFiles = 0;
  let removedBytes = 0;

  for (const entry of entries) {
    const filename = entry.name.toLowerCase();
    if (!entry.isFile() || !/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(filename)) {
      continue;
    }
    const assetId = filename.slice(0, 64);
    const persistedReferences = Number(
      servicesRuntime.database
        .prepare('SELECT COALESCE(SUM(ref_count), 0) AS count FROM asset_references WHERE asset_id = ?')
        .get(assetId)?.count || 0
    );
    if (
      references.has(filename) ||
      persistedReferences > 0 ||
      assetWrites.has(`${assetId}:${path.extname(filename)}`) ||
      assetDerivativeWrites.has(assetId)
    ) {
      servicesRuntime.database.prepare('UPDATE assets SET orphaned_at = NULL WHERE asset_id = ?').run(assetId);
      continue;
    }
    const filePath = path.join(ASSETS_DIR, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      const row = servicesRuntime.database.prepare('SELECT orphaned_at FROM assets WHERE asset_id = ?').get(assetId);
      // Filesystems may expose sub-millisecond mtimes. Normalize them before
      // writing to STRICT SQLite INTEGER columns.
      const fileTimestamp = Math.trunc(stat.mtimeMs);
      const storedOrphanedAt = Number(row?.orphaned_at);
      const orphanedAt = Number.isSafeInteger(storedOrphanedAt) ? storedOrphanedAt : fileTimestamp;
      if (!row) {
        servicesRuntime.database
          .prepare(
            `
          INSERT OR IGNORE INTO assets
            (asset_id, original_filename, mime_type, byte_size, width, height, created_at, orphaned_at)
          VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
        `
          )
          .run(
            assetId,
            filename,
            assetMimeFromFilename(filename),
            Math.trunc(stat.size),
            fileTimestamp,
            Math.trunc(orphanedAt)
          );
      } else if (!row.orphaned_at) {
        servicesRuntime.database
          .prepare('UPDATE assets SET orphaned_at = ? WHERE asset_id = ?')
          .run(Date.now(), assetId);
        continue;
      }
      if (orphanedAt > cutoff) continue;
      await fsp.unlink(filePath);
      await Promise.all([
        fsp.unlink(path.join(ASSETS_DIR, `${assetId}.thumb.webp`)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        }),
        fsp.unlink(path.join(ASSETS_DIR, `${assetId}.medium.webp`)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        })
      ]);
      removedFiles += 1;
      removedBytes += stat.size;
      servicesRuntime.database.prepare('DELETE FROM assets WHERE asset_id = ?').run(assetId);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  // A crashed or interrupted upload can leave derivatives without an original.
  // They are not covered by the original-file pass above, so reap them once the
  // same grace period has elapsed and no live/backup reference protects them.
  for (const entry of entries) {
    const filename = entry.name.toLowerCase();
    const match = filename.match(/^([a-f0-9]{64})\.(?:thumb|medium)\.webp$/);
    if (!entry.isFile() || !match) continue;
    const assetId = match[1];
    const persistedReferences = Number(
      servicesRuntime.database
        .prepare('SELECT COALESCE(SUM(ref_count), 0) AS count FROM asset_references WHERE asset_id = ?')
        .get(assetId)?.count || 0
    );
    if (referencedAssetIds.has(assetId) || persistedReferences > 0 || assetDerivativeWrites.has(assetId)) continue;
    const filePath = path.join(ASSETS_DIR, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      if (Math.trunc(stat.mtimeMs) > cutoff) continue;
      await fsp.unlink(filePath);
      removedFiles += 1;
      removedBytes += stat.size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { removedFiles, removedBytes, referencedFiles: references.size };
}

export { collectOrphanedAssets };
