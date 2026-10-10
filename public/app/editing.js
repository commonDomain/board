
import { serializeItems, snapshotItems } from './history-controller-model.js';

import { DEFAULT_NOTE_APPEARANCE, DEFAULT_TEXT_BORDER_COLOR, DEFAULT_TEXT_FILL } from './constants.js';

import { normalizeFontFamily, updateFormatControls } from './format-actions-model.js';

import { showToast } from './interface-model.js';

import { canMutateItem, explainUnwritableLayer } from './layers-model.js';

import { state } from './state.js';

import {
  clearTableCellSelection,
  getNormalizedTableCellSelection,
  getTableCellCoordinates,
  getTableColumnCount,
  getTableColumnWidths,
  syncTableFromDom,
  updateTableCellSelectionClasses
} from './table-rendering-model.js';

import { selectionBelongsToEditable } from './text-input-model.js';

import { captureInteractionItems, interactionFieldsForMode } from './transform-model.js';

import { cssEscape, makeId, placeCursorAtEnd, placeCursorAtPoint } from './utilities.js';
import { nextZ } from './canvas-state.js';

let applyDocumentState,
  documentDiffOps,
  pushUndoSnapshot,
  sendOpsPayload,
  snapshotDocument,
  getBoardPoint,
  scheduleFloatingToolbarPosition,
  updateFloatingFormatBar,
  ensureEditableZoom,
  getTextCaretLocation,
  restoreTextCaretLocation,
  updateTextListControls,
  updateContextPanel,
  broadcastUpsert,
  upsertItem,
  setActiveCursorState,
  captureViewportPointer,
  removeItemElement,
  renderItem,
  markDirty,
  selectItem,
  indexRemoveItem,
  enqueueOperation,
  autosizeTextItem,
  ensureTextListLinePlaceholder,
  rememberTextSelection,
  scheduleTextAutosize,
  syncTextItemFromDom,
  startTransform;

function configureEditing(callbacks) {
  ({
    applyDocumentState,
    documentDiffOps,
    pushUndoSnapshot,
    sendOpsPayload,
    snapshotDocument,
    getBoardPoint,
    scheduleFloatingToolbarPosition,
    updateFloatingFormatBar,
    ensureEditableZoom,
    getTextCaretLocation,
    restoreTextCaretLocation,
    updateTextListControls,
    updateContextPanel,
    broadcastUpsert,
    upsertItem,
    setActiveCursorState,
    captureViewportPointer,
    removeItemElement,
    renderItem,
    markDirty,
    selectItem,
    indexRemoveItem,
    enqueueOperation,
    autosizeTextItem,
    ensureTextListLinePlaceholder,
    rememberTextSelection,
    scheduleTextAutosize,
    syncTextItemFromDom,
    startTransform
  } = callbacks);
}

