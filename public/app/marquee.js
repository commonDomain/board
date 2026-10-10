import { getBoardPoint } from './camera.js';
import { PAN_DRAG_THRESHOLD } from './constants.js';
import { onNoteMoveHandlePointerDown } from './editing.js';
import { els } from './elements.js';
import { getPointsBounds, getRectBounds, pointsToPath } from './geometry-model.js';
import { canMutateItem } from './layers-model.js';
import { clearMindNodeSelection } from './mindmap-editing-model.js';
import { canvasInteraction, captureViewportPointer, stopEdgePan, syncEdgePanForEvent } from './pan.js';
import { clearGuides } from './presence.js';
import { intersectsRect } from './rendering-model.js';
import { spatialIndexRuntime } from './runtime/spatial-index.js';
import { selectItem, updateSelectionUI } from './selection.js';
import { selectionChangedIds } from './selection-model.js';
import { queryItemsInRect } from './spatial-index-model.js';
import { requestWorkerMarqueeSelection } from './spatial-index.js';
import { state } from './state.js';
import { createSvg, distance } from './utilities.js';
import { pickPrimarySelection, itemIntersectsLasso } from './marquee-model.js';

function attachSelectionFrame(node) {
  const frame = els.selectionTemplate.content.firstElementChild.cloneNode(true);
  updateSelectionHandleCursors(frame, state.items.get(node.dataset.itemId));
  node.appendChild(frame);
}

function updateSelectionHandleCursors(frame, item) {
  if (frame && item && canvasInteraction?.getResizeCursor) {
    frame.querySelectorAll('[data-handle]').forEach((handle) => {
      if (handle.dataset.handle !== 'rotate') {
        handle.style.cursor = canvasInteraction.getResizeCursor(
          handle.dataset.handle,
          (item.rotation || 0) + state.rotation
        );
      }
    });
  }
}

function setActiveCursorState(cursor = '') {
  if (!els.viewport) return;
  if (cursor) els.viewport.dataset.cursorState = cursor;
  else delete els.viewport.dataset.cursorState;
}

function restoreIdleCursorState() {
  if (state.spacePan) setActiveCursorState('grab');
  else setActiveCursorState('');
}

function renderNoteMoveHandle() {
  const handle = document.createElement('button');
  handle.className = 'note-move-handle';
  handle.type = 'button';
  handle.title = '拖动便签';
  handle.setAttribute('aria-label', '拖动便签');
  handle.addEventListener('pointerdown', onNoteMoveHandlePointerDown);
  handle.addEventListener('click', (event) => event.stopPropagation());
  return handle;
}

let marqueeElement = null;

function startPendingCanvasIntent(event) {
  event.preventDefault();
  state.pendingCanvasIntent = {
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    startClient: { x: event.clientX, y: event.clientY },
    startBoard: getBoardPoint(event)
  };
  state.gestureSession = { kind: 'pending-canvas', pointerId: event.pointerId, targetIds: [] };
  captureViewportPointer(event.pointerId);
}

function continuePendingCanvasIntent(event) {
  const pending = state.pendingCanvasIntent;
  if (!pending || pending.pointerId !== event.pointerId) return;
  const crossedThreshold = canvasInteraction
    ? canvasInteraction.hasExceededDragThreshold(
        pending.startClient,
        { x: event.clientX, y: event.clientY },
        pending.pointerType
      )
    : Math.hypot(event.clientX - pending.startClient.x, event.clientY - pending.startClient.y) >= PAN_DRAG_THRESHOLD;
  if (!crossedThreshold) return;
  state.pendingCanvasIntent = null;
  startMarquee(event);
  if (!state.marquee) return;
  state.marquee.start = pending.startBoard;
  state.marquee.current = getBoardPoint(event);
  state.marquee.points =
    state.marquee.mode === 'lasso'
      ? [pending.startBoard, state.marquee.current]
      : [pending.startBoard, state.marquee.current];
  updateMarqueeElement();
  updateMarqueeSelection();
  syncEdgePanForEvent(event);
}

function finishPendingCanvasIntent(event = null) {
  const pending = state.pendingCanvasIntent;
  if (!pending || (event && event.pointerId !== pending.pointerId)) return false;
  state.pendingCanvasIntent = null;
  state.gestureSession = null;
  selectItem(null);
  return true;
}

function startMarquee(event) {
  event.preventDefault();
  spatialIndexRuntime.latestGeometrySelectionSequence = ++spatialIndexRuntime.geometrySelectionSequence;
  spatialIndexRuntime.geometryMarqueeFinalize = null;
  const start = getBoardPoint(event);
  state.marquee = {
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    start,
    current: start,
    mode: state.selectionMode,
    points: [start],
    beforeSelectedId: state.selectedId,
    beforeSelectedIds: new Set(state.selectedIds)
  };
  state.gestureSession = { kind: 'marquee', pointerId: event.pointerId, targetIds: [] };
  state.selectedIds.clear();
  state.selectedId = null;
  clearMindNodeSelection();
  updateSelectionUI();
  captureViewportPointer(event.pointerId);
  els.viewport.classList.add('selecting');
  setActiveCursorState('crosshair');
  createMarqueeElement();
}

