import { els } from './elements.js';
import { loadImage } from './image-upload-model.js';
import { getLayer, sortedRenderItems } from './layers-model.js';
import { isItemVisible } from './layer-visibility.js';
import { renderAll } from './rendering.js';
import { state } from './state.js';
import { clamp, cssEscape, staticAssetUrl } from './utilities.js';
import { inlineExportImages, waitForExportAssets } from './export-source-model.js';

async function withPreparedExportSource(keepIds, keepSectionId, callback, options = {}) {
  state.exporting = true;
  renderAll();
  try {
    await waitForExportAssets();
    await window.ConnectorUI?.prepareExport();
    const cssText = await fetchExportCss();
    const boardClone = els.board.cloneNode(true);
    prepareExportClone(boardClone);
    if (keepIds) {
      boardClone.querySelectorAll('[data-internal-id]').forEach((node) => {
        if (!keepIds.has(node.dataset.internalId)) node.remove();
      });
      boardClone.querySelectorAll('.board-item').forEach((node) => {
        if (!keepIds.has(node.dataset.itemId)) node.remove();
      });
    }
    if (keepSectionId) {
      boardClone.querySelectorAll('.section-frame').forEach((node) => {
        if (node.dataset.sectionId !== keepSectionId) node.remove();
      });
    }
    if (options.keepSectionIds) {
      boardClone.querySelectorAll('.section-frame').forEach((node) => {
        if (!options.keepSectionIds.has(node.dataset.sectionId)) node.remove();
      });
    }
    await inlineExportImages(boardClone);
    const paintSequence = await Promise.all(
      sortedRenderItems()
        .filter((item) => isItemVisible(item) && (!keepIds || keepIds.has(item.id)))
        .filter((item) => !keepSectionId || item.sectionId === keepSectionId)
        .filter((item) => boardClone.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`))
        .map(async (item) => {
          if (item.type !== 'image') return { kind: 'dom', id: item.id };
          const clonedImage = boardClone.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"] img`);
          if (!clonedImage?.src) return { kind: 'dom', id: item.id };
          try {
            const layer = getLayer(item.layerId || 'layer_default');
            return {
              kind: 'image',
              item: { ...item },
              image: await loadImage(clonedImage.src),
              opacity: clamp(Number(layer?.opacity ?? 1), 0, 1),
              blendMode: layer?.blendMode || 'normal'
            };
          } catch {
            return { kind: 'dom', id: item.id };
          }
        })
    );
    return await callback({ cssText, boardClone, paintSequence });
  } finally {
    state.exporting = false;
    renderAll();
  }
}

let exportCssText = null;

async function fetchExportCss() {
  if (exportCssText !== null) {
    return exportCssText;
  }
  try {
    const responses = await Promise.all(['styles.css', 'connector.css'].map((url) => fetch(staticAssetUrl(url))));
    exportCssText = (await Promise.all(responses.map((response) => (response.ok ? response.text() : '')))).join('\n');
  } catch {
    exportCssText = '';
  }
  return exportCssText;
}

function prepareExportClone(clone) {
  clone.classList.remove('connection-sparse');
  clone.querySelectorAll('.connection-controls, .connection-hit').forEach((node) => node.remove());
  clone
    .querySelectorAll(
      '.selection-frame, .marquee, .multi-selection, .mind-node-actions, .note-move-handle, .table-move-handle, .table-column-guides, .sheet-item-open'
    )
    .forEach((node) => node.remove());
  clone.querySelectorAll('.board-item.editing, .is-editing, .mind-node-text.editing').forEach((node) => {
    node.classList.remove('editing', 'is-editing');
  });
  clone.querySelectorAll('[contenteditable]').forEach((node) => {
    node.contentEditable = 'false';
  });
  clone.querySelectorAll('.board-item[data-section-collapsed="true"]').forEach((node) => {
    node.dataset.sectionCollapsed = 'false';
  });
  clone.querySelectorAll('svg').forEach((svg) => {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  });
  clone.querySelectorAll('.kdocs-embed-frame').forEach((frame) => {
    const placeholder = document.createElement('div');
    placeholder.className = 'kdocs-export-placeholder';
    placeholder.textContent = 'WPS 云文档（交互式内容请在画板中打开）';
    frame.replaceWith(placeholder);
  });
  clone.querySelectorAll('.amap-map-frame').forEach((frame) => {
    const placeholder = document.createElement('div');
    placeholder.className = 'amap-export-placeholder';
    const itemNode = frame.closest('.board-item');
    const item = itemNode ? state.items.get(itemNode.dataset.itemId) : null;
    placeholder.textContent = item?.place?.name
      ? `${item.place.name}${item.place.address ? ` · ${item.place.address}` : ''}`
      : '高德地图（交互式内容请在画板中打开）';
    frame.replaceWith(placeholder);
  });
  clone.querySelectorAll('.amap-map-shield, .amap-card-actions').forEach((node) => node.remove());
  clone.querySelectorAll('canvas[data-ink-canvas]').forEach((canvas) => {
    const inkId = canvas.dataset.inkCanvas;
    const original = inkId ? els.itemsLayer.querySelector(`canvas[data-ink-canvas="${cssEscape(inkId)}"]`) : null;
    if (!original) {
      return;
    }
    try {
      const image = document.createElement('img');
      image.className = canvas.className;
      image.alt = '';
      image.src = original.toDataURL('image/png');
      image.style.cssText = canvas.style.cssText;
      canvas.replaceWith(image);
    } catch (error) {
      console.warn('Could not inline an ink canvas for export.', error);
    }
  });
  // cloneNode copies a canvas element but not its bitmap. Spreadsheet cards are
  // painted previews, so serialize the live bitmap before the clone is rendered
  // through the SVG foreignObject export pipeline.
  clone.querySelectorAll('canvas.sheet-preview-canvas').forEach((canvas) => {
    const clonedItem = canvas.closest('.board-item[data-item-id]');
    const itemId = clonedItem?.dataset.itemId;
    const original = itemId
      ? els.itemsLayer.querySelector(`.board-item[data-item-id="${cssEscape(itemId)}"] canvas.sheet-preview-canvas`)
      : null;
    if (!original) return;
    try {
      const image = document.createElement('img');
      image.className = canvas.className;
      image.alt = '';
      image.src = original.toDataURL('image/png');
      image.style.cssText = canvas.style.cssText;
      image.setAttribute('draggable', 'false');
      canvas.replaceWith(image);
    } catch (error) {
      console.warn('Could not inline a worksheet preview for export.', error);
    }
  });
}
export { withPreparedExportSource, exportCssText, fetchExportCss, prepareExportClone };
