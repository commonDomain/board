import { state } from './state.js';
import { getCanvasRenderPolicy } from './render-resources-model.js';
import { PHONE_IMAGE_CONCURRENCY, planImageSources } from './image-render-policy-model.js';

// Every managed image has one owner and one cancellable request. Camera updates
// reconcile this set rather than creating detached Image preloaders per zoom.
const records = new Map();
const pending = new Set();
let active = 0;
let legacyActive = false;
let reconcileFrame = null;

function releaseBitmap(record) {
  record.image.removeAttribute('src');
  if (record.url) URL.revokeObjectURL(record.url);
  record.url = null;
  record.pixels = 0;
}

function mountManagedImage(item, image, view = {}) {
  if (!getCanvasRenderPolicy({ exporting: state.exporting }).bounded) return;
  // This queue owns loading; native lazy loading can withhold an offscreen
  // load event indefinitely and exhaust both queue slots in WebKit.
  if (getCanvasRenderPolicy().tablet) { image.loading = 'eager'; image.decoding = 'async'; }
  records.set(image, { id: item.id, image, resolveItem: view.resolveItem || (() => state.items.get(item.id)), getZoom: view.getZoom || (() => state.zoom), version: 0, pixels: 0, url: null, busy: false, failed: false, desired: null, abort: null });
  scheduleManagedImageRefresh();
}

function releaseManagedImages(node) {
  for (const image of node?.querySelectorAll('img') || []) {
    const record = records.get(image);
    if (!record) continue;
    record.version++;
    record.abort?.abort();
    pending.delete(record);
    releaseBitmap(record);
    records.delete(image);
  }
  if (records.size) scheduleManagedImageRefresh();
}

function scheduleManagedImageRefresh() {
  if (reconcileFrame) return;
  reconcileFrame = requestAnimationFrame(() => {
    reconcileFrame = null;
    reconcileManagedImages();
  });
}

function retryFailedManagedImages() {
  let retry = false;
  for (const record of records.values()) {
    if (!record.failed || record.busy) continue;
    record.failed = false;
    record.desired = null;
    retry = true;
  }
  if (retry) scheduleManagedImageRefresh();
}

function reconcileManagedImages() {
  const live = [];
  for (const record of records.values()) {
    const item = record.resolveItem();
    if (!record.image.isConnected || item?.type !== 'image') {
      record.version++;
      record.abort?.abort();
      pending.delete(record);
      releaseBitmap(record);
      records.delete(record.image);
    } else live.push({ record, item });
  }
  const plans = planImageSources(live.map(({ item, record }) => ({ ...item, viewZoom: record.getZoom() })), state.zoom, window.devicePixelRatio, getCanvasRenderPolicy());
  for (let i = 0; i < live.length; i++) {
    const record = live[i].record, plan = plans[i];
    const key = `${plan.source}:${plan.width}x${plan.height}`;
    if (record.desired?.key === key) continue;
    record.version++;
    record.abort?.abort();
    // Downgrades release their old bitmap before upgrades can allocate. The
    // budget covers all resident images, including a newly mounted viewport.
    if (record.pixels > plan.pixels) releaseBitmap(record);
    record.desired = { ...plan, key };
    pending.add(record);
  }
  pump();
}

function abortError() { return new DOMException('Image request cancelled', 'AbortError'); }

function dataImageBlob(source) {
  const comma = source.indexOf(',');
  if (comma < 0) throw new Error('Invalid image data');
  const header = source.slice(5, comma), payload = source.slice(comma + 1);
  const type = header.split(';')[0];
  if (!header.split(';').includes('base64')) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function loadIntoImage(image, source, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancelled);
    };
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Image decode failed')); };
    const cancelled = () => { cleanup(); reject(abortError()); };
    if (signal.aborted) { reject(abortError()); return; }
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
    signal.addEventListener('abort', cancelled, { once: true });
    image.src = source;
  });
}

