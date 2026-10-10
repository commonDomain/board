import { MIN_ITEM_SIZE, MIN_ZOOM } from './constants.js';
import { refreshIcons, showToast } from './interface-model.js';
import { positionSearchLocator } from './search-locator.js';
import { openSheetEditor } from './sheet-editor.js';
import {
  SHEET_ITEM_HEIGHT,
  SHEET_ITEM_WIDTH,
  destroySheetPreview,
  getSheetRecord,
  setSheetPreviewIndex,
  sheetPreviewIndex,
  sheetPreviews,
  sheetStores
} from './sheet-store.js';
import { state } from './state.js';

function renderSheetPreview(item) {
  const wrapper = document.createElement('div');
  wrapper.className = 'sheet-preview';
  const canvas = document.createElement('canvas');
  canvas.className = 'sheet-preview-canvas';
  canvas.setAttribute('aria-label', `${item.title || '工作表'} 预览`);
  wrapper.appendChild(canvas);
  const frame = document.createElement('div');
  frame.className = 'sheet-preview-frame';
  wrapper.appendChild(frame);
  const location = document.createElement('div');
  location.className = 'sheet-preview-location';
  location.hidden = true;
  location.setAttribute('role', 'status');
  location.setAttribute('aria-live', 'polite');
  wrapper.appendChild(location);
  const horizontalScroll = document.createElement('div');
  horizontalScroll.className = 'sheet-preview-scroll';
  horizontalScroll.setAttribute('role', 'scrollbar');
  horizontalScroll.setAttribute('aria-label', '工作表横向滚动');
  const horizontalTrack = document.createElement('div');
  horizontalTrack.className = 'sheet-preview-scroll-track';
  horizontalScroll.appendChild(horizontalTrack);
  wrapper.appendChild(horizontalScroll);
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'sheet-item-open';
  openButton.innerHTML = '<i data-lucide="pencil" aria-hidden="true"></i>';
  openButton.appendChild(document.createTextNode('编辑'));
  openButton.title = '打开工作表编辑器';
  openButton.setAttribute('aria-label', '打开工作表编辑器');
  openButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  openButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSheetEditor(item.id);
  });
  wrapper.appendChild(openButton);
  // The sheet bar sits above the edit affordance so a long tab list can never
  // slide underneath it.
  const sheetBar = document.createElement('div');
  sheetBar.className = 'sheet-preview-tabs';
  sheetBar.setAttribute('role', 'tablist');
  sheetBar.setAttribute('aria-label', '工作表切换');
  sheetBar.hidden = true;
  wrapper.appendChild(sheetBar);
  refreshIcons(wrapper);
  return { wrapper, canvas, sheetBar, location, horizontalScroll, horizontalTrack };
}

function syncSheetPreviewScroll(preview) {
  if (!preview?.renderer || !preview.horizontalScroll || !preview.horizontalTrack) return;
  const metrics = preview.renderer.getScrollMetrics();
  const viewport = Math.max(1, preview.horizontalScroll.clientWidth || metrics.viewportWidth || 1);
  preview.horizontalTrack.style.width = `${Math.max(viewport, viewport + metrics.maxLeft)}px`;
  preview.horizontalScroll.hidden = metrics.maxLeft <= 0;
  if (Math.abs(preview.horizontalScroll.scrollLeft - metrics.left) > 0.5) {
    preview.horizontalScroll.scrollLeft = metrics.left;
  }
  preview.horizontalScroll.setAttribute('aria-valuemin', '0');
  preview.horizontalScroll.setAttribute('aria-valuemax', String(Math.round(metrics.maxLeft)));
  preview.horizontalScroll.setAttribute('aria-valuenow', String(Math.round(metrics.left)));
}

/**
 * Sheet bar shown on the canvas element itself.
 *
 * Switching here changes only this browser's preview. It deliberately does not
 * mutate the workbook's collaborative active sheet or enqueue a board save.
 * Every control swallows its own pointer events: the board would otherwise read
 * the press as the start of a drag and move the element.
 */
