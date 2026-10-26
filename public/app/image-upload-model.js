import { MAX_IMAGE_TRANSMIT_BYTES } from './constants.js';

function canUploadImageMime(mimeType) {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp';
}

async function normalizeImageForBoard(blob) {
  if (!canUploadImageMime(blob.type)) {
    throw new Error('Unsupported image type');
  }
  if (!blob.size || blob.size > MAX_IMAGE_TRANSMIT_BYTES) {
    throw new Error('Image exceeds the 15 MB limit');
  }
  const original = await loadImage(await blobToDataUrl(blob));
  return {
    blob,
    mimeType: blob.type,
    width: original.naturalWidth || original.width || 320,
    height: original.naturalHeight || original.height || 240
  };
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
export { canUploadImageMime, canvasToBlob, loadImage, blobToDataUrl, normalizeImageForBoard };
