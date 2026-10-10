import { parseDataUrl, writeAssetBuffer } from './asset-storage.js';
import { sanitizeItem } from './item-validation.js';
import { ProtocolError } from './protocol-error.js';
import { servicesRuntime } from './runtime/services.js';

function canUserReferenceAsset(userId, assetId) {
  return servicesRuntime.accountService.canReferenceAsset(userId, assetId);
}

async function prepareItem(rawItem, options = {}) {
  const item = sanitizeItem(rawItem);
  if (!item) {
    throw new ProtocolError('INVALID_OPERATION', 'Item is malformed or unsupported.');
  }
  if (item.type === 'image' && item.src.startsWith('data:')) {
    const parsed = parseDataUrl(item.src);
    if (!parsed) {
      throw new ProtocolError('INVALID_ASSET', 'Image data URL is invalid.');
    }
    const asset = await writeAssetBuffer(parsed.buffer, parsed.mimeType);
    item.src = asset.url;
    item.assetId = asset.assetId;
    item.naturalWidth = asset.width;
    item.naturalHeight = asset.height;
  } else if (item.type === 'image' && item.assetId && !canUserReferenceAsset(options.userId, item.assetId)) {
    throw new ProtocolError('ASSET_ACCESS_DENIED', 'This image is not available to the current account.');
  }
  return item;
}

export { canUserReferenceAsset, prepareItem };