function renderSheetTabs(item, preview) {
  const record = sheetStores.get(item.id) || getSheetRecord(item);
  const bar = preview?.sheetBar;
  if (!record || !bar) return;
  const { store } = record;
  const sheets = store.workbook.sheets;
  const active = sheetPreviewIndex(item, record);
  // A single tab still tells the user where they are; it is hidden only when
  // there is nothing to say.
  bar.textContent = '';
  sheets.forEach((sheet, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'sheet-preview-tab';
    tab.dataset.sheetIndex = String(index);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(index === active));
    tab.title = `${sheet.name}${index === active ? '（当前）' : ''}`;
    tab.classList.toggle('is-active', index === active);
    const name = document.createElement('span');
    name.className = 'sheet-preview-tab-name';
    name.textContent = sheet.name || `Sheet${index + 1}`;
    tab.appendChild(name);
    // The press is consumed completely: without preventDefault the board still
    // arms its move gesture and pressing a tab would drag the element.
    tab.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (sheetPreviewIndex(item, record) === index) return;
      if (!setSheetPreviewIndex(item, record, index)) return;
      // Preview sheet selection is local UI state. It must never enter the
      // collaborative workbook or a delayed server echo can visibly revert it.
      if (preview.location) {
        preview.location.hidden = true;
        preview.location.textContent = '';
      }
      preview.wrapper.classList.remove('is-search-located');
      renderSheetTabs(item, preview);
      preview.renderer?.setHighlight(null, null);
      preview.renderer?.setSheetIndex(index);
      requestAnimationFrame(() => syncSheetPreviewScroll(preview));
      const canvas = preview.canvas;
      if (canvas) canvas.setAttribute('aria-label', `${item.title || '工作表'} · ${sheets[index].name} 预览`);
    });
    bar.appendChild(tab);
  });
  const activeSheet = sheets[active] || sheets[0];
  if (activeSheet && preview.canvas) {
    preview.canvas.setAttribute('aria-label', `${item.title || '工作表'} · ${activeSheet.name} 预览`);
  }
  bar.hidden = sheets.length === 0;
}

/** Rebuilds the canvas sheet bar after the workbook's sheet list changed. */
function refreshSheetTabs(item) {
  const preview = sheetPreviews.get(item.id);
  if (!preview?.sheetBar?.isConnected) return;
  renderSheetTabs(item, preview);
}

/**
 * Mounts (or reuses) the preview renderer for an item. The canvas is sized to
 * the element's world size so the sheet stays legible at any zoom.
 */
function mountSheetPreview(item, node) {
  const record = getSheetRecord(item);
  if (!record) {
    const fallback = document.createElement('div');
    fallback.className = 'sheet-preview-error';
    fallback.textContent = '工作表数据无法读取';
    return fallback;
  }
  const existing = sheetPreviews.get(item.id);
  if (existing && existing.canvas.isConnected && node.contains(existing.canvas)) {
    existing.renderer.setStore(record.store, sheetPreviewIndex(item, record));
    renderSheetTabs(item, existing);
    resizeSheetPreview(item, existing);
    return null;
  }
  const { wrapper, canvas, sheetBar, location, horizontalScroll, horizontalTrack } = renderSheetPreview(item);
  const renderer = window.SheetView.createGridRenderer(canvas, {
    store: record.store,
    // The canvas preview pins frozen rows/columns exactly like the panel does.
    freezeRendering: true,
    showHeaders: true,
    showGrid: true
  });
  const preview = { canvas, renderer, frame: 0, wrapper, sheetBar, location, horizontalScroll, horizontalTrack };
  horizontalScroll.addEventListener('pointerdown', (event) => event.stopPropagation());
  horizontalScroll.addEventListener('click', (event) => event.stopPropagation());
  horizontalScroll.addEventListener(
    'scroll',
    () => {
      const scroll = renderer.getScroll();
      renderer.setScroll(scroll.top, horizontalScroll.scrollLeft);
      syncSheetPreviewScroll(preview);
    },
    { passive: true }
  );
  canvas.addEventListener(
    'wheel',
    (event) => {
      // Ctrl/Cmd+wheel remains the board's zoom gesture; an ordinary wheel over
      // the preview belongs to the worksheet and must not pan the whole canvas.
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const modeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, canvas.clientHeight) : 1;
      const visualScale = modeScale / Math.max(MIN_ZOOM, state.zoom || 1);
      const scroll = renderer.getScroll();
      if (event.shiftKey) {
        renderer.setScroll(scroll.top, scroll.left + (event.deltaY + event.deltaX) * visualScale);
      } else {
        renderer.setScroll(scroll.top + event.deltaY * visualScale, scroll.left + event.deltaX * visualScale);
      }
      syncSheetPreviewScroll(preview);
    },
    { passive: false }
  );
  sheetPreviews.set(item.id, preview);
  record.previewController = renderer;
  renderSheetTabs(item, preview);
  renderer.setSheetIndex(sheetPreviewIndex(item, record));
  resizeSheetPreview(item, preview);
  requestAnimationFrame(() => renderer.draw());
  return wrapper;
}

