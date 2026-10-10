'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeAsset(entry) {
  const originalFilename = entry?.originalFilename;
  if (!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(originalFilename || '')) {
    throw new Error('Invalid backup asset filename');
  }
  const assetId = originalFilename.slice(0, 64);
  if (entry?.assetId !== assetId) throw new Error('Backup asset identity mismatch');
  return { assetId, originalFilename };
}

function verifyAsset(filename, asset) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  if (hash !== asset.assetId) throw new Error(`Backup asset checksum mismatch: ${asset.originalFilename}`);
}

function backupAssetDirectory(backupFile) {
  return backupFile.replace(/\.sqlite$/i, '.assets');
}

function readBackupAssets(backupFile) {
  const manifestFile = backupFile.replace(/\.sqlite$/i, '.assets.json');
  if (!fs.existsSync(manifestFile)) throw new Error('Backup asset manifest is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.version !== 2 || !Array.isArray(manifest.assets)) throw new Error('Unsupported backup asset manifest');
  const assets = manifest.assets.map(normalizeAsset);
  const directory = backupAssetDirectory(backupFile);
  return { assets, directory };
}

module.exports = { normalizeAsset, verifyAsset, backupAssetDirectory, readBackupAssets };
