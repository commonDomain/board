import path from 'node:path';
import { normalizeAsset as normalizeBackupAsset } from '../backup-assets.js';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { createImageDerivatives } from './image-derivatives.js';
import { boards } from './board-registry.js';
import { ASSETS_DIR, BACKUPS_DIR } from './config.js';
import { servicesRuntime } from './runtime/services.js';

function assetFilenameFromSource(source) {
  const match = String(source || '').match(/^\/assets\/([a-f0-9]{64}\.(?:png|jpg|webp))$/i);
  return match ? match[1].toLowerCase() : null;
}

function collectStateAssetReferences(state, references) {
  if (!state || !Array.isArray(state.items)) return;
  for (const item of state.items) {
    if (item?.type !== 'image') continue;
    const filename = assetFilenameFromSource(item.src);
    if (filename) references.add(filename);
  }
}

function assetIdFromSource(source) {
  const filename = assetFilenameFromSource(source);
  return filename ? filename.slice(0, 64) : null;
}

function assetMimeFromFilename(filename) {
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg')) return 'image/jpeg';
  return 'image/webp';
}

function collectStateAssetCounts(state) {
  const counts = new Map();
  for (const item of state?.items || []) {
    if (item?.type !== 'image') continue;
    const assetId = item.assetId || assetIdFromSource(item.src);
    if (!assetId) continue;
    counts.set(assetId, (counts.get(assetId) || 0) + 1);
  }
  return counts;
}

function replaceAssetReferences(ownerType, ownerId, state) {
  const counts = collectStateAssetCounts(state);
  servicesRuntime.database
    .prepare('DELETE FROM asset_references WHERE owner_type = ? AND owner_id = ?')
    .run(ownerType, ownerId);
  const insertAsset = servicesRuntime.database.prepare(`
    INSERT OR IGNORE INTO assets
      (asset_id, original_filename, mime_type, byte_size, width, height, created_at, orphaned_at)
    VALUES (?, ?, ?, 0, NULL, NULL, ?, NULL)
  `);
  const insertReference = servicesRuntime.database.prepare(`
    INSERT INTO asset_references (owner_type, owner_id, asset_id, ref_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const [assetId, count] of counts) {
    const image = (state.items || []).find(
      (item) => item?.type === 'image' && (item.assetId || assetIdFromSource(item.src)) === assetId
    );
    const filename = assetFilenameFromSource(image?.src) || `${assetId}.webp`;
    insertAsset.run(assetId, filename, assetMimeFromFilename(filename), Date.now());
    insertReference.run(ownerType, ownerId, assetId, count, Date.now());
    servicesRuntime.database.prepare('UPDATE assets SET orphaned_at = NULL WHERE asset_id = ?').run(assetId);
  }
}

function rebuildStoredAssetReferences() {
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    servicesRuntime.database.prepare('DELETE FROM asset_references').run();
    for (const row of servicesRuntime.database.prepare('SELECT id, document_json FROM independent_notebooks').all()) {
      const book = JSON.parse(row.document_json);
      replaceAssetReferences('notebook', row.id, { items: book.pages.flatMap(page => page.elements.filter(element => element.type === 'image')) });
    }
    for (const row of servicesRuntime.database.prepare('SELECT id, state_json FROM boards').all()) {
      try {
        replaceAssetReferences('board', row.id, JSON.parse(row.state_json));
      } catch (error) {
        console.warn(`Could not rebuild asset references for board ${row.id}:`, error.message);
      }
    }
    for (const row of servicesRuntime.database.prepare('SELECT board_id, state_json FROM state_v2_archives').all()) {
      try {
        replaceAssetReferences('archive-v2', row.board_id, JSON.parse(row.state_json));
      } catch (error) {
        console.warn(`Could not rebuild archived asset references for board ${row.board_id}:`, error.message);
      }
    }
    for (const row of servicesRuntime.database.prepare('SELECT board_id, state_json FROM state_v3_archives').all()) {
      try {
        replaceAssetReferences('archive-v3', row.board_id, JSON.parse(row.state_json));
      } catch (error) {
        console.warn(`Could not rebuild archived asset references for board ${row.board_id}:`, error.message);
      }
    }
    for (const row of servicesRuntime.database.prepare('SELECT board_id, state_json FROM state_v4_archives').all()) {
      try {
        replaceAssetReferences('archive-v4', row.board_id, JSON.parse(row.state_json));
      } catch (error) {
        console.warn(`Could not rebuild archived asset references for board ${row.board_id}:`, error.message);
      }
    }
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

function operationMayAffectAssets(operation, previousState) {
  if (!operation || typeof operation !== 'object') return false;
  if (operation.kind === 'batch')
    return (operation.ops || []).some((child) => operationMayAffectAssets(child, previousState));
  if (operation.kind === 'upsert') {
    const previous = previousState.items.find((item) => item.id === operation.item?.id);
    return operation.item?.type === 'image' || previous?.type === 'image';
  }
  if (operation.kind === 'delete') {
    const ids = new Set(operation.ids || []);
    return previousState.items.some((item) => item.type === 'image' && ids.has(item.id));
  }
  if (operation.kind === 'note-delete-content') {
    const ids = new Set(operation.itemIds || []);
    return previousState.items.some((item) => item.type === 'image' && ids.has(item.id));
  }
  if (operation.kind === 'clear' || operation.kind === 'delete-container') {
    return previousState.items.some((item) => item.type === 'image');
  }
  return false;
}

function hydrateImageAssetMetadata(state) {
  const select = servicesRuntime.database.prepare('SELECT width, height FROM assets WHERE asset_id = ?');
  for (const item of state?.items || []) {
    if (item?.type !== 'image') continue;
    item.assetId ||= assetIdFromSource(item.src);
    if (!item.assetId) continue;
    const row = select.get(item.assetId);
    if (Number(row?.width) > 0 && Number(row?.height) > 0) {
      item.naturalWidth = Number(row.width);
      item.naturalHeight = Number(row.height);
    }
  }
  return state;
}

async function backfillStoredImageAssets() {
  const rows = servicesRuntime.database
    .prepare(
      `
    SELECT asset_id, original_filename, mime_type FROM assets
    WHERE width IS NULL OR height IS NULL
    ORDER BY asset_id
  `
    )
    .all();
  for (const row of rows) {
    if (!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(row.original_filename)) continue;
    try {
      const filePath = path.join(ASSETS_DIR, row.original_filename);
      const buffer = await fsp.readFile(filePath);
      const image = await createImageDerivatives(buffer, row.asset_id);
      servicesRuntime.database
        .prepare(
          `
        UPDATE assets SET byte_size = ?, width = ?, height = ?, mime_type = ? WHERE asset_id = ?
      `
        )
        .run(
          buffer.length,
          image.width,
          image.height,
          row.mime_type || assetMimeFromFilename(row.original_filename),
          row.asset_id
        );
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Could not generate image levels for ${row.asset_id}:`, error.message);
    }
  }
}