function startEditingItem(itemId, options = {}) {
  const item = state.items.get(itemId);
  if (item?.taskRef && window.MusePlanning?.enabled && !options.editLinkedSource) {
    window.MusePlanning.editTask(item.taskRef); return;
  }
  if (!item || (item.type !== 'text' && item.type !== 'note' && item.type !== 'table')) {
    return;
  }
  if (!canMutateItem(item)) {
    showToast(explainUnwritableLayer(item.layerId));
    return;
  }
  if (state.editingId === itemId) {
    const editingRoot = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
    const editable = editingRoot?.querySelector('[contenteditable="true"]');
    updateContextPanel();
    requestAnimationFrame(() => {
      if (editable && document.activeElement !== editable) editable.focus({ preventScroll: true });
      if (editable && options.focusAnchor) placeCursorAtPoint(editable, options.focusAnchor);
      rememberTextSelection();
      if (item.type === 'text' || item.type === 'note') {
        updateFloatingFormatBar(item);
        scheduleFloatingToolbarPosition();
      }
    });
    return;
  }
  if (options.focusAnchor) {
    ensureEditableZoom(options.focusAnchor, item);
  }
  if (state.editingId && state.editingId !== itemId) {
    finishEditing();
  }
  state.pendingMove = null;
  state.editSnapshot = snapshotItems();
  state.editingId = item.id;
  state.planningEdit = item.taskRef && window.MusePlanning?.enabled ? { ref: item.taskRef, task: structuredClone(window.MusePlanning.getTask(item.taskRef)) } : null;
  state.editingCreatedId = options.isNew ? item.id : null;
  state.editingUndoDepth = state.undoStack.length;
  state.editingHistoryInput = null;
  state.textSelection = null;
  state.activeTextLine = null;
  if (item.type === 'text' || item.type === 'note') {
    state.color = item.color || state.color;
    state.fontSize = item.fontSize || state.fontSize;
    state.fontFamily = normalizeFontFamily(item.fontFamily);
    state.bold = Boolean(item.bold);
    state.align = item.align || 'left';
    updateFormatControls();
  }
  renderItem(item);
  const freshElement = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  let editable = freshElement && freshElement.querySelector('[contenteditable="true"]');
  if (item.type === 'table' && options.focusCell) {
    editable =
      freshElement?.querySelector(
        `[data-row="${options.focusCell.row}"][data-column="${options.focusCell.column}"][contenteditable="true"]`
      ) || editable;
  }
  if (editable) {
    freshElement.classList.add('editing');
    requestAnimationFrame(() => {
      editable.focus();
      if (!placeCursorAtPoint(editable, options.focusAnchor)) {
        placeCursorAtEnd(editable.querySelector('.text-list-line:last-child .text-list-content') || editable);
      }
      rememberTextSelection();
      autosizeTextItem(freshElement, item, editable);
      if (item.type === 'text' || item.type === 'note') {
        updateFloatingFormatBar(item);
        scheduleFloatingToolbarPosition();
      }
    });
  }
  updateContextPanel();
}

function createEditableItem(type, point) {
  const item = {
    id: makeId(type),
    type,
    x: point.x,
    y: point.y,
    w: type === 'note' ? 210 : 160,
    h: type === 'note' ? 150 : 32,
    rotation: 0,
    z: nextZ(),
    text: '',
    color: state.color,
    fontSize: type === 'note' ? 16 : state.fontSize,
    fontFamily: state.fontFamily,
    bold: state.bold,
    align: state.align
  };
  if (type === 'text') {
    item.textFill = DEFAULT_TEXT_FILL;
    item.textBorderColor = DEFAULT_TEXT_BORDER_COLOR;
    item.textBorderStyle = 'solid';
  }
  if (type === 'note') {
    Object.assign(item, DEFAULT_NOTE_APPEARANCE);
  }
  if (!upsertItem(item, { select: false })) {
    return null;
  }
  state.draftEditableId = item.id;
  return item;
}

function onTextPointerDown(event) {
  if (event.currentTarget.isContentEditable && !isTemporaryPanGestureEvent(event)) {
    state.editingHistoryInput = null;
    const line = event.target.closest('.text-list-line');
    const itemId = event.currentTarget.dataset.itemId || state.editingId;
    if (line && itemId) {
      state.activeTextLine = {
        itemId,
        lineIndex: Number(line.dataset.lineIndex) || 0,
        column: 0
      };
      const item = state.items.get(itemId);
      if (item) updateTextListControls(item, state.activeTextLine);
    }
    event.stopPropagation();
  }
}

function onTextPointerUp(event) {
  if (
    event.button !== 0 ||
    !event.currentTarget.isContentEditable ||
    event.target.closest?.('[contenteditable="false"]') ||
    isTemporaryPanGestureEvent(event)
  )
    return;
  const itemId = event.currentTarget.dataset.itemId;
  if (itemId !== state.editingId) return;
  const editable = event.currentTarget;
  const point = { x: event.clientX, y: event.clientY };
  requestAnimationFrame(() => {
    if (state.editingId !== itemId) return;
    if (window.getSelection()?.isCollapsed) placeCursorAtPoint(editable, point);
    rememberTextSelection();
  });
}

function isTemporaryPanGestureEvent(event) {
  return state.spacePan || event.button === 1;
}

