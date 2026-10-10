

import { currentCanvas } from './catalog-model.js';

import { formatExportTimestamp, safeExportFilename } from './export-model.js';
import { showToast } from './interface-model.js';

import { canMutateItem, explainUnwritableLayer, getWritableLayer } from './layers-model.js';
import { clearMindNodeSelection } from './mindmap-editing-model.js';

import { getBoundsOfItems, getSelectedIds } from './selection-model.js';

import { state } from './state.js';

import { getNormalizedTableCellSelection } from './table-rendering-model.js';

import { makeId } from './utilities.js';
import { nextZ } from './canvas-state.js';
import { buildTableClipboardHtml, buildTableClipboardText } from './clipboard-model.js';

let pushUndoSnapshot,
  updateRedoButton,
  updateUndoButton,
  isGuestMode,
  getBoardPointFromClient,
  buildExportPngBlob,
  downloadBlob,
  detachConnectorsFor,
  removeItemElement,
  renderItem,
  markDirty,
  updateSelectionUI,
  cacheBoardSnapshot,
  indexRemoveItem,
  indexUpsertItem,
  enqueueOperation,
  updateCanvasStartState,
  refreshConnectorsFor;

function configureClipboard(callbacks) {
  ({
    pushUndoSnapshot,
    updateRedoButton,
    updateUndoButton,
    isGuestMode,
    getBoardPointFromClient,
    buildExportPngBlob,
    downloadBlob,
    detachConnectorsFor,
    removeItemElement,
    renderItem,
    markDirty,
    updateSelectionUI,
    cacheBoardSnapshot,
    indexRemoveItem,
    indexUpsertItem,
    enqueueOperation,
    updateCanvasStartState,
    refreshConnectorsFor
  } = callbacks);
}

function getSelectedTableClipboardData() {
  const selection = getNormalizedTableCellSelection();
  const item = selection && state.items.get(selection.itemId);
  if (!selection || !item || item.type !== 'table') {
    return null;
  }
  const rows = [];
  for (let rowIndex = selection.startRow; rowIndex <= selection.endRow; rowIndex += 1) {
    const sourceRow = Array.isArray(item.rows?.[rowIndex]) ? item.rows[rowIndex] : [];
    const row = [];
    for (let columnIndex = selection.startColumn; columnIndex <= selection.endColumn; columnIndex += 1) {
      row.push(String(sourceRow[columnIndex] || ''));
    }
    rows.push(row);
  }
  return {
    rows,
    header: Boolean(item.header && selection.startRow === 0)
  };
}

function handleCopyEvent(event) {
  if (window.__independentNotesActive) return;
  const data = getSelectedTableClipboardData();
  if (!data || !event.clipboardData) {
    return;
  }
  if (state.pendingCut) restorePendingCut({ select: false });
  event.preventDefault();
  event.clipboardData.setData('text/plain', buildTableClipboardText(data.rows));
  event.clipboardData.setData('text/html', buildTableClipboardHtml(data.rows, data.header));
  try {
    event.clipboardData.setData(
      'application/x-whiteboard-table+json',
      JSON.stringify({ version: 1, rows: data.rows, header: data.header })
    );
  } catch {
    // Some browsers expose only standard clipboard MIME types.
  }
  state.internalClipboardPreferred = false;
  showToast(`已复制 ${data.rows.length}×${data.rows[0]?.length || 0} 个单元格`);
}

function copySelection() {
  const ids = getSelectedIds();
  if (!ids.length) {
    showToast('请先选择要复制的元素');
    return false;
  }
  if (state.pendingCut) restorePendingCut({ select: false });
  state.clipboard = ids
    .map((id) => state.items.get(id))
    .filter(Boolean)
    .map((item) => JSON.parse(JSON.stringify(item)));
  if (!state.clipboard.length) {
    return false;
  }
  state.internalClipboardPreferred = true;
  showToast(`已复制 ${state.clipboard.length} 个元素`);
  return true;
}

