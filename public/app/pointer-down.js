
import { touchPreferences } from './touch-preferences.js';
import { updateSelectionUI } from './selection.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, MAX_ZOOM, MIN_ZOOM } from './constants.js';

import { getBrush, isEditableCanvasItem } from './format-actions-model.js';

import { showToast } from './interface-model.js';

import { canMutateItem, isLayerLocked } from './layers-model.js';
import { isTransformableItem } from './marquee-model.js';

import { canvasInteraction, getPanSelectionCandidate, startPanning } from './pan.js';
import {
  getActiveGesturePointerId,
  getActiveTouchPointerIds,
  hasActivePen,
  trackPointer,
  untrackPointer
} from './pan-model.js';

import { state } from './state.js';
import { getTableHeightForRows } from './table-rendering-model.js';

import { clamp, cssEscape, isEditableTarget } from './utilities.js';

let cancelWheelZoomAnimation, getBoardPoint, setZoom, beginPendingMove, finishConnectorDraft, startConnectorDraft, startDrawing, startShape, createEditableItem, startEditingItem, startEraser, setColor, finishPinch, startPinch, sampleColorAtPoint, startSmudge, addAmapItem, addTableItem, startPendingCanvasIntent, selectMindNode, startMindNodeEdit, hideSectionHoverLabel, rememberCanvasPointer, closePopovers, hitTestItem, renderItem, startSectionDraft, selectItem, openSheetEditor, restoreNavigationTool, startTransform;

function configurePointerDown(callbacks) {
  ({cancelWheelZoomAnimation,
getBoardPoint,
setZoom,
beginPendingMove,
finishConnectorDraft,
startConnectorDraft,
startDrawing,
startShape,
createEditableItem,
startEditingItem,
startEraser,
setColor,
finishPinch,
startPinch,
sampleColorAtPoint,
startSmudge,
addAmapItem,
addTableItem,
startPendingCanvasIntent,
selectMindNode,
startMindNodeEdit,
hideSectionHoverLabel,
rememberCanvasPointer,
closePopovers,
hitTestItem,
renderItem,
startSectionDraft,
selectItem,
openSheetEditor,
restoreNavigationTool,
startTransform} = callbacks);
}

function onBoardDoubleClick(event) {
  if (!state.boardId) return;
  if (
    event.button !== 0 ||
    !['select', 'pan', 'text', 'note', 'table', 'mindmap'].includes(state.tool) ||
    event.sourceCapabilities?.firesTouchEvents ||
    event.target.closest?.('[contenteditable="true"], [data-handle], button, input, textarea, select')
  ) {
    return;
  }
  const pointElements =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(event.clientX, event.clientY)
      : [document.elementFromPoint(event.clientX, event.clientY)].filter(Boolean);
  if (pointElements.some((element) => element.closest?.('[contenteditable="true"]'))) return;
  const closestFromPoint = (selector, root = null) => {
    for (const element of pointElements) {
      const candidate = element.closest?.(selector);
      if (candidate && (!root || root.contains(candidate))) return candidate;
    }
    return null;
  };
  let itemElement = event.target.closest?.('.board-item');
  if (!itemElement?.isConnected) itemElement = null;
  if (!itemElement) itemElement = closestFromPoint('.board-item');
  let item = itemElement && state.items.get(itemElement.dataset.itemId);
  if (!item) {
    item = hitTestItem(getBoardPoint(event));
    itemElement = item && document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  }
  // A spreadsheet opens its own editor surface instead of being edited in place.
  if (item && item.type === 'sheet') {
    event.preventDefault();
    event.stopPropagation();
    selectItem(item.id);
    openSheetEditor(item.id);
    return;
  }
  if (!isEditableCanvasItem(item) || !canMutateItem(item)) return;

  if (item.type === 'mindmap') {
    const nodeElement = closestFromPoint('[data-mn-path]', itemElement);
    if (!nodeElement) return;
    const path = nodeElement.dataset.mnPath === '' ? [] : nodeElement.dataset.mnPath.split('.').map(Number);
    event.preventDefault();
    event.stopPropagation();
    selectMindNode(item.id, path);
    startMindNodeEdit(item, path, { focusAnchor: { x: event.clientX, y: event.clientY } });
    return;
  }

  let focusCell = null;
  if (item.type === 'table') {
    const cell = closestFromPoint('td, th', itemElement);
    if (!cell) return;
    focusCell = { row: Number(cell.dataset.row), column: Number(cell.dataset.column) };
  }

  event.preventDefault();
  event.stopPropagation();
  selectItem(item.id);
  startEditingItem(item.id, {
    isNew: item.id === state.draftEditableId,
    focusTable: item.type === 'table',
    focusCell,
    focusAnchor: { x: event.clientX, y: event.clientY }
  });
}