function onNoteMoveHandlePointerDown(event) {
  if (isTemporaryPanGestureEvent(event)) {
    return;
  }
  const itemElement = event.currentTarget.closest('.board-item');
  if (!itemElement) {
    return;
  }
  startTransform(event, itemElement, 'move');
}

function onTablePointerDown(event) {
  if (isTemporaryPanGestureEvent(event)) {
    return;
  }
  const itemElement = event.currentTarget.closest('.board-item');
  const item = itemElement && state.items.get(itemElement.dataset.itemId);
  if (event.target.closest('.table-move-handle, .table-column-handle, .table-add-control')) {
    return;
  }
  const cell = event.target.closest('td, th');
  if (item && state.editingId === item.id && cell) {
    startTableCellDrag(event, item, cell);
    event.stopPropagation();
  }
}

function startTableCellDrag(event, item, cell) {
  const point = getTableCellCoordinates(cell);
  if (!point || event.button !== 0) {
    return;
  }
  state.tableFocus = { itemId: item.id, ...point };
  updateContextPanel();
  const existing = getNormalizedTableCellSelection();
  const extending = event.shiftKey && existing?.itemId === item.id;
  state.tableCellDrag = {
    itemId: item.id,
    pointerId: event.pointerId,
    start: extending ? { row: existing.startRow, column: existing.startColumn } : point,
    current: point,
    startClientX: event.clientX,
    startClientY: event.clientY,
    active: extending
  };
  if (extending) {
    event.preventDefault();
    state.tableCellSelection = { itemId: item.id, start: state.tableCellDrag.start, end: point };
    window.getSelection()?.removeAllRanges();
    updateTableCellSelectionClasses(item.id);
  } else if (state.tableCellSelection?.itemId === item.id) {
    clearTableCellSelection(item.id);
  }
}

function continueTableCellDrag(event) {
  const drag = state.tableCellDrag;
  if (!drag || event.pointerId !== drag.pointerId) {
    return false;
  }
  const itemElement = document.querySelector(`.board-item[data-item-id="${cssEscape(drag.itemId)}"]`);
  const elementAtPointer = document.elementFromPoint(event.clientX, event.clientY);
  const cell = elementAtPointer?.closest?.('td, th');
  if (!cell || !itemElement?.contains(cell)) {
    return true;
  }
  const point = getTableCellCoordinates(cell);
  if (!point) {
    return true;
  }
  const crossedCell = point.row !== drag.start.row || point.column !== drag.start.column;
  const moved = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) >= 4;
  if (!drag.active && !(crossedCell && moved)) {
    return true;
  }
  event.preventDefault();
  drag.active = true;
  drag.current = point;
  state.tableCellSelection = { itemId: drag.itemId, start: drag.start, end: point };
  window.getSelection()?.removeAllRanges();
  updateTableCellSelectionClasses(drag.itemId);
  return true;
}

function finishTableCellDrag(event, cancelled = false) {
  const drag = state.tableCellDrag;
  if (!drag || event.pointerId !== drag.pointerId) {
    return false;
  }
  state.tableCellDrag = null;
  if (cancelled) {
    clearTableCellSelection(drag.itemId);
    return true;
  }
  if (drag.active) {
    event.preventDefault();
    const selection = getNormalizedTableCellSelection();
    const rowCount = selection ? selection.endRow - selection.startRow + 1 : 0;
    const columnCount = selection ? selection.endColumn - selection.startColumn + 1 : 0;
    showToast(`已选择 ${rowCount}×${columnCount} 个单元格`);
  }
  return true;
}

function onTableMoveHandlePointerDown(event) {
  if (isTemporaryPanGestureEvent(event)) {
    return;
  }
  const itemElement = event.currentTarget.closest('.board-item');
  if (!itemElement) {
    return;
  }
  startTransform(event, itemElement, 'move');
}

