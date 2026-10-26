'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readBackupAssets, verifyAsset } = require('../backend/backup-assets');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const backupFile = path.resolve(argument('--backup') || '');
const targetDataDir = path.resolve(argument('--target-data-dir') || '');
if (!argument('--backup') || !argument('--target-data-dir')) {
  throw new Error('Usage: npm run recover:backup -- --backup <file.sqlite> --target-data-dir <empty-directory>');
}
if (!fs.statSync(backupFile).isFile()) throw new Error('Backup file does not exist.');
if (targetDataDir === path.dirname(path.dirname(backupFile))) {
  throw new Error('Recovery target must be a new directory, not the source DATA_DIR.');
}
if (fs.existsSync(targetDataDir) && fs.readdirSync(targetDataDir).length) {
  throw new Error('Recovery target directory must be empty.');
}

const database = new DatabaseSync(backupFile, { readOnly: true });
try {
  const result = database.prepare('PRAGMA quick_check').all();
  if (!result.every((entry) => entry.quick_check === 'ok')) throw new Error('Backup failed SQLite quick_check.');
} finally {
  database.close();
}
for (const auxiliary of [`${backupFile}-shm`, `${backupFile}-wal`]) {
  try { fs.rmSync(auxiliary, { force: true }); } catch {}
}

const { assets, directory: sourceAssetsDir } = readBackupAssets(backupFile);
// Validate every original before creating any restored state.
for (const asset of assets) verifyAsset(path.join(sourceAssetsDir, asset.originalFilename), asset);
const targetAssetsDir = path.join(targetDataDir, 'assets');
fs.mkdirSync(targetAssetsDir, { recursive: true });
fs.copyFileSync(backupFile, path.join(targetDataDir, 'whiteboard.sqlite'));

for (const asset of assets) {
  const assetId = asset.originalFilename.slice(0, 64);
  for (const filename of [asset.originalFilename, `${assetId}.thumb.webp`, `${assetId}.medium.webp`]) {
    const source = path.join(sourceAssetsDir, filename);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(targetAssetsDir, filename));
  }
}

console.log(`Verified backup restored to ${targetDataDir} (${assets.length} original assets)`);
