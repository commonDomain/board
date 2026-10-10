
import { MIDDLE_DOUBLE_CLICK_DISTANCE, PAN_DRAG_THRESHOLD } from './constants.js';
import { finishEditing } from './editing.js';
import { els } from './elements.js';

import { canMutateItem } from './layers-model.js';

import { floatingToolbarMenuRuntime } from './runtime/floating-toolbar-menu.js';
import { continueSectionInteraction } from './sections.js';
import { selectItem } from './selection.js';
import { state } from './state.js';

import { getEdgePanGesture } from './pan-model.js';

let applyCamera,
  getBoardPoint,
  registerMiddleClick,
  scheduleCameraApply,
  scheduleFloatingToolbarPosition,
  continueMarquee,
  restoreIdleCursorState,
  setActiveCursorState,
  hitTestItem,
  continueTransform;

function configurePan(callbacks) {
  ({
    applyCamera,
    getBoardPoint,
    registerMiddleClick,
    scheduleCameraApply,
    scheduleFloatingToolbarPosition,
    continueMarquee,
    restoreIdleCursorState,
    setActiveCursorState,
    hitTestItem,
    continueTransform
  } = callbacks);
}

let interactionViewportBoundsCache = null;

let interactionViewportResizeObserver = null;

const capturedViewportPointers = new Set();

const canvasInteraction = window.WhiteboardCanvasInteraction;

function captureViewportPointer(pointerId) {
  try {
    els.viewport.setPointerCapture(pointerId);
    capturedViewportPointers.add(pointerId);
  } catch {
    // A canceled or synthetic pointer may not be capturable.
  }
}

function releaseViewportPointer(pointerId) {
  if (!Number.isFinite(pointerId)) return;
  capturedViewportPointers.delete(pointerId);
  try {
    if (els.viewport.hasPointerCapture?.(pointerId)) els.viewport.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already have been released by the browser.
  }
}

function releaseAllViewportPointers() {
  for (const pointerId of Array.from(capturedViewportPointers)) releaseViewportPointer(pointerId);
}

function getPanSelectionCandidate(event) {
  const itemElement = event.target.closest('.board-item');
  const item = itemElement ? state.items.get(itemElement.dataset.itemId) : hitTestItem(getBoardPoint(event));
  return item && canMutateItem(item) ? item.id : null;
}

function getMiddleClickTarget(event) {
  const itemElement = event.target.closest('.board-item');
  const item = itemElement ? state.items.get(itemElement.dataset.itemId) : hitTestItem(getBoardPoint(event));
  return item?.id || null;
}

function startPanning(event, options = {}) {
  const deferred = Boolean(options.deferred);
  if (!deferred && state.editingId) {
    finishEditing();
  }
  event.preventDefault();
  state.panning = {
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    startX: event.clientX,
    startY: event.clientY,
    startCameraX: state.camera.x,
    startCameraY: state.camera.y,
    active: !deferred,
    selectionId: options.selectionId || null,
    onTap: options.onTap || null,
    button: event.button,
    middleClickTargetId: event.button === 1 && event.pointerType === 'mouse' ? getMiddleClickTarget(event) : null,
    maxDistance: 0
  };
  state.gestureSession = { kind: 'pan', pointerId: event.pointerId, targetIds: [], latestEvent: null };
  if (!deferred) {
    els.viewport.classList.add('panning');
    setActiveCursorState('grabbing');
  }
  captureViewportPointer(event.pointerId);
}

function continuePanning(event) {
  const pan = state.panning;
  if (!pan || event.pointerId !== pan.pointerId) {
    return;
  }
  event.preventDefault();
  const dx = event.clientX - pan.startX;
  const dy = event.clientY - pan.startY;
  pan.maxDistance = Math.max(pan.maxDistance, Math.hypot(dx, dy));
  if (pan.button === 1 && pan.maxDistance > MIDDLE_DOUBLE_CLICK_DISTANCE) {
    state.middleClick = null;
  }
  if (!pan.active) {
    const crossedThreshold = canvasInteraction
      ? canvasInteraction.hasExceededDragThreshold(
          { x: pan.startX, y: pan.startY },
          { x: event.clientX, y: event.clientY },
          pan.pointerType
        )
      : Math.hypot(dx, dy) >= PAN_DRAG_THRESHOLD;
    if (!crossedThreshold) {
      return;
    }
    pan.active = true;
    finishEditing();
    els.viewport.classList.add('panning');
    setActiveCursorState('grabbing');
  }
  state.camera.x = pan.startCameraX + dx;
  state.camera.y = pan.startCameraY + dy;
  scheduleCameraApply();
}