function onTableColumnHandlePointerDown(event) {
  if (isTemporaryPanGestureEvent(event)) {
    return;
  }
  const itemElement = event.currentTarget.closest('.board-item');
  const item = itemElement && state.items.get(itemElement.dataset.itemId);
  if (!item || item.type !== 'table') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const columnCount = getTableColumnCount(item);
  state.interaction = {
    id: item.id,
    mode: 'table-column',
    columnIndex: Number(event.currentTarget.dataset.column),
    beforeById: captureInteractionItems([item.id], 'table-column'),
    ownedFields: interactionFieldsForMode(item, 'table-column'),
    startPoint: getBoardPoint(event),
    startItem: { ...item },
    startWidths: getTableColumnWidths(item, columnCount),
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    changed: false
  };
  state.gestureSession = { kind: 'resize', pointerId: event.pointerId, targetIds: [item.id] };
  setActiveCursorState('col-resize');
  captureViewportPointer(event.pointerId);
}

function onTableClick(event) {
  if (state.tool !== 'table' && !(state.tool === 'select' && event.detail >= 2)) {
    return;
  }
  event.stopPropagation();
  if (!event.target.closest('td, th')) {
    return;
  }
  const itemId = event.currentTarget.dataset.itemId;
  if (!itemId) {
    return;
  }
  if (state.editingId === itemId) {
    return;
  }
  const cell = event.target.closest('td, th');
  selectItem(itemId);
  startEditingItem(itemId, {
    isNew: false,
    focusTable: true,
    focusCell: cell
      ? {
          row: Number(cell.dataset.row),
          column: Number(cell.dataset.column)
        }
      : null,
    focusAnchor: { x: event.clientX, y: event.clientY }
  });
}

function onEditableInputImmediate(event) {
  const editable = event.target;
  if (!editable.matches('.text-card[contenteditable="true"], .note-card[contenteditable="true"]')) return;
  const itemElement = editable.closest('.board-item');
  const item = itemElement && state.items.get(itemElement.dataset.itemId);
  if (!item || (item.type !== 'text' && item.type !== 'note')) return;
  normalizeStructuredTextLinePlaceholders(editable);
  if (item.type === 'text') scheduleTextAutosize(itemElement, item, editable);
}

function normalizeStructuredTextLinePlaceholders(editable) {
  if (editable.dataset.structuredLines !== 'true') return;
  const selection = window.getSelection();
  const caret = selectionBelongsToEditable(selection, editable) ? getTextCaretLocation(editable) : null;
  let changed = false;
  editable.querySelectorAll('.text-list-content').forEach((content) => {
    changed = ensureTextListLinePlaceholder(content) || changed;
  });
  if (changed && caret) restoreTextCaretLocation(editable, caret);
}

function onEditableInput(event) {
  const itemElement = event.target.closest('.board-item');
  if (!itemElement) {
    return;
  }
  const item = state.items.get(itemElement.dataset.itemId);
  if (!item) {
    return;
  }
  if ((item.type === 'text' || item.type === 'note') && event.target.matches('.text-card, .note-card')) {
    syncTextItemFromDom(itemElement, item, event.target);
    upsertItem(item, { rerender: false, history: false });
  }
  if (item.type === 'table' && event.target.matches('td, th')) {
    syncTableFromDom(itemElement, item);
    upsertItem(item, { rerender: false, history: false });
  }
}