function getToolReadabilityMetric(tool) {
  if (tool === 'pen') {
    return { worldSize: Math.max(1, state.size * getBrush().width), minimumScreenSize: 1 };
  }
  if (tool === 'eraser') return { worldSize: state.eraserSize, minimumScreenSize: 8 };
  if (tool === 'smudge') return { worldSize: Math.max(12, state.size * 3), minimumScreenSize: 10 };
  if (tool === 'shape' || tool === 'connector') return { worldSize: 82, minimumScreenSize: 64 };
  if (tool === 'section') return { worldSize: 540, minimumScreenSize: 180 };
  if (tool === 'text') return { worldSize: Math.max(10, state.fontSize), minimumScreenSize: 14 };
  if (tool === 'note') return { worldSize: 150, minimumScreenSize: 100 };
  if (tool === 'table') {
    const rows = clamp(Number(state.tableDraft?.rows) || 3, 1, MAX_TABLE_ROWS);
    const columns = clamp(Number(state.tableDraft?.columns) || 3, 1, MAX_TABLE_COLUMNS);
    return { worldSize: Math.min(columns * 110, getTableHeightForRows(rows)), minimumScreenSize: 120 };
  }
  if (tool === 'mindmap') return { worldSize: 280, minimumScreenSize: 170 };
  if (tool === 'amap-map') return { worldSize: 420, minimumScreenSize: 240 };
  if (tool === 'amap-search') return { worldSize: 380, minimumScreenSize: 240 };
  if (tool === 'amap-route') return { worldSize: 430, minimumScreenSize: 240 };
  if (tool === 'sticker') return { worldSize: 80, minimumScreenSize: 64 };
  return null;
}

function ensureReadableToolZoom(tool, anchor = null) {
  const metric = getToolReadabilityMetric(tool);
  if (!metric || !canvasInteraction?.getReadableToolZoom) return false;
  const nextZoom = canvasInteraction.getReadableToolZoom({
    currentZoom: state.zoom,
    minimum: MIN_ZOOM,
    maximum: MAX_ZOOM,
    ...metric
  });
  if (nextZoom <= state.zoom + Number.EPSILON) return false;
  setZoom(nextZoom, anchor);
  return true;
}

function ensureReadableToolZoomForEvent(tool, event) {
  return ensureReadableToolZoom(tool, { x: event.clientX, y: event.clientY });
}

