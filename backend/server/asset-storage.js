import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { ASSETS_DIR, MAX_ASSET_SIZE } from './config.js';
import { ProtocolError } from './protocol-error.js';
import { assertWriteCapacity } from './resources.js';
import { servicesRuntime } from './runtime/services.js';
import { createImageDerivatives } from './image-derivatives.js';

const assetWrites = new Map();

const assetDerivativeWrites = new Map();

function assetExtensionForMime(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  return null;
}

function sniffImageType(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/i);
  if (!match) {
    return null;
  }
  return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
}

async function existingAssetIsValid(filePath, expectedHash) {
  try {
    const buffer = await fsp.readFile(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex') === expectedHash;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeAssetBuffer(buffer, mimeType) {
  const extension = assetExtensionForMime(mimeType);
  if (!extension) {
    throw new ProtocolError('UNSUPPORTED_ASSET', 'Unsupported image type.');
  }
  if (!buffer.length || buffer.length > MAX_ASSET_SIZE) {
    throw new ProtocolError('ASSET_TOO_LARGE', 'Asset size is out of range.');
  }
  if (sniffImageType(buffer) !== mimeType) {
    throw new ProtocolError('INVALID_ASSET', 'Asset content does not match its declared type.');
  }
  // Reserve room for the original plus bounded thumbnail/medium derivatives.
  await assertWriteCapacity(buffer.length * 3);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${hash}${extension}`;
  const filePath = path.join(ASSETS_DIR, filename);
  const key = `${hash}:${extension}`;

  let pending = assetWrites.get(key);
  if (!pending) {
    pending = (async () => {
      if (await existingAssetIsValid(filePath, hash)) {
        return;
      }
      const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      const handle = await fsp.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(buffer);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fsp.rename(temporary, filePath);
      } catch (error) {
        if (!(await existingAssetIsValid(filePath, hash))) {
          throw error;
        }
        await fsp.unlink(temporary).catch(() => {});
      }
    })().finally(() => assetWrites.delete(key));
    assetWrites.set(key, pending);
  }
  await pending;
  let derivatives = assetDerivativeWrites.get(hash);
  if (!derivatives) {
    derivatives = createImageDerivatives(buffer, hash).finally(() => assetDerivativeWrites.delete(hash));
    assetDerivativeWrites.set(hash, derivatives);
  }
  const image = await derivatives;
  const originalVariant = { url: `/assets/${filename}`, width: image.width, height: image.height };
  servicesRuntime.database
    .prepare(
      `
    INSERT INTO assets (asset_id, original_filename, mime_type, byte_size, width, height, created_at, orphaned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      original_filename = excluded.original_filename,
      mime_type = excluded.mime_type,
      byte_size = excluded.byte_size,
      width = excluded.width,
      height = excluded.height
  `
    )
    .run(hash, filename, mimeType, buffer.length, image.width, image.height, Date.now(), Date.now());
  return {
    url: `/assets/${filename}`,
    assetId: hash,
    width: image.width,
    height: image.height,
    mimeType,
    variants: {
      thumb: image.thumb?.url ? image.thumb : originalVariant,
      medium: image.medium?.url ? image.medium : originalVariant,
      original: originalVariant
    }
  };
}
export {
  assetWrites,
  assetDerivativeWrites,
  assetExtensionForMime,
  sniffImageType,
  parseDataUrl,
  existingAssetIsValid,
  writeAssetBuffer
};
