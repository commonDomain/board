import { pushUndoSnapshot, redoLastChange, undoLastChange } from './history-controller.js';
import { snapshotItems } from './history-controller-model.js';

import { exitAmapInteraction } from './amap-rendering-model.js';
import { closeCanvasMenu } from './catalog.js';
import { copySelection, cutSelection, duplicateSelection } from './clipboard.js';
import { isRemoteBoardLocked } from './connection-model.js';
import { cancelConnectorDraft } from './drawing-model.js';
import { cancelEditing } from './editing.js';
import { els } from './elements.js';
import { cancelActiveGesture } from './gestures.js';
import { groupSelection, ungroupSelection } from './groups.js';
import { showToast } from './interface-model.js';
import { bringToFront, deleteItems, sendToBack } from './items.js';
import { canMutateItem } from './layers-model.js';
import { restoreIdleCursorState, setActiveCursorState } from './marquee.js';
import {
  addMindChild,
  addMindSibling,
  deleteMindNode,
  selectMindNode,
  startMindNodeEdit,
  toggleMindCollapse
} from './mindmap-editing.js';
import { clearMindNodeSelection, getMindNodeAtPath } from './mindmap-editing-model.js';
import { closePopovers } from './popovers.js';
import { markDirty, saveBoard } from './save-status.js';
import { openGlobalSearch } from './search.js';
import { createSectionAroundSelection } from './sections.js';
import { getSelectedIds } from './selection-model.js';
import { hideContextMenu, selectItem } from './selection.js';
import { state } from './state.js';
import { enqueueOperation } from './sync-queue.js';
import { addTableDimension } from './table-rendering.js';
import { getTableColumnCount, getTableRowCount } from './table-rendering-model.js';
import { restoreNavigationTool, setTool } from './toolbar.js';
import { refreshConnectorsFor, updateItemElementGeometry } from './transform.js';
import { clamp, cssEscape, isEditableTarget, isImeEvent, placeCursorAtEnd } from './utilities.js';