async function cutSelection() {
  if (state.preparingCut) return;
  const ids = getSelectedIds();
  if (!ids.length) {
    showToast('请先选择要剪切的元素');
    return;
  }
  if (!isGuestMode() && (!state.connected || !state.joined || navigator.onLine === false)) {
    showToast('连接中断时暂时无法剪切，请重连后重试');
    return;
  }
  if (state.pendingCut) restorePendingCut({ select: false });
  const items = ids.map((id) => state.items.get(id));
  if (items.some((item) => !canMutateItem(item))) {
    showToast('选中的元素包含无法剪切的内容');
    return;
  }
  const boardId = state.boardId;
  const epoch = state.canvasEpoch;
  const cacheGeneration = state.cacheGeneration;
  state.preparingCut = true;
  try {
    if (state.cachePending || state.cachedSnapshotRevision !== state.revision) {
      const saved = await cacheBoardSnapshot();
      if (!saved) {
        showToast('本地保存未完成，暂时无法剪切');
        return;
      }
    }
    if (
      state.boardId !== boardId ||
      state.canvasEpoch !== epoch ||
      state.cacheGeneration !== cacheGeneration ||
      ids.some((id, index) => state.items.get(id) !== items[index] || !canMutateItem(items[index]))
    ) {
      showToast('选中内容已变化，请重新剪切');
      return;
    }
    const copies = items.map((item) => JSON.parse(JSON.stringify(item)));
    state.pendingCut = { boardId: state.boardId, items: copies, ids: new Set(ids) };
    state.clipboard = copies;
    state.internalClipboardPreferred = true;
    for (const id of ids) {
      state.items.delete(id);
      indexRemoveItem(id);
      removeItemElement(id);
      state.selectedIds.delete(id);
    }
    state.selectedId = null;
    clearMindNodeSelection();
    updateSelectionUI();
    updateCanvasStartState();
    updateUndoButton();
    updateRedoButton();
    showToast(`已剪切 ${ids.length} 个元素，请在当前画布粘贴`);
  } catch (error) {
    console.warn('Could not prepare cut', error);
    if (state.pendingCut) restorePendingCut();
    showToast('剪切失败，原元素已还原');
  } finally {
    state.preparingCut = false;
  }
}

function restorePendingCut({ select = true } = {}) {
  const pending = state.pendingCut;
  if (!pending) return;
  state.pendingCut = null;
  state.clipboard = [];
  state.internalClipboardPreferred = false;
  if (pending.boardId !== state.boardId) return;
  for (const item of pending.items) {
    if (state.items.has(item.id)) continue;
    state.items.set(item.id, item);
    indexUpsertItem(item);
    renderItem(item);
  }
  if (select) {
    state.selectedIds = new Set(pending.items.map((item) => item.id));
    state.selectedId = pending.items.at(-1)?.id || null;
  }
  refreshConnectorsFor(pending.items.map((item) => item.id));
  updateSelectionUI();
  updateCanvasStartState();
  updateUndoButton();
  updateRedoButton();
}

function duplicateSelection() {
  if (!copySelection()) {
    return;
  }
  pasteClipboard({ atPointer: false });
}

function cloneItemsWithNewIds(items, offsetX = 24, offsetY = 24) {
  const idMap = new Map(items.map((item) => [item.id, makeId(item.type || 'item')]));
  return items.map((item) => {
    const clone = JSON.parse(JSON.stringify(item));
    clone.id = idMap.get(item.id);
    if (clone.type === 'connector') {
      window.ConnectorCore.apply(clone);
      for (const key of ['source', 'target']) {
        const terminal = clone[key];
        terminal.fallback.x += offsetX;
        terminal.fallback.y += offsetY;
        if (terminal.binding && idMap.has(terminal.binding.id)) terminal.binding.id = idMap.get(terminal.binding.id);
        else {
          terminal.binding = null;
          terminal.status = 'normal';
        }
      }
      for (const constraint of clone.route.constraints)
        for (const key of ['a', 'b']) {
          constraint[key].x += offsetX;
          constraint[key].y += offsetY;
        }
      clone.fieldVersions = {};
      window.ConnectorCore.apply(clone);
    }
    clone.x += offsetX;
    clone.y += offsetY;
    clone.z = nextZ();
    return clone;
  });
}