/** Opens a search hit inside the canvas preview without entering edit mode. */
function focusSheetPreviewCell(item, target = {}) {
  const record = getSheetRecord(item);
  const sheets = record?.store?.workbook?.sheets || [];
  let sheetIndex = target.sheetId
    ? sheets.findIndex((sheet) => sheet.sheetId === target.sheetId)
    : Number.isInteger(target.sheetIndex)
      ? target.sheetIndex
      : -1;
  if (sheetIndex < 0 || sheetIndex >= sheets.length) return false;
  const row = Math.max(0, Math.trunc(Number(target.row) || 0));
  const column = Math.max(0, Math.trunc(Number(target.column) || 0));
  if (!setSheetPreviewIndex(item, record, sheetIndex)) return false;
  const preview = sheetPreviews.get(item.id);
  if (!preview?.renderer || !preview.canvas?.isConnected) return false;
  preview.renderer.setStore(record.store, sheetIndex);
  preview.renderer.setSheetIndex(sheetIndex);
  preview.renderer.setSelection(row, column);
  preview.renderer.setHighlight(row, column);
  preview.renderer.scrollCellIntoView(row, column);
  syncSheetPreviewScroll(preview);
  renderSheetTabs(item, preview);
  const address = target.cellAddress || window.SheetFormula?.toA1?.(row, column) || `${column + 1}:${row + 1}`;
  const label = `${sheets[sheetIndex].name}!${address}`;
  if (preview.location) {
    preview.location.textContent = label;
    preview.location.hidden = false;
  }
  preview.wrapper.classList.add('is-search-located');
  preview.canvas.setAttribute('aria-label', `${item.title || '工作表'} · ${label} 搜索结果`);
  if (state.searchLocator?.targetId === item.id) {
    state.searchLocator.sheetCell = { canvas: preview.canvas, renderer: preview.renderer, row, column };
    positionSearchLocator();
  }
  showToast(`已定位到 ${label}`);
  return true;
}

function resizeSheetPreview(item, preview) {
  const width = Math.max(MIN_ITEM_SIZE, Number(item.w) || SHEET_ITEM_WIDTH);
  const height = Math.max(MIN_ITEM_SIZE, Number(item.h) || SHEET_ITEM_HEIGHT);
  const changed = preview.renderer.resize(width, height, 1);
  requestAnimationFrame(() => syncSheetPreviewScroll(preview));
  return changed;
}

/** Re-paints previews after a zoom or geometry change. */
function refreshSheetPreviews() {
  for (const [itemId, preview] of sheetPreviews) {
    const item = state.items.get(itemId);
    if (!item || !preview.canvas?.isConnected) {
      destroySheetPreview(itemId);
      continue;
    }
    if (!resizeSheetPreview(item, preview)) preview.renderer.requestDraw();
  }
}

export {
  focusSheetPreviewCell,
  mountSheetPreview,
  refreshSheetPreviews,
  refreshSheetTabs,
  renderSheetPreview,
  renderSheetTabs,
  resizeSheetPreview,
  syncSheetPreviewScroll
};