function finishEditing() {
  const editingId = state.editingId;
  const editRecordedHistory =
    Number.isInteger(state.editingUndoDepth) && state.undoStack.length > state.editingUndoDepth;
  let removedEmptyDraft = false;
  let updatedItem = null;
  let clearTableSelection = false;
  let changed = false;
  if (editingId) {
    const item = state.items.get(editingId);
    const editingRoot = document.querySelector(`.board-item[data-item-id="${cssEscape(editingId)}"]`);
    const editable = editingRoot && editingRoot.querySelector('[contenteditable="true"]');
    if (item && editingRoot) {
      if (item.type === 'table') {
        syncTableFromDom(editingRoot, item);
        state.items.set(item.id, item);
        updatedItem = item;
        clearTableSelection = true;
      } else if (editable) {
        syncTextItemFromDom(editingRoot, item, editable);
        state.items.set(item.id, item);
        if (!item.text.trim()) {
          state.items.delete(editingId);
          indexRemoveItem(editingId);
          removeItemElement(editingId);
          removedEmptyDraft = true;
          if (state.draftEditableId === editingId) {
            state.draftEditableId = null;
          }
        } else {
          updatedItem = item;
          if (item.text.trim()) {
            state.draftEditableId = null;
          }
        }
      }
    }
  }
  if (state.editSnapshot) {
    const beforeItems = state.editSnapshot;
    state.editSnapshot = null;
    changed = serializeItems(beforeItems) !== serializeItems(snapshotItems());
    if (changed && !editRecordedHistory) {
      const undoItems =
        editingId && state.editingCreatedId === editingId
          ? beforeItems.filter((item) => item.id !== editingId)
          : beforeItems;
      pushUndoSnapshot(undoItems);
    }
  }
  state.editingId = null;
  state.editingCreatedId = null;
  state.editingUndoDepth = null;
  state.editingHistoryInput = null;
  state.textSelection = null;
  state.activeTextLine = null;
  state.tableCellDrag = null;
  clearTableCellSelection(editingId);
  document.querySelectorAll('.board-item.editing').forEach((node) => node.classList.remove('editing'));
  if (clearTableSelection && state.selectedId === editingId) {
    state.selectedId = null;
    state.selectedIds.delete(editingId);
    document.querySelectorAll('.board-item').forEach((node) => {
      node.classList.remove('selected');
      node.querySelector('.selection-frame')?.remove();
    });
  }
  if (updatedItem && state.planningEdit?.task) {
    const { ref, task } = state.planningEdit, title = String(updatedItem.text || '').split('\n')[0].trim();
    if (title && title !== task.title) window.MusePlanning.updateTask(ref, { title }, task.revision).catch(error => showToast(error.message));
  }
  state.planningEdit = null;
  if (updatedItem) renderItem(updatedItem);
  if (state.selectedId && state.items.has(state.selectedId)) {
    const item = state.items.get(state.selectedId);
    if (item && item.id !== updatedItem?.id) {
      renderItem(item);
    }
  }
  if (removedEmptyDraft && editingId) {
    enqueueOperation({ kind: 'delete', ids: [editingId] });
    markDirty(true);
  } else if (updatedItem && changed) {
    broadcastUpsert(updatedItem);
    markDirty(true);
  }
  updateContextPanel();
}

function cancelEditing() {
  if (!state.editingId || !state.editSnapshot) {
    finishEditing();
    return;
  }
  const target = snapshotDocument(state.editSnapshot);
  const ops = documentDiffOps(target);
  state.editSnapshot = null;
  state.editingId = null;
  state.planningEdit = null;
  state.editingCreatedId = null;
  state.editingUndoDepth = null;
  state.editingHistoryInput = null;
  state.draftEditableId = null;
  state.textSelection = null;
  state.activeTextLine = null;
  state.tableCellDrag = null;
  clearTableCellSelection();
  applyDocumentState(target);
  sendOpsPayload(ops);
  if (ops.length) {
    markDirty(true);
  }
}

function deleteDraftEditable(itemId) {
  const item = state.items.get(itemId);
  if (!item || (item.type !== 'text' && item.type !== 'note')) {
    state.draftEditableId = null;
    return;
  }
  pushUndoSnapshot();
  state.items.delete(itemId);
  indexRemoveItem(itemId);
  removeItemElement(itemId);
  state.draftEditableId = null;
  if (state.selectedId === itemId) {
    state.selectedId = null;
  }
  enqueueOperation({ kind: 'delete', ids: [itemId] });
  markDirty(true);
}

export {
  cancelEditing,
  continueTableCellDrag,
  createEditableItem,
  deleteDraftEditable,
  finishEditing,
  finishTableCellDrag,
  isTemporaryPanGestureEvent,
  normalizeStructuredTextLinePlaceholders,
  onEditableInput,
  onEditableInputImmediate,
  onNoteMoveHandlePointerDown,
  onTableClick,
  onTableColumnHandlePointerDown,
  onTableMoveHandlePointerDown,
  onTablePointerDown,
  onTextPointerDown,
  onTextPointerUp,
  startEditingItem,
  startTableCellDrag
};

export { configureEditing };
