import { pinchStart, pinchMove } from './touch-geometry-model.js';
import { touchPreferences } from './touch-preferences.js';
import { cloneHistoryValue } from './history-controller-model.js';
import { scheduleCameraApply } from './camera.js';
import { MAX_ZOOM, MIN_ZOOM } from './constants.js';
import { els } from './elements.js';
import { clearEraserPreview } from './eraser-model.js';
import { scheduleFloatingToolbarPosition } from './floating-toolbar-menu.js';
import { removeMarqueeElement, restoreIdleCursorState } from './marquee.js';
import { captureViewportPointer, releaseAllViewportPointers, stopEdgePan } from './pan.js';
import { hasActivePen } from './pan-model.js';
import { clearGuides } from './presence.js';
import { floatingToolbarMenuRuntime } from './runtime/floating-toolbar-menu.js';
import { inkGeometryRuntime } from './runtime/ink-geometry.js';
import { pointerMoveRuntime } from './runtime/pointer-move.js';
import { spatialIndexRuntime } from './runtime/spatial-index.js';
import { renderSections } from './sections.js';
import { updateSelectionUI } from './selection.js';
import { indexUpsertItem } from './spatial-index.js';
import { state } from './state.js';
import { refreshConnectorsFor, restoreInteractionItems } from './transform.js';

function startPinch(firstPointerId, secondEvent) {
  const first = state.pointerPositions.get(firstPointerId);
  if (!first || first.pointerType !== 'touch' || secondEvent.pointerType !== 'touch' || hasActivePen()) {
    return;
  }
  cancelActiveGesture();
  const viewportRect = els.viewport.getBoundingClientRect();
  const startAngle = Math.atan2(secondEvent.clientY - first.y, secondEvent.clientX - first.x);
  state.pinch = {
    pointers: new Map([
      [firstPointerId, { x: first.x, y: first.y }],
      [secondEvent.pointerId, { x: secondEvent.clientX, y: secondEvent.clientY }]
    ]),
    startDistance: Math.hypot(secondEvent.clientX - first.x, secondEvent.clientY - first.y),
    startZoom: state.zoom,
    startAngle,
    startRotation: state.rotation,
    startCameraX: state.camera.x,
    startCameraY: state.camera.y,
    viewportRect: {
      left: viewportRect.left,
      top: viewportRect.top
    }
  };
  state.pinch.geometry = pinchStart(
    { x: first.x - viewportRect.left, y: first.y - viewportRect.top },
    { x: secondEvent.clientX - viewportRect.left, y: secondEvent.clientY - viewportRect.top },
    state.zoom, state.camera, state.rotation
  );
  state.pinch.rotate = touchPreferences().rotate;
  state.gestureSession = { kind: 'pinch', pointerId: secondEvent.pointerId, targetIds: [] };
  captureViewportPointer(firstPointerId);
  captureViewportPointer(secondEvent.pointerId);
}

function cancelActiveGesture() {
  stopEdgePan();
  els.viewport.classList.remove('moving-items', 'moving-section', 'selecting');
  clearTimeout(state.eyedropperTimer);
  state.eyedropperTimer = null;
  state.eyedropperStart = null;
  state.tableCellDrag = null;
  if (state.currentPath) {
    cancelAnimationFrame(state.currentPath.previewFrame || 0);
    state.currentPath.previewController?.dispose();
    state.currentPath.previewCanvas?.remove();
    state.currentPath = null;
  }
  if (state.eraserPath) {
    clearEraserPreview(state.eraserPath);
    state.eraserPath = null;
  }
  if (state.currentShape) {
    state.currentShape.group.remove();
    state.currentShape = null;
  }
  if (state.sectionDraft) {
    state.sectionDraft.preview?.remove();
    state.sectionDraft = null;
  }
  if (state.smudgePath) {
    state.smudgePath = null;
    inkGeometryRuntime.smudgePreviewCircle?.remove();
    inkGeometryRuntime.smudgePreviewCircle = null;
  }
  if (state.panning) {
    state.panning = null;
    els.viewport.classList.remove('panning');
  }
  if (state.marquee) {
    spatialIndexRuntime.latestGeometrySelectionSequence = ++spatialIndexRuntime.geometrySelectionSequence;
    spatialIndexRuntime.pendingGeometrySelection = null;
    spatialIndexRuntime.geometryMarqueeFinalize = null;
    state.selectedId = state.marquee.beforeSelectedId || null;
    state.selectedIds = new Set(state.marquee.beforeSelectedIds || []);
    state.marquee = null;
    removeMarqueeElement();
    updateSelectionUI();
  }
  if (state.pinch) {
    state.pinch = null;
  }
  const interaction = state.interaction;
  state.interaction = null;
  restoreInteractionItems(interaction);
  if (state.sectionInteraction) {
    const sectionInteraction = state.sectionInteraction;
    state.sectionInteraction = null;
    const section = state.sections.get(sectionInteraction.sectionId);
    if (section && sectionInteraction.beforeSection) {
      Object.assign(section, cloneHistoryValue(sectionInteraction.beforeSection));
      state.sections.set(section.id, section);
    }
    for (const [id, position] of sectionInteraction.startPositions || []) {
      const item = state.items.get(id);
      if (!item) continue;
      Object.assign(item, position);
      state.items.set(id, item);
      indexUpsertItem(item);
    }
    renderSections();
    refreshConnectorsFor(sectionInteraction.childIds || []);
  }
  state.pendingMove = null;
  state.pendingCanvasIntent = null;
  state.gestureSession = null;
  pointerMoveRuntime.queuedPointerMove = null;
  if (pointerMoveRuntime.pointerMoveFrame) cancelAnimationFrame(pointerMoveRuntime.pointerMoveFrame);
  pointerMoveRuntime.pointerMoveFrame = null;
  releaseAllViewportPointers();
  clearGuides();
  restoreIdleCursorState();
}

function continuePinch(event) {
  const pinch = state.pinch;
  if (!pinch || !pinch.pointers.has(event.pointerId)) {
    return;
  }
  pinch.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch.pointers.size < 2) {
    return;
  }
  event.preventDefault();
  const points = Array.from(pinch.pointers.values()).map(point => ({ x: point.x - pinch.viewportRect.left, y: point.y - pinch.viewportRect.top }));
  const next = pinchMove(pinch.geometry, points[0], points[1], MIN_ZOOM, MAX_ZOOM, pinch.rotate);
  state.zoom = next.zoom;
  state.rotation = next.rotation;
  state.camera.x = next.x;
  state.camera.y = next.y;
  scheduleCameraApply();
}

function finishPinch() {
  state.pinch = null;
  state.gestureSession = null;
  if (floatingToolbarMenuRuntime.floatingToolbarPositionPending) scheduleFloatingToolbarPosition();
}
export { startPinch, cancelActiveGesture, continuePinch, finishPinch };