function continueMarquee(event) {
  const marquee = state.marquee;
  if (!marquee || event.pointerId !== marquee.pointerId) {
    return;
  }
  event.preventDefault();
  const point = getBoardPoint(event);
  marquee.current = point;
  if (marquee.mode === 'lasso') {
    const last = marquee.points[marquee.points.length - 1];
    if (!last || distance(last, point) >= 3) {
      marquee.points.push(point);
    }
  } else {
    marquee.points = [marquee.start, point];
  }
  updateMarqueeElement();
  updateMarqueeSelection();
}

function updateMarqueeSelection() {
  const marquee = state.marquee;
  if (!marquee) {
    return;
  }
  if (state.loadTier === 'extreme' && requestWorkerMarqueeSelection(marquee)) return;
  const previousIds = state.selectedIds;
  const previousPrimary = state.selectedId;
  const nextIds = new Set();
  let selectionBounds = null;
  const candidateBounds =
    marquee.mode === 'lasso' ? getPointsBounds(marquee.points) : getRectBounds(marquee.start, marquee.current);
  for (const item of queryItemsInRect(candidateBounds)) {
    const id = item.id;
    if (!canMutateItem(item)) {
      continue;
    }
    if (marquee.mode === 'box' && intersectsRect(item, getRectBounds(marquee.start, marquee.current))) {
      nextIds.add(id);
    } else if (marquee.mode === 'lasso' && itemIntersectsLasso(item, marquee.points)) {
      nextIds.add(id);
    }
    if (nextIds.has(id)) {
      selectionBounds = selectionBounds
        ? {
            x: Math.min(selectionBounds.x, item.x),
            y: Math.min(selectionBounds.y, item.y),
            w: Math.max(selectionBounds.x + selectionBounds.w, item.x + item.w) - Math.min(selectionBounds.x, item.x),
            h: Math.max(selectionBounds.y + selectionBounds.h, item.y + item.h) - Math.min(selectionBounds.y, item.y)
          }
        : { x: item.x, y: item.y, w: item.w, h: item.h };
    }
  }
  state.selectedIds = nextIds;
  state.selectedId = pickPrimarySelection(marquee.start, nextIds);
  clearMindNodeSelection();
  updateSelectionUI({
    panels: false,
    itemIds: selectionChangedIds(previousIds, nextIds, previousPrimary, state.selectedId),
    selectionBounds
  });
}

function finishMarquee() {
  if (!state.marquee) {
    return;
  }
  stopEdgePan();
  if (state.marquee.workerSequence > spatialIndexRuntime.completedGeometrySelectionSequence) {
    spatialIndexRuntime.geometryMarqueeFinalize = {
      sequence: state.marquee.workerSequence,
      start: state.marquee.start
    };
  }
  state.marquee = null;
  state.gestureSession = null;
  els.viewport.classList.remove('selecting');
  restoreIdleCursorState();
  removeMarqueeElement();
  if (!state.selectedIds.size) {
    state.selectedId = null;
  }
  updateSelectionUI();
  clearGuides();
}

function createMarqueeElement() {
  if (state.marquee?.mode === 'lasso') {
    marqueeElement = createSvg('svg');
    marqueeElement.classList.add('marquee-svg');
    const path = createSvg('path');
    path.classList.add('marquee-path');
    marqueeElement.appendChild(path);
  } else {
    marqueeElement = document.createElement('div');
    marqueeElement.className = 'marquee';
  }
  els.itemsLayer.appendChild(marqueeElement);
  updateMarqueeElement();
}

function updateMarqueeElement() {
  if (!marqueeElement || !state.marquee) {
    return;
  }
  if (state.marquee.mode === 'lasso') {
    const path = marqueeElement.querySelector('.marquee-path');
    if (path) {
      const points = state.marquee.points;
      const d = points.length ? `${pointsToPath(points)}${points.length > 1 ? ' Z' : ''}` : '';
      path.setAttribute('d', d);
    }
    return;
  }
  const rect = getRectBounds(state.marquee.start, state.marquee.current);
  marqueeElement.style.left = `${rect.x}px`;
  marqueeElement.style.top = `${rect.y}px`;
  marqueeElement.style.width = `${rect.w}px`;
  marqueeElement.style.height = `${rect.h}px`;
}

function removeMarqueeElement() {
  marqueeElement?.remove();
  marqueeElement = null;
}
export {
  attachSelectionFrame,
  updateSelectionHandleCursors,
  setActiveCursorState,
  restoreIdleCursorState,
  renderNoteMoveHandle,
  marqueeElement,
  startPendingCanvasIntent,
  continuePendingCanvasIntent,
  finishPendingCanvasIntent,
  startMarquee,
  continueMarquee,
  updateMarqueeSelection,
  finishMarquee,
  createMarqueeElement,
  updateMarqueeElement,
  removeMarqueeElement
};
