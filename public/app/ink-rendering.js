import { refreshIcons } from './interface-model.js';
import { state } from './state.js';
import { getSticker } from './toolbar-model.js';
import { getImageLodSource } from './ink-rendering-model.js';

let imageLodRefreshTimer = null;

function scheduleImageLodRefresh() {
  clearTimeout(imageLodRefreshTimer);
  imageLodRefreshTimer = setTimeout(refreshMountedImageSources, 120);
}

function refreshMountedImageSources() {
  imageLodRefreshTimer = null;
  for (const image of document.querySelectorAll('.image-item img')) {
    const itemId = image.closest('.board-item')?.dataset.itemId;
    const item = itemId ? state.items.get(itemId) : null;
    if (!item) continue;
    const source = getImageLodSource(item);
    if (image.dataset.source === source) continue;
    const preload = new Image();
    preload.decoding = 'async';
    preload.onload = () => {
      if (!image.isConnected || getImageLodSource(item) !== source) return;
      image.src = source;
      image.dataset.source = source;
    };
    preload.onerror = () => {
      if (source !== item.src && image.isConnected) {
        image.src = item.src;
        image.dataset.source = item.src;
      }
    };
    preload.src = source;
  }
}

function renderSticker(item) {
  const sticker = getSticker(item.icon);
  const wrapper = document.createElement('div');
  wrapper.className = 'sticker-symbol';
  wrapper.style.color = item.color || '#111111';
  const icon = document.createElement('i');
  icon.dataset.lucide = sticker?.icon || 'circle-help';
  icon.setAttribute('aria-label', sticker ? sticker.name : '未知贴纸');
  wrapper.appendChild(icon);
  refreshIcons(wrapper);
  return wrapper;
}
export { imageLodRefreshTimer, scheduleImageLodRefresh, refreshMountedImageSources, renderSticker };
