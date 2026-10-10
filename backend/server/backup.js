import { verifyAsset as verifyBackupAsset } from '../backup-assets.js';
import path from 'node:path';
import { normalizeAsset as normalizeBackupAsset } from '../backup-assets.js';
import fsp from 'node:fs/promises';
import { backup as backupDatabase } from 'node:sqlite';
import { backupAssetDirectory } from '../backup-assets.js';
import { DatabaseSync } from 'node:sqlite';
import { ASSETS_DIR, BACKUPS_DIR, BACKUP_RETENTION_COUNT, DATABASE_FILE } from './config.js';
import { recoveryStatus } from './recovery-state.js';
import { assertWriteCapacity } from './resources.js';
import { backupRuntime } from './runtime/backup.js';
import { servicesRuntime } from './runtime/services.js';

async function createOnlineBackup() {
  if (backupRuntime.backupInFlight) return backupRuntime.backupInFlight;
  backupRuntime.backupInFlight = (async () => {
    await fsp.mkdir(BACKUPS_DIR, { recursive: true });
    const databaseStat = await fsp.stat(DATABASE_FILE);
    await assertWriteCapacity(databaseStat.size);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const finalPath = path.join(BACKUPS_DIR, `whiteboard-${timestamp}.sqlite`);
    const temporaryPath = `${finalPath}.${process.pid}.tmp`;
    const assetDirectory = backupAssetDirectory(finalPath);
    const manifestPath = finalPath.replace(/\.sqlite$/, '.assets.json');
    const manifestTemporary = `${manifestPath}.${process.pid}.tmp`;
    let published = false;
    try {
      await backupDatabase(servicesRuntime.database, temporaryPath);
      const verification = new DatabaseSync(temporaryPath, { readOnly: true });
      let assets;
      try {
        const result = verification.prepare('PRAGMA quick_check').all();
        if (!result.every((entry) => entry.quick_check === 'ok')) throw new Error('Backup quick_check failed');
        // Capture all asset metadata in this exact SQLite snapshot, including archives.
        assets = verification
          .prepare('SELECT asset_id, original_filename FROM assets ORDER BY asset_id')
          .all()
          .map((row) =>
            normalizeBackupAsset({
              assetId: row.asset_id,
              originalFilename: row.original_filename
            })
          );
      } finally {
        verification.close();
      }
      await Promise.all([
        fsp.rm(`${temporaryPath}-shm`, { force: true }),
        fsp.rm(`${temporaryPath}-wal`, { force: true })
      ]);
      await fsp.mkdir(assetDirectory, { recursive: true, mode: 0o700 });
      for (const asset of assets) {
        const source = path.join(ASSETS_DIR, asset.originalFilename);
        const stat = await fsp.stat(source);
        await assertWriteCapacity(stat.size);
        const target = path.join(assetDirectory, asset.originalFilename);
        await fsp.copyFile(source, target);
        verifyBackupAsset(target, asset);
      }
      await fsp.writeFile(
        manifestTemporary,
        JSON.stringify(
          {
            version: 2,
            createdAt: new Date().toISOString(),
            database: path.basename(finalPath),
            assets
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      await fsp.rename(manifestTemporary, manifestPath);
      // Publishing the .sqlite file is the completion marker for the entire bundle.
      await fsp.rename(temporaryPath, finalPath);
      published = true;
      const backups = (await fsp.readdir(BACKUPS_DIR, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^whiteboard-.*\.sqlite$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const stale of backups.slice(BACKUP_RETENTION_COUNT)) {
        await fsp.unlink(path.join(BACKUPS_DIR, stale)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await fsp.unlink(path.join(BACKUPS_DIR, stale.replace(/\.sqlite$/, '.assets.json'))).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        const staleAssets = backupAssetDirectory(path.join(BACKUPS_DIR, stale));
        if (path.dirname(path.resolve(staleAssets)) !== path.resolve(BACKUPS_DIR))
          throw new Error('Invalid backup cleanup path');
        await fsp.rm(staleAssets, { recursive: true, force: true });
      }
      recoveryStatus.lastBackupAt = new Date().toISOString();
      servicesRuntime.database
        .prepare(
          `
        INSERT INTO runtime_state (key, value, updated_at) VALUES ('last_backup_at', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `
        )
        .run(recoveryStatus.lastBackupAt, Date.now());
      return finalPath;
    } finally {
      if (!published) {
        for (const filename of [
          `${temporaryPath}-shm`,
          `${temporaryPath}-wal`,
          temporaryPath,
          manifestTemporary,
          manifestPath,
          assetDirectory
        ]) {
          if (path.dirname(path.resolve(filename)) !== path.resolve(BACKUPS_DIR))
            throw new Error('Invalid backup cleanup path');
          await fsp.rm(filename, { recursive: filename === assetDirectory, force: true }).catch((error) => {
            console.error('Incomplete backup cleanup failed:', error);
          });
        }
      }
    }
  })().finally(() => {
    backupRuntime.backupInFlight = null;
  });
  return backupRuntime.backupInFlight;
}

export { createOnlineBackup };