function pasteClipboard({ atPointer = true } = {}) {
  if (!state.clipboard.length) {
    showToast('剪贴板为空');
    return;
  }
  const targetLayer = getWritableLayer();
  if (!targetLayer) {
    showToast(explainUnwritableLayer());
    return;
  }
  let offsetX = 24;
  let offsetY = 24;
  if (atPointer && state.lastCanvasPointer) {
    const pointer = getBoardPointFromClient(state.lastCanvasPointer.clientX, state.lastCanvasPointer.clientY);
    const bounds = state.clipboard.reduce(
      (result, item) => {
        const x = Number(item.x);
        const y = Number(item.y);
        const w = Number(item.w) || 0;
        const h = Number(item.h) || 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return result;
        result.left = Math.min(result.left, x, x + w);
        result.top = Math.min(result.top, y, y + h);
        result.right = Math.max(result.right, x, x + w);
        result.bottom = Math.max(result.bottom, y, y + h);
        return result;
      },
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    );
    if (Number.isFinite(bounds.left)) {
      offsetX = Math.round(pointer.x - (bounds.left + bounds.right) / 2);
      offsetY = Math.round(pointer.y - (bounds.top + bounds.bottom) / 2);
    }
  }
  const clones = cloneItemsWithNewIds(state.clipboard, offsetX, offsetY);
  const pendingCut = state.pendingCut?.boardId === state.boardId ? state.pendingCut : null;
  if (pendingCut) {
    pushUndoSnapshot();
    for (const item of pendingCut.items) state.items.set(item.id, item);
    detachConnectorsFor(pendingCut.items.map((item) => item.id));
    for (const item of pendingCut.items) state.items.delete(item.id);
  } else {
    pushUndoSnapshot();
  }
  const ops = [];
  for (const item of clones) {
    item.layerId = targetLayer.id;
    state.items.set(item.id, item);
    renderItem(item);
    ops.push({ kind: 'upsert', item });
  }
  state.selectedIds = new Set(clones.map((item) => item.id));
  state.selectedId = clones.length ? clones[clones.length - 1].id : null;
  clearMindNodeSelection();
  updateSelectionUI();
  if (pendingCut) ops.unshift({ kind: 'delete', ids: pendingCut.items.map((item) => item.id) });
  if (pendingCut) state.pendingCut = null;
  const queued = enqueueOperation(ops.length === 1 ? ops[0] : { kind: 'batch', ops });
  if (!queued && pendingCut) {
    state.pendingCut = pendingCut;
    for (const item of clones) {
      state.items.delete(item.id);
      indexRemoveItem(item.id);
      removeItemElement(item.id);
    }
    restorePendingCut();
    showToast('粘贴未能保存，已还原剪切的元素');
    return;
  }
  if (pendingCut) {
    state.clipboard = [];
    state.internalClipboardPreferred = false;
    updateUndoButton();
    updateRedoButton();
  }
  markDirty(true);
}

async function copySelectionAsImage() {
  const ids = getSelectedIds();
  if (!ids.length) {
    showToast('请先选择要复制的元素');
    return;
  }
  const bounds = getBoundsOfItems(ids);
  if (!bounds) {
    return;
  }
  try {
    const blob = await buildExportPngBlob(bounds, new Set(ids));
    if (!blob) {
      throw new Error('Copy image failed');
    }
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('已复制到剪贴板');
    } else {
      const downloadMode = await downloadBlob(
        blob,
        `${safeExportFilename(currentCanvas()?.name || '未命名画布')}-${formatExportTimestamp(new Date())}.png`
      );
      showToast(downloadMode === 'preview' ? '已打开图片预览，请长按保存' : '已下载选中内容图片');
    }
  } catch (error) {
    console.error(error);
    showToast('复制失败，请重试');
  }
}
export {
  getSelectedTableClipboardData,
  handleCopyEvent,
  copySelection,
  cutSelection,
  restorePendingCut,
  duplicateSelection,
  cloneItemsWithNewIds,
  pasteClipboard,
  copySelectionAsImage
};

export { configureClipboard };