function collectStoredAssetReferences() {
  const references = new Set();
  const rows = servicesRuntime.database
    .prepare(
      `
    SELECT state_json FROM boards
    UNION ALL
    SELECT state_json FROM state_v2_archives
    UNION ALL
    SELECT state_json FROM state_v3_archives
    UNION ALL
    SELECT state_json FROM state_v4_archives
  `
    )
    .all();
  for (const row of rows) {
    try {
      collectStateAssetReferences(JSON.parse(row.state_json), references);
    } catch (error) {
      console.warn('Asset GC skipped an unreadable stored state:', error.message);
    }
  }
  for (const board of boards.values()) {
    collectStateAssetReferences(board.state, references);
  }
  if (servicesRuntime.database) {
    for (const row of servicesRuntime.database
      .prepare(
        `
      SELECT a.original_filename FROM user_accounts AS u
      JOIN assets AS a ON a.asset_id = u.avatar_asset_id
      WHERE u.avatar_asset_id IS NOT NULL
    `
      )
      .all())
      references.add(row.original_filename);
  }
  try {
    for (const entry of fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.assets.json')) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, entry.name), 'utf8'));
        if (manifest.version !== 2) {
          console.warn(`Asset GC ignored obsolete backup manifest: ${entry.name}`);
          continue;
        }
        if (!Array.isArray(manifest.assets)) throw new Error('Invalid backup asset list');
        for (const asset of manifest.assets) {
          references.add(normalizeBackupAsset(asset).originalFilename);
        }
      } catch (error) {
        throw new Error(`${entry.name}: ${error.message}`);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const failure = new Error(`Asset GC paused: unreadable backup manifest (${error.message})`);
      failure.code = 'ASSET_GC_UNSAFE_REFERENCES';
      throw failure;
    }
  }
  return references;
}

export {
  assetFilenameFromSource,
  assetIdFromSource,
  assetMimeFromFilename,
  backfillStoredImageAssets,
  collectStateAssetCounts,
  collectStateAssetReferences,
  collectStoredAssetReferences,
  hydrateImageAssetMetadata,
  operationMayAffectAssets,
  rebuildStoredAssetReferences,
  replaceAssetReferences
};