async function resizeBlob(blob, plan, signal) {
  let bitmap, temporaryUrl;
  const canvas = document.createElement('canvas');
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob, { resizeWidth: plan.width, resizeHeight: plan.height, resizeQuality: 'high' });
    } else {
      // Older Safari: legacy/data images decode one at a time, then release
      // the full-size surface. No full-size image enters the scene tree.
      bitmap = new Image();
      temporaryUrl = URL.createObjectURL(blob);
      await loadIntoImage(bitmap, temporaryUrl, signal);
    }
    if (signal.aborted) throw abortError();
    canvas.width = plan.width; canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image surface is unavailable');
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const resized = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .9));
    if (!resized) throw new Error('Image resize failed');
    return resized;
  } finally {
    bitmap?.close?.();
    if (temporaryUrl) { bitmap?.removeAttribute('src'); URL.revokeObjectURL(temporaryUrl); }
    canvas.width = 1; canvas.height = 1;
  }
}

async function requestImage(record, plan, version, controller) {
  const signal = controller.signal;
  const current = () => !signal.aborted && records.get(record.image) === record && record.version === version && record.image.isConnected;
  let nextUrl = null;
  try {
    let source = plan.source;
    let blob;
    // Guest notebook images are data URLs. CSP allows displaying them, but
    // connect-src deliberately disallows fetching them as network resources.
    if (source.startsWith('data:')) {
      blob = dataImageBlob(source);
    } else {
      let response = await fetch(source, { signal, credentials: 'same-origin' });
      if (!response.ok && plan.fallback) {
        source = plan.fallback;
        response = await fetch(source, { signal, credentials: 'same-origin' });
      }
      if (!response.ok) throw new Error('Image preview is unavailable');
      blob = await response.blob();
    }
    if (!current()) return;
    if (plan.resize && (source === plan.source || getCanvasRenderPolicy().tablet)) blob = await resizeBlob(blob, plan, signal);
    if (!current()) return;
    nextUrl = URL.createObjectURL(blob);
    releaseBitmap(record);
    record.image.dataset.source = source;
    await loadIntoImage(record.image, nextUrl, signal);
    if (!current()) return;
    record.url = nextUrl;
    nextUrl = null;
    record.pixels = record.image.naturalWidth * record.image.naturalHeight;
    record.failed = false;
    record.image.alt = '粘贴图片';
  } catch (error) {
    if (current() && error.name !== 'AbortError') {
      releaseBitmap(record);
      record.failed = true;
      record.image.alt = '图片预览暂时无法加载';
    }
  } finally {
    if (nextUrl) {
      if (record.image.getAttribute('src') === nextUrl) record.image.removeAttribute('src');
      URL.revokeObjectURL(nextUrl);
    }
  }
}

function pump() {
  for (const record of pending) {
    if (active >= PHONE_IMAGE_CONCURRENCY) break;
    if (record.busy) continue;
    const legacy = record.desired.fullDecode;
    if (legacy && legacyActive) continue;
    pending.delete(record);
    const controller = new AbortController();
    record.abort = controller;
    record.busy = true;
    active++;
    if (legacy) legacyActive = true;
    void requestImage(record, record.desired, record.version, controller).finally(() => {
      active--;
      record.busy = false;
      if (legacy) legacyActive = false;
      if (record.abort === controller) record.abort = null;
      pump();
    });
  }
}

function imageRenderStats() {
  return { mounted: records.size, active, pending: pending.size, pixels: [...records.values()].reduce((sum, record) => sum + record.pixels, 0) };
}

function mountPhoneImage(item, image, view) {
  if (getCanvasRenderPolicy({ exporting: state.exporting }).phone) mountManagedImage(item, image, view);
}

export { mountPhoneImage, mountManagedImage, releaseManagedImages, scheduleManagedImageRefresh, retryFailedManagedImages, reconcileManagedImages, imageRenderStats,
  releaseManagedImages as releasePhoneImages, scheduleManagedImageRefresh as schedulePhoneImageRefresh, reconcileManagedImages as reconcilePhoneImages, imageRenderStats as phoneImageRenderStats };
