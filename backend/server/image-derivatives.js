import sharp from 'sharp';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { ASSETS_DIR, MAX_IMAGE_PIXELS } from './config.js';
import { ProtocolError } from './protocol-error.js';

async function writeDerivedAsset(filePath, buffer) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isFile() && stat.size > 0) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || !stat.size) throw error;
    } catch {
      throw error;
    } finally {
      await fsp.unlink(temporary).catch(() => {});
    }
  }
}

async function createImageDerivatives(buffer, assetId) {
  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false }).metadata();
  } catch (error) {
    throw new ProtocolError('INVALID_ASSET', `Image could not be decoded: ${error.message}`);
  }
  const swapsAxes = [5, 6, 7, 8].includes(Number(metadata.orientation));
  const width = Math.max(1, Number(swapsAxes ? metadata.height : metadata.width) || 1);
  const height = Math.max(1, Number(swapsAxes ? metadata.width : metadata.height) || 1);
  const renderVariant = async (name, side, quality) => {
    if (Math.max(width, height) <= side) return null;
    const filename = `${assetId}.${name}.webp`;
    const output = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false })
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    await writeDerivedAsset(path.join(ASSETS_DIR, filename), output.data);
    return { url: `/assets/${filename}`, width: output.info.width, height: output.info.height };
  };
  const [thumb, medium] = await Promise.all([renderVariant('thumb', 320, 78), renderVariant('medium', 1600, 82)]);
  const original = { url: null, width, height };
  return { width, height, thumb: thumb || original, medium: medium || original };
}
export { createImageDerivatives, writeDerivedAsset };