function onBoardPointerDown(event, confirmedTap = false) {
  if (!state.boardId) return;
  cancelWheelZoomAnimation();
  hideSectionHoverLabel();
  rememberCanvasPointer(event);
  if (state.pendingCanvasPlacement && event.button === 0) {
    event.preventDefault();
    event.stopPropagation();
    
    return;
  }
  if (state.skipPointerId === event.pointerId) {
    state.skipPointerId = null;
    return;
  }
  if (event.button !== 0 && event.button !== 1) {
    return;
  }
  if (state.tool === 'pen' && event.altKey) {
    event.preventDefault();
    closePopovers();
    const color = sampleColorAtPoint(getBoardPoint(event));
    if (color) {
      setColor(color);
      showToast('已取色');
    }
    return;
  }
  closePopovers();
  if (event.pointerType === 'touch' && hasActivePen()) {
    event.preventDefault();
    return;
  }
  if (event.pointerType === 'pen' && state.pinch) {
    finishPinch();
  }
  if (!confirmedTap) trackPointer(event);
  if (state.pinch) {
    if (!state.pinch.pointers.has(event.pointerId)) {
      untrackPointer(event);
    }
    return;
  }
  const touchIds = getActiveTouchPointerIds();
  if (event.pointerType === 'touch' && touchIds.length === 2 && !hasActivePen()) {
    const firstId = touchIds.find((id) => id !== event.pointerId);
    if (firstId !== undefined) {
      startPinch(firstId, event);
      return;
    }
  }
  const activeOwner = getActiveGesturePointerId();
  if (activeOwner !== null && activeOwner !== event.pointerId) {
    return;
  }
  if (!confirmedTap && event.pointerType === 'touch' && ['text','note','table','mindmap','amap-map','amap-search','amap-route'].includes(state.tool) && !event.target.closest('[data-handle],[contenteditable="true"]')) {
    startPanning(event, { deferred: true, onTap: () => onBoardPointerDown(event, true) });
    return;
  }
  const textCard = event.target.closest('.text-card, .note-card');
  const initialTarget = textCard?.isContentEditable
    ? 'editable'
    : event.target.dataset.handle
      ? 'handle'
      : event.target.closest('.board-item')
        ? 'item'
        : 'canvas';
  const initialIntent = canvasInteraction?.resolvePointerIntent({
    tool: state.tool,
    pointerType: event.pointerType || 'mouse',
    button: event.button,
    spacePan: state.spacePan,
    target: initialTarget,
    editing: Boolean(state.editingId),
    penOnly: touchPreferences().penOnly
  });
  if (
    initialIntent === 'pan' &&
    (state.spacePan || event.button === 1 || (event.pointerType === 'touch' && state.tool !== 'select'))
  ) {
    startPanning(event, {
      deferred: !state.spacePan && event.button !== 1,
      selectionId: getPanSelectionCandidate(event)
    });
    return;
  }
  if (initialIntent === 'edit' || textCard?.isContentEditable) {
    return;
  }
  if (state.connectorDraft) {
    finishConnectorDraft(event);
    return;
  }
  if (state.tool === 'smudge') {
    ensureReadableToolZoomForEvent('smudge', event);
    startSmudge(event);
    return;
  }
  if (state.tool === 'connector') {
    ensureReadableToolZoomForEvent('connector', event);
    startConnectorDraft(event);
    return;
  }
  if (state.tool === 'eraser') {
    ensureReadableToolZoomForEvent('eraser', event);
    startEraser(event);
    return;
  }
  if (state.tool === 'pen') {
    ensureReadableToolZoomForEvent('pen', event);
    startDrawing(event);
    return;
  }
  if (state.tool === 'shape') {
    ensureReadableToolZoomForEvent('shape', event);
    startShape(event);
    return;
  }
  if (state.tool === 'section') {
    ensureReadableToolZoomForEvent('section', event);
    startSectionDraft(event);
    return;
  }
  let itemElement = event.target.closest('.board-item');
  const handle = event.target.dataset.handle;

  if (itemElement) {
    const lockedItem = state.items.get(itemElement.dataset.itemId);
    if (lockedItem && isLayerLocked(lockedItem) && state.tool !== 'pen' && state.tool !== 'shape') {
      return;
    }
  }

  if (!itemElement && (state.tool === 'select' || state.tool === 'pan')) {
    const hit = hitTestItem(getBoardPoint(event));
    if (hit) {
      renderItem(hit);
      itemElement = document.querySelector(`.board-item[data-item-id="${cssEscape(hit.id)}"]`);
    }
  }

  if (handle && itemElement) {
    startTransform(event, itemElement, handle);
    return;
  }

  if (
    itemElement &&
    !handle &&
    (state.tool === 'table' ||
      state.tool === 'mindmap' ||
      (state.tool === 'note' && itemElement.dataset.type !== 'note') ||
      (state.tool === 'text' && itemElement.dataset.type !== 'text'))
  ) {
    itemElement = null;
  }

  if (itemElement && event.pointerType === 'touch' && state.touchMultiSelect && !handle) {
    const id = itemElement.dataset.itemId;
    if (state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id);
    state.selectedId = [...state.selectedIds].at(-1) || null;
    updateSelectionUI(); event.preventDefault(); return;
  }
  if (itemElement) {
    const item = state.items.get(itemElement.dataset.itemId);
    if (!item) {
      return;
    }
    // A confirmed tap runs on pointerup; never start a drag owned by that ended pointer.
    if (confirmedTap) {
      selectItem(item.id);
      if (canMutateItem(item) && ['text', 'note', 'table'].includes(item.type)) startEditingItem(item.id, { focusTable: item.type === 'table' });
      return;
    }
    if (item.type === 'table') {
      if (state.selectedIds.size > 1 && state.selectedIds.has(item.id)) {
        beginPendingMove(event, itemElement);
        return;
      }
      selectItem(item.id);
      if (!isEditableTarget(event.target)) {
        beginPendingMove(event, itemElement);
      }
      return;
    }
    if (item.type === 'image') {
      if (state.selectedIds.size > 1 && state.selectedIds.has(item.id)) {
        beginPendingMove(event, itemElement);
        return;
      }
      selectItem(item.id);
      beginPendingMove(event, itemElement);
      return;
    }
    if (item.type === 'note') {
      if (state.selectedIds.size > 1 && state.selectedIds.has(item.id)) {
        beginPendingMove(event, itemElement);
        return;
      }
      selectItem(item.id);
      if (!isEditableTarget(event.target)) {
        beginPendingMove(event, itemElement);
      }
      return;
    }
    if (item.type === 'text') {
      if (state.selectedIds.size > 1 && state.selectedIds.has(item.id)) {
        beginPendingMove(event, itemElement);
        return;
      }
      selectItem(item.id);
      if (!isEditableTarget(event.target)) {
        beginPendingMove(event, itemElement);
      }
      return;
    }
    if (!isTransformableItem(item)) {
      selectItem(null);
      return;
    }
    if (!state.selectedIds.has(item.id)) {
      selectItem(item.id);
    }
    if (!isEditableTarget(event.target) && item.type !== 'text' && item.type !== 'note') {
      beginPendingMove(event, itemElement);
    }
    return;
  }

  if (state.tool === 'select') {
    startPendingCanvasIntent(event);
    return;
  }

  if (state.tool === 'pan') {
    startPanning(event, { deferred: true, selectionId: null });
    return;
  }

  if (state.tool === 'pen') {
    startDrawing(event);
    return;
  }

  if (state.tool === 'shape') {
    startShape(event);
    return;
  }

  if (state.tool === 'note') {
    ensureReadableToolZoomForEvent('note', event);
    const item = createEditableItem('note', getBoardPoint(event));
    if (item) {
      startEditingItem(item.id, { isNew: true });
      restoreNavigationTool();
    }
    return;
  }

  if (state.tool === 'text') {
    ensureReadableToolZoomForEvent('text', event);
    const item = createEditableItem('text', getBoardPoint(event));
    if (item) {
      startEditingItem(item.id, { isNew: true });
      restoreNavigationTool();
    }
    return;
  }

  if (state.tool === 'table') {
    const dimensions = state.tableDraft;
    if (!dimensions) {
      showToast('请先点击表格工具并设置行数和列数');
      return;
    }
    ensureReadableToolZoomForEvent('table', event);
    const rows = Array.from({ length: dimensions.rows }, () => Array.from({ length: dimensions.columns }, () => ''));
    const item = addTableItem(getBoardPoint(event), rows, false);
    if (item) {
      state.tableDraft = null;
      restoreNavigationTool();
    }
    return;
  }

  if (['amap-map', 'amap-search', 'amap-route'].includes(state.tool)) {
    ensureReadableToolZoomForEvent(state.tool, event);
    if (addAmapItem(state.tool, getBoardPoint(event))) restoreNavigationTool();
    return;
  }

  selectItem(null);
}

export {
  ensureReadableToolZoom,
  ensureReadableToolZoomForEvent,
  getToolReadabilityMetric,
  onBoardDoubleClick,
  onBoardPointerDown
};

export { configurePointerDown };
