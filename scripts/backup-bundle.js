'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { backupAssetDirectory, normalizeAsset, verifyAsset } = require('../backend/backup-assets');

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function manifestFileFor(backupFile) {
  if (!/\.sqlite$/i.test(backupFile)) throw new Error('Backup filename must end in .sqlite');
  return backupFile.replace(/\.sqlite$/i, '.assets.json');
}

function validateDatabase(file, expectedBoards) {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA quick_check').all();
    if (!check.every((row) => row.quick_check === 'ok')) throw new Error('备份 SQLite quick_check 失败');
    if (Number.isInteger(expectedBoards) && tableExists(copy, 'boards')) {
      const count = Number(copy.prepare('SELECT COUNT(*) AS count FROM boards').get().count);
      if (count !== expectedBoards) throw new Error('备份画板数量与源数据库不一致');
    }
  } finally {
    copy.close();
  }
}

function listAssets(database) {
  if (!tableExists(database, 'assets')) return [];
  const count = Number(database.prepare('SELECT COUNT(*) AS count FROM assets').get().count);
  if (!count) return [];
  const columns = new Set(database.prepare('PRAGMA table_info(assets)').all().map((row) => row.name));
  if (!columns.has('asset_id') || !columns.has('original_filename')) {
    throw new Error('assets 表缺少新备份所需字段');
  }
  return database.prepare('SELECT asset_id, original_filename FROM assets ORDER BY asset_id').all()
    .map((row) => normalizeAsset({ assetId: row.asset_id, originalFilename: row.original_filename }));
}

async function createBackupBundle(database, { dataDir, backupFile, expectedBoards }) {
  const resolvedBackup = path.resolve(backupFile);
  const backupsDir = path.dirname(resolvedBackup);
  const sourceAssetsDir = path.resolve(dataDir, 'assets');
  const finalAssetsDir = backupAssetDirectory(resolvedBackup);
  const manifestFile = manifestFileFor(resolvedBackup);
  const suffix = `.${process.pid}.tmp`;
  const temporaryDatabase = `${resolvedBackup}${suffix}`;
  const temporaryAssetsDir = `${finalAssetsDir}${suffix}`;
  const temporaryManifest = `${manifestFile}${suffix}`;
  const published = [];

  for (const target of [resolvedBackup, finalAssetsDir, manifestFile, temporaryDatabase, temporaryAssetsDir, temporaryManifest]) {
    if (path.dirname(path.resolve(target)) !== backupsDir) throw new Error('备份路径必须位于 backups 目录内');
    if (fs.existsSync(target)) throw new Error(`备份目标已存在：${target}`);
  }

  try {
    await backup(database, temporaryDatabase);
    validateDatabase(temporaryDatabase, expectedBoards);
    await Promise.all([
      fsp.rm(`${temporaryDatabase}-shm`, { force: true }),
      fsp.rm(`${temporaryDatabase}-wal`, { force: true })
    ]);
    const assets = listAssets(database);
    await fsp.mkdir(temporaryAssetsDir);
    for (const asset of assets) {
      const source = path.join(sourceAssetsDir, asset.originalFilename);
      verifyAsset(source, asset);
      const copiedOriginal = path.join(temporaryAssetsDir, asset.originalFilename);
      await fsp.copyFile(source, copiedOriginal);
      verifyAsset(copiedOriginal, asset);
      for (const derivative of [`${asset.assetId}.thumb.webp`, `${asset.assetId}.medium.webp`]) {
        const derivativeSource = path.join(sourceAssetsDir, derivative);
        if (fs.existsSync(derivativeSource)) await fsp.copyFile(derivativeSource, path.join(temporaryAssetsDir, derivative));
      }
    }
    await fsp.writeFile(temporaryManifest, `${JSON.stringify({
      version: 2,
      createdAt: new Date().toISOString(),
      assets
    }, null, 2)}\n`, { flag: 'wx' });

    await fsp.rename(temporaryAssetsDir, finalAssetsDir);
    published.push(finalAssetsDir);
    await fsp.rename(temporaryManifest, manifestFile);
    published.push(manifestFile);
    await fsp.rename(temporaryDatabase, resolvedBackup);
    published.push(resolvedBackup);
    return { backupFile: resolvedBackup, manifestFile, assetsDirectory: finalAssetsDir, assets };
  } catch (error) {
    for (const target of [`${temporaryDatabase}-shm`, `${temporaryDatabase}-wal`, temporaryDatabase, temporaryManifest, temporaryAssetsDir, ...published.reverse()]) {
      await fsp.rm(target, { recursive: target === temporaryAssetsDir || target === finalAssetsDir, force: true }).catch(() => {});
    }
    throw error;
  }
}

module.exports = { createBackupBundle, validateDatabase };