function finishPanning(event = null) {
  const pan = state.panning;
  if (!pan) return;
  state.panning = null;
  state.gestureSession = null;
  els.viewport.classList.remove('panning');
  restoreIdleCursorState();
  if (!pan.active && pan.onTap) pan.onTap(event);
  else if (!pan.active) selectItem(pan.selectionId);
  if (pan.button === 1 && pan.pointerType === 'mouse') {
    const endDistance = event ? Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) : pan.maxDistance;
    if (Math.max(pan.maxDistance, endDistance) <= MIDDLE_DOUBLE_CLICK_DISTANCE) {
      registerMiddleClick(pan.middleClickTargetId, event || pan);
    } else {
      state.middleClick = null;
    }
  }
  if (floatingToolbarMenuRuntime.floatingToolbarPositionPending) scheduleFloatingToolbarPosition();
}

function getInteractionViewportClientBounds() {
  if (interactionViewportBoundsCache) return interactionViewportBoundsCache;
  const viewport = els.viewport.getBoundingClientRect();
  const raw = {
    left: viewport.left,
    top: viewport.top,
    right: viewport.right,
    bottom: viewport.bottom,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height
  };
  const bounds = { ...raw };
  const inset = 10;
  const documentBar = document.querySelector('.document-bar');
  const documentRect = documentBar?.getBoundingClientRect();
  if (documentRect?.width && documentRect.bottom > raw.top && documentRect.top < raw.bottom) {
    bounds.top = Math.max(bounds.top, documentRect.bottom + inset);
  }

  const dockRect = !els.toolDock?.hidden ? els.toolDock?.getBoundingClientRect() : null;
  if (dockRect?.width && dockRect.height) {
    if (dockRect.width > dockRect.height) bounds.bottom = Math.min(bounds.bottom, dockRect.top - inset);
    else bounds.left = Math.max(bounds.left, dockRect.right + inset);
  }

  for (const panel of [els.navigatorPanel, document.getElementById('contextPanel')]) {
    if (!panel || panel.hidden) continue;
    const panelRect = panel.getBoundingClientRect();
    if (!panelRect.width || !panelRect.height) continue;
    if (panelRect.width >= viewport.width * 0.65) bounds.bottom = Math.min(bounds.bottom, panelRect.top - inset);
    else bounds.right = Math.min(bounds.right, panelRect.left - inset);
  }
  if (els.arrangeBar && !els.arrangeBar.hidden) {
    const arrangeRect = els.arrangeBar.getBoundingClientRect();
    if (arrangeRect.width && arrangeRect.height) bounds.bottom = Math.min(bounds.bottom, arrangeRect.top - inset);
  }

  interactionViewportBoundsCache = bounds.right - bounds.left < 240 || bounds.bottom - bounds.top < 200 ? raw : bounds;
  return interactionViewportBoundsCache;
}

function invalidateInteractionViewportBounds() {
  interactionViewportBoundsCache = null;
}