function handleMindMapKeyDown(event) {
  const selection = state.mindmapSelection;
  if (!selection || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const item = state.items.get(selection.itemId);
  if (!canMutateItem(item) || item.type !== 'mindmap') {
    return false;
  }
  const path = [...selection.path];
  const node = getMindNodeAtPath(item.tree, path);
  if (!node) {
    clearMindNodeSelection();
    return false;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (path.length) {
      addMindSibling(item, path);
    } else {
      addMindChild(item, path);
    }
    return true;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    if (event.shiftKey) {
      if (path.length) {
        selectMindNode(item.id, path.slice(0, -1));
      }
    } else {
      addMindChild(item, path);
    }
    return true;
  }
  if (event.key === 'F2') {
    event.preventDefault();
    startMindNodeEdit(item, path);
    return true;
  }
  if (event.key === ' ') {
    event.preventDefault();
    if (Array.isArray(node.children) && node.children.length) {
      toggleMindCollapse(item, path);
    }
    return true;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (path.length) {
      selectMindNode(item.id, path.slice(0, -1));
    }
    return true;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (Array.isArray(node.children) && node.children.length) {
      if (node.collapsed) {
        toggleMindCollapse(item, path);
      } else {
        selectMindNode(item.id, [...path, 0]);
      }
    }
    return true;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (!path.length) {
      return true;
    }
    const parentPath = path.slice(0, -1);
    const parent = getMindNodeAtPath(item.tree, parentPath);
    const siblingCount = Array.isArray(parent?.children) ? parent.children.length : 0;
    if (siblingCount) {
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const nextIndex = clamp(path[path.length - 1] + delta, 0, siblingCount - 1);
      selectMindNode(item.id, [...parentPath, nextIndex]);
    }
    return true;
  }
  return false;
}

function onKeyDown(event) {
  if (window.__independentNotesActive) return;
  if (isRemoteBoardLocked()) {
    if (els.viewport.contains(event.target) || event.target.closest?.('#navigatorTree'))
      event.preventDefault();
    return;
  }
  if (!state.boardId && !isEditableTarget(event.target)) return;
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    openGlobalSearch();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
    state.keyboardPasteRequestedAt = Date.now();
  }
  if (isEditableTarget(event.target)) {
    // A native select owns Escape so its picker can close without cancelling the draft.
    if (event.key === 'Escape' && event.target.closest('select')) return;
    if (handleTableEditingKeyDown(event)) {
      return;
    }
    if (event.key === 'Escape' && !isImeEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      cancelEditing();
    }
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === 'c') {
      event.preventDefault();
      copySelection();
      return;
    }
    if (key === 'x') {
      event.preventDefault();
      cutSelection();
      return;
    }
    if (key === 'v') {
      // Let the native paste event expose image/file clipboard data. The paste
      // handler will fall back to the board's internal object clipboard.
      return;
    }
    if (key === 'd') {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (key === 'g') {
      event.preventDefault();
      if (event.shiftKey) ungroupSelection();
      else groupSelection();
      return;
    }
  }
  if (handleMindMapKeyDown(event)) {
    return;
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === 'h' || key === 'v') {
      event.preventDefault();
      setTool(key === 'h' ? 'pan' : 'select');
      return;
    }
  }
  if (event.key === ' ' && !event.target.closest('button, a, input, select, textarea')) {
    event.preventDefault();
    state.spacePan = true;
    els.viewport.classList.add('space-pan');
    setActiveCursorState('grab');
    return;
  }
  if (event.shiftKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (getSelectedIds().length) createSectionAroundSelection();
    else setTool('section');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoLastChange();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    redoLastChange();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redoLastChange();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveBoard();
    return;
  }
  if (event.key === 'Escape') {
    if (state.pendingCanvasPlacement) {
      
      showToast('已取消放置');
      return;
    }
    if (!els.canvasMenu.hidden) {
      closeCanvasMenu();
      return;
    }
    const openPopover = [
      els.brushMenu,
      els.eraserMenu,
      els.selectMenu,
      els.shapeMenu,
      els.textMenu,
      els.tableMenu,
      els.layerMenu,
      els.mindmapMenu,
      els.navigationMenu,
      els.backgroundMenu
    ].find((popover) => popover && !popover.hidden);
    if (openPopover) {
      closePopovers();
      return;
    }
    if (state.amapInteractiveId) {
      exitAmapInteraction();
      return;
    }
    hideContextMenu();
    cancelActiveGesture();
    if (state.connectorDraft) {
      cancelConnectorDraft();
      return;
    }
    if (state.mindmapSelection) {
      clearMindNodeSelection();
    }
    if (state.selectedIds.size || state.selectedId) {
      selectItem(null);
    }
    if (state.tool !== 'pan' && state.tool !== 'select') {
      restoreNavigationTool();
    }
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.mindmapSelection) {
    const selection = state.mindmapSelection;
    const mindMapItem = state.items.get(selection.itemId);
    if (mindMapItem && mindMapItem.type === 'mindmap') {
      event.preventDefault();
      deleteMindNode(mindMapItem, selection.path);
      return;
    }
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    const ids = state.selectedIds.size ? Array.from(state.selectedIds) : state.selectedId ? [state.selectedId] : null;
    if (ids && ids.length) {
      event.preventDefault();
      deleteItems(ids);
      return;
    }
  }
  const arrows = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  };
  const move = arrows[event.key];
  const moveIds = state.selectedIds.size ? Array.from(state.selectedIds) : state.selectedId ? [state.selectedId] : null;
  if (move && moveIds && moveIds.length) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const beforeItems = snapshotItems();
    const ops = [];
    for (const id of moveIds) {
      const item = state.items.get(id);
      if (!canMutateItem(item)) {
        continue;
      }
      item.x += move[0] * step;
      item.y += move[1] * step;
      state.items.set(id, item);
      updateItemElementGeometry(item);
      ops.push({ kind: 'upsert', item });
    }
    if (!ops.length) {
      return;
    }
    refreshConnectorsFor(moveIds);
    pushUndoSnapshot(beforeItems);
    enqueueOperation(ops.length === 1 ? ops[0] : { kind: 'batch', ops });
    markDirty(true);
    return;
  }
  if ((event.key === ']' || event.key === '}') && state.selectedId) {
    event.preventDefault();
    bringToFront(state.selectedId);
    return;
  }
  if ((event.key === '[' || event.key === '{') && state.selectedId) {
    event.preventDefault();
    sendToBack(state.selectedId);
  }
}

function handleTableEditingKeyDown(event) {
  const cell = event.target.closest?.('.board-table td, .board-table th');
  if (!cell || event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const root = cell.closest('.board-item');
  const item = root && state.items.get(root.dataset.itemId);
  if (!item || item.type !== 'table' || state.editingId !== item.id) {
    return false;
  }
  event.preventDefault();
  const row = Number(cell.dataset.row);
  const column = Number(cell.dataset.column);
  const rowCount = getTableRowCount(item);
  const columnCount = getTableColumnCount(item);
  let nextIndex = row * columnCount + column + (event.shiftKey ? -1 : 1);
  if (!event.shiftKey && nextIndex >= rowCount * columnCount) {
    if (!addTableDimension(item, 'row')) {
      return true;
    }
    nextIndex = rowCount * columnCount;
  }
  nextIndex = clamp(nextIndex, 0, getTableRowCount(item) * getTableColumnCount(item) - 1);
  requestAnimationFrame(() => {
    const nextRow = Math.floor(nextIndex / getTableColumnCount(item));
    const nextColumn = nextIndex % getTableColumnCount(item);
    const nextCell = document.querySelector(
      `.board-item[data-item-id="${cssEscape(item.id)}"] [data-row="${nextRow}"][data-column="${nextColumn}"]`
    );
    if (nextCell) {
      nextCell.focus({ preventScroll: true });
      placeCursorAtEnd(nextCell);
    }
  });
  return true;
}

function onKeyUp(event) {
  if (window.__independentNotesActive) return;
  if (event.key === ' ') {
    state.spacePan = false;
    els.viewport.classList.remove('space-pan');
    restoreIdleCursorState();
  }
}

export { handleMindMapKeyDown, handleTableEditingKeyDown, onKeyDown, onKeyUp };
