import { isGuestMode } from './account-lifecycle.js';
import { getBackgroundPreset } from './background-model.js';
import { boardPointToItemSpace } from './rendering-model.js';
import { hitTestItem } from './rendering.js';
import { state } from './state.js';
import { clamp, cssEscape } from './utilities.js';
import { blobToDataUrl } from './image-upload-model.js';

function sampleColorAtPoint(point) {
  const hit = hitTestItem(point, { includeLocked: true });
  if (!hit) {
    return getBackgroundPreset().color;
  }
  if (hit.type === 'image') {
    return sampleImageColor(hit, point) || state.color || '#111111';
  }
  return hit.stroke || hit.color || '#111111';
}

function sampleImageColor(item, point) {
  const image = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"] img`);
  if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const localPoint = boardPointToItemSpace(item, point);
    const localX = Math.floor(((localPoint.x - item.x) / Math.max(1, item.w)) * image.naturalWidth);
    const localY = Math.floor(((localPoint.y - item.y) / Math.max(1, item.h)) * image.naturalHeight);
    context.drawImage(
      image,
      clamp(localX, 0, image.naturalWidth - 1),
      clamp(localY, 0, image.naturalHeight - 1),
      1,
      1,
      0,
      0,
      1,
      1
    );
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return null;
  }
}

async function uploadImageAsset(image) {
  if (isGuestMode()) {
    const dataUrl = await blobToDataUrl(image.blob);
    return { url: dataUrl, width: image.width, height: image.height };
  }
  const response = await fetch('/api/assets', {
    method: 'POST',
    headers: {
      'content-type': image.mimeType || image.blob.type || 'image/webp'
    },
    body: image.blob
  });
  if (!response.ok) {
    throw new Error(`Asset upload failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload.url !== 'string') {
    throw new Error('Asset upload returned no URL');
  }
  return payload;
}
export { sampleColorAtPoint, sampleImageColor, uploadImageAsset };