function observeInteractionViewportBounds() {
  interactionViewportResizeObserver?.disconnect();
  if (typeof ResizeObserver === 'function') {
    interactionViewportResizeObserver = new ResizeObserver(invalidateInteractionViewportBounds);
    for (const element of [
      els.viewport,
      document.querySelector('.document-bar'),
      els.toolDock,
      els.navigatorPanel,
      document.getElementById('contextPanel'),
      els.arrangeBar
    ]) {
      if (element) interactionViewportResizeObserver.observe(element);
    }
  }
  window.addEventListener('resize', invalidateInteractionViewportBounds, { passive: true });
  const visibilityObserver = new MutationObserver(invalidateInteractionViewportBounds);
  for (const element of [els.toolDock, els.navigatorPanel, document.getElementById('contextPanel'), els.arrangeBar]) {
    if (element)
      visibilityObserver.observe(element, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  }
}

function stopEdgePan() {
  const edgePan = state.edgePan;
  if (!edgePan) return;
  cancelAnimationFrame(edgePan.frame || 0);
  state.edgePan = null;
  els.viewport.classList.remove('edge-panning');
}

function syncEdgePanForEvent(event) {
  const gesture = getEdgePanGesture();
  if (!gesture || gesture.pointerId !== event.pointerId || !canvasInteraction) {
    stopEdgePan();
    return;
  }
  const bounds = getInteractionViewportClientBounds();
  const point = { x: event.clientX, y: event.clientY };
  const proximity = canvasInteraction.getEdgeProximity(point, bounds, event.pointerType || 'mouse');
  if (proximity.x === 0 && proximity.y === 0) {
    stopEdgePan();
    return;
  }

  const now = performance.now();
  let edgePan = state.edgePan;
  if (!edgePan || edgePan.pointerId !== event.pointerId || edgePan.kind !== gesture.kind) {
    stopEdgePan();
    edgePan = {
      kind: gesture.kind,
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      enteredAt: now,
      lastTime: now,
      frame: 0
    };
    state.edgePan = edgePan;
  }
  Object.assign(edgePan, {
    clientX: event.clientX,
    clientY: event.clientY,
    altKey: Boolean(event.altKey),
    shiftKey: Boolean(event.shiftKey),
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey)
  });
  if (!edgePan.frame) edgePan.frame = requestAnimationFrame(runEdgePanFrame);
}

function runEdgePanFrame(timestamp) {
  const edgePan = state.edgePan;
  const gesture = getEdgePanGesture();
  if (!edgePan || !gesture || gesture.pointerId !== edgePan.pointerId || gesture.kind !== edgePan.kind) {
    stopEdgePan();
    return;
  }
  edgePan.frame = 0;
  const bounds = getInteractionViewportClientBounds();
  const velocity = canvasInteraction.computeEdgePan({
    point: { x: edgePan.clientX, y: edgePan.clientY },
    bounds,
    pointerType: edgePan.pointerType,
    enteredAt: edgePan.enteredAt,
    now: timestamp
  });
  if (!velocity.inZone) {
    stopEdgePan();
    return;
  }

  const elapsed = Math.min(32, Math.max(0, timestamp - edgePan.lastTime)) / 1000;
  edgePan.lastTime = timestamp;
  if (velocity.active && elapsed > 0) {
    state.camera.x -= velocity.x * elapsed;
    state.camera.y -= velocity.y * elapsed;
    applyCamera();
    els.viewport.classList.add('edge-panning');
    replayEdgePanGesture(edgePan);
  }
  if (state.edgePan === edgePan) edgePan.frame = requestAnimationFrame(runEdgePanFrame);
}

function replayEdgePanGesture(edgePan) {
  const event = {
    pointerId: edgePan.pointerId,
    pointerType: edgePan.pointerType,
    clientX: edgePan.clientX,
    clientY: edgePan.clientY,
    altKey: edgePan.altKey,
    shiftKey: edgePan.shiftKey,
    ctrlKey: edgePan.ctrlKey,
    metaKey: edgePan.metaKey,
    preventDefault() {}
  };
  if (edgePan.kind === 'connector') {
    window.ConnectorUI?.edgeReplay(event);
    return;
  }
  if (state.interaction?.pointerId === edgePan.pointerId && state.interaction.mode === 'move') {
    continueTransform(event);
  } else if (state.sectionInteraction?.pointerId === edgePan.pointerId && state.sectionInteraction.mode === 'move') {
    continueSectionInteraction(event);
  } else if (state.marquee?.pointerId === edgePan.pointerId) {
    continueMarquee(event);
  }
}
export {
  interactionViewportBoundsCache,
  interactionViewportResizeObserver,
  capturedViewportPointers,
  canvasInteraction,
  captureViewportPointer,
  releaseViewportPointer,
  releaseAllViewportPointers,
  getPanSelectionCandidate,
  getMiddleClickTarget,
  startPanning,
  continuePanning,
  finishPanning,
  getInteractionViewportClientBounds,
  invalidateInteractionViewportBounds,
  observeInteractionViewportBounds,
  stopEdgePan,
  syncEdgePanForEvent,
  runEdgePanFrame,
  replayEdgePanGesture
};

export { configurePan };
