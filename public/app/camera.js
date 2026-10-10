import { handleAmapCardWheel } from './amap-rendering-model.js';

import { getBackgroundImagePreset, getBackgroundPreset } from './background-model.js';
import {
  MAX_ZOOM,
  MIDDLE_DOUBLE_CLICK_DELAY,
  MIDDLE_DOUBLE_CLICK_DISTANCE,
  MIDDLE_FOCUS_SCREEN_PADDING,
  MIDDLE_FOCUS_ZOOM_CAP,
  MIN_ZOOM,
  WHEEL_ZOOM_SETTLE_RATIO,
  WHEEL_ZOOM_SMOOTHING_MS
} from './constants.js';
import { els } from './elements.js';
import { positiveModulo } from './export-source-model.js';

import { scheduleImageLodRefresh } from './ink-rendering.js';
import { isItemVisible } from './layer-visibility.js';

import { canvasInteraction } from './pan.js';

import { cameraRuntime } from './runtime/camera.js';
import { floatingToolbarMenuRuntime } from './runtime/floating-toolbar-menu.js';
import { pointerMoveRuntime } from './runtime/pointer-move.js';

import { state } from './state.js';
import { clamp, cssEscape } from './utilities.js';
import { captureCameraView, cameraViewMatches, boardToScreen, updateZoomLabel } from './camera-model.js';

let applyGridWallpaperDrift,
  scheduleFloatingToolbarPosition,
  focusBoundsInViewport,
  updateSelectionHandleCursors,
  hideSectionHoverLabel,
  renderCursors,
  renderGuides,
  refreshVisibleItems,
  positionSearchLocator,
  refreshSheetPreviews;

function configureCamera(callbacks) {
  ({
    applyGridWallpaperDrift,
    scheduleFloatingToolbarPosition,
    focusBoundsInViewport,
    updateSelectionHandleCursors,
    hideSectionHoverLabel,
    renderCursors,
    renderGuides,
    refreshVisibleItems,
    positionSearchLocator,
    refreshSheetPreviews
  } = callbacks);
}

let cameraApplyFrame = null;

let wheelZoomTarget = null;

let wheelZoomAnchor = null;

let wheelZoomFrameTime = null;

let lastAppliedZoom = null;

let lastAppliedRotation = null;

function applyCamera() {
  els.board.style.setProperty('--canvas-zoom', String(state.zoom));
  hideSectionHoverLabel();
  const { x, y } = state.camera;
  const zoomChanged = lastAppliedZoom !== state.zoom;
  const rotationChanged = lastAppliedRotation !== state.rotation;
  // Keep camera transforms in the 2D rendering path so images are rerasterized
  // at the settled zoom level instead of reusing a low-resolution GPU texture.
  els.board.style.transform = `translate(${x}px, ${y}px) rotate(${state.rotation}deg) scale(${state.zoom})`;
  if (els.gridLayer) {
    const preset = getBackgroundPreset();
    const spacing = preset.spacing * state.zoom;
    els.gridLayer.style.backgroundSize = '';
    els.gridLayer.style.backgroundPosition = '';
    // Image backgrounds are cover-fitted and screen-scaled; vector backgrounds are
    // world-space patterns. Only the former answer the camera, and they do it by
    // sliding their crop window rather than by resizing.
    applyGridWallpaperDrift(x, y);
    if (!getBackgroundImagePreset()) {
      if (['dots', 'grid', 'dark', 'warm', 'blueprint', 'cross', 'mist', 'sage'].includes(state.background)) {
        els.gridLayer.style.backgroundSize = `${spacing}px ${spacing}px`;
        els.gridLayer.style.backgroundPosition = `${positiveModulo(x, spacing)}px ${positiveModulo(y, spacing)}px`;
      } else if (state.background === 'graph') {
        const majorSpacing = spacing * 5;
        els.gridLayer.style.backgroundSize = `${spacing}px ${spacing}px, ${spacing}px ${spacing}px, ${majorSpacing}px ${majorSpacing}px, ${majorSpacing}px ${majorSpacing}px`;
        els.gridLayer.style.backgroundPosition = `${positiveModulo(x, spacing)}px ${positiveModulo(y, spacing)}px, ${positiveModulo(x, spacing)}px ${positiveModulo(y, spacing)}px, ${positiveModulo(x, majorSpacing)}px ${positiveModulo(y, majorSpacing)}px, ${positiveModulo(x, majorSpacing)}px ${positiveModulo(y, majorSpacing)}px`;
      } else if (state.background === 'lines') {
        els.gridLayer.style.backgroundSize = `100% ${spacing}px`;
        els.gridLayer.style.backgroundPosition = `0 ${positiveModulo(y, spacing)}px`;
      } else if (state.background === 'isometric') {
        const verticalSpacing = spacing * 0.56;
        els.gridLayer.style.backgroundSize = `${spacing}px ${verticalSpacing}px`;
        els.gridLayer.style.backgroundPosition = `${positiveModulo(x, spacing)}px ${positiveModulo(y, verticalSpacing)}px`;
      } else if (state.background === 'rice') {
        els.gridLayer.style.backgroundSize = `${spacing}px ${spacing}px`;
        els.gridLayer.style.backgroundPosition = `${positiveModulo(x, spacing)}px ${positiveModulo(y, spacing)}px`;
      } else if (state.background === 'dawn') {
        const verticalSpacing = spacing * 0.75;
        els.gridLayer.style.backgroundSize = `${spacing}px ${verticalSpacing}px`;
        els.gridLayer.style.backgroundPosition = `${positiveModulo(x, spacing)}px ${positiveModulo(y, verticalSpacing)}px`;
      } else if (state.background === 'paper') {
        const firstX = positiveModulo(x, 13 * state.zoom);
        const firstY = positiveModulo(y, 17 * state.zoom);
        const secondX = positiveModulo(x, 19 * state.zoom);
        const secondY = positiveModulo(y, 23 * state.zoom);
        els.gridLayer.style.backgroundSize = `${13 * state.zoom}px ${17 * state.zoom}px, ${19 * state.zoom}px ${23 * state.zoom}px`;
        els.gridLayer.style.backgroundPosition = `${firstX}px ${firstY}px, ${secondX}px ${secondY}px`;
      }
    }
  }
  if (zoomChanged) {
    updateZoomLabel();
    window.ConnectorUI?.refreshLabels();
  }
  refreshVisibleItems();
  // Spreadsheet previews paint at one device pixel per element pixel, so a zoom
  // change needs a re-render to stay crisp instead of scaling a stale bitmap.
  if (zoomChanged) refreshSheetPreviews();
  if (zoomChanged) scheduleImageLodRefresh();
  renderCursors();
  renderGuides();
  positionSearchLocator();
  scheduleFloatingToolbarPosition();
  lastAppliedZoom = state.zoom;
  lastAppliedRotation = state.rotation;
  if (rotationChanged && state.selectedId) {
    const selectedNode = document.querySelector(`.board-item[data-item-id="${cssEscape(state.selectedId)}"]`);
    updateSelectionHandleCursors(selectedNode?.querySelector('.selection-frame'), state.items.get(state.selectedId));
  }
  window.ConnectorImpact?.syncTrigger();
}

function scheduleCameraApply() {
  if (pointerMoveRuntime.processingGestureFrame) {
    applyCamera();
    return;
  }
  if (cameraApplyFrame) return;
  cameraApplyFrame = requestAnimationFrame(() => {
    cameraApplyFrame = null;
    applyCamera();
  });
}

function centerOnOrigin() {
  cancelWheelZoomAnimation();
  const rect = els.viewport.getBoundingClientRect();
  state.camera.x = rect.width / 2;
  state.camera.y = rect.height / 2;
  state.zoom = 1;
  applyCamera();
}

function centerOnContent() {
  cancelWheelZoomAnimation();
  const bounds = getContentBounds();
  const rect = els.viewport.getBoundingClientRect();
  if (bounds) {
    const center = boardToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
    state.camera.x += rect.width / 2 - center.x;
    state.camera.y += rect.height / 2 - center.y;
  } else {
    state.camera.x = rect.width / 2;
    state.camera.y = rect.height / 2;
  }
  applyCamera();
}

function getContentBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const section of state.sections.values()) {
    if (section.hidden) continue;

    minX = Math.min(minX, section.x);
    minY = Math.min(minY, section.y);
    maxX = Math.max(maxX, section.x + section.w);
    maxY = Math.max(maxY, section.y + (section.collapsed ? 44 : section.h));
  }
  for (const item of state.items.values()) {
    if (!isItemVisible(item) && !state.exporting) continue;
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function onViewportWheel(event) {
  if (handleAmapCardWheel(event)) return;
  if (!event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    cancelWheelZoomAnimation();
    state.camera.x -= event.deltaX;
    state.camera.y -= event.deltaY;
    
    scheduleCameraApply();
    return;
  }
  event.preventDefault();
  queueWheelZoom(event);
}

function queueWheelZoom(event) {
  const baseZoom = Number.isFinite(wheelZoomTarget) ? wheelZoomTarget : state.zoom;
  const anchor = { x: event.clientX, y: event.clientY };
  const nextZoom = canvasInteraction?.getWheelZoomTarget
    ? canvasInteraction.getWheelZoomTarget(baseZoom, event.deltaY, event.deltaMode, {
        minimum: MIN_ZOOM,
        maximum: MAX_ZOOM,
        pageSize: els.viewport.clientHeight
      })
    : clamp(baseZoom * Math.exp(-event.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM);
  wheelZoomTarget = nextZoom;
  wheelZoomAnchor = anchor;

  if (cameraRuntime.wheelZoomFrame || Math.abs(nextZoom - state.zoom) < Number.EPSILON) return;
  wheelZoomFrameTime = null;
  cameraRuntime.wheelZoomFrame = requestAnimationFrame(stepWheelZoomAnimation);
}

function stepWheelZoomAnimation(timestamp) {
  cameraRuntime.wheelZoomFrame = null;
  if (!Number.isFinite(wheelZoomTarget) || !wheelZoomAnchor) return;
  const elapsed = wheelZoomFrameTime === null ? 1000 / 60 : clamp(timestamp - wheelZoomFrameTime, 1, 32);
  wheelZoomFrameTime = timestamp;
  const blend = 1 - Math.exp(-elapsed / WHEEL_ZOOM_SMOOTHING_MS);
  const remaining = wheelZoomTarget - state.zoom;
  const settled = Math.abs(remaining) <= Math.max(0.0001, wheelZoomTarget * WHEEL_ZOOM_SETTLE_RATIO);
  const nextZoom = settled ? wheelZoomTarget : state.zoom + remaining * blend;
  setZoom(nextZoom, wheelZoomAnchor, { preserveWheelAnimation: true });
  if (settled) {
    wheelZoomTarget = null;
    wheelZoomAnchor = null;
    wheelZoomFrameTime = null;
    if (floatingToolbarMenuRuntime.floatingToolbarPositionPending) scheduleFloatingToolbarPosition();
    return;
  }
  cameraRuntime.wheelZoomFrame = requestAnimationFrame(stepWheelZoomAnimation);
}

function cancelWheelZoomAnimation() {
  if (cameraRuntime.wheelZoomFrame) cancelAnimationFrame(cameraRuntime.wheelZoomFrame);
  cameraRuntime.wheelZoomFrame = null;
  wheelZoomTarget = null;
  wheelZoomAnchor = null;
  wheelZoomFrameTime = null;
  if (floatingToolbarMenuRuntime.floatingToolbarPositionPending) scheduleFloatingToolbarPosition();
}

function zoomBy(factor) {
  setZoom(clamp(state.zoom * factor, MIN_ZOOM, MAX_ZOOM));
}

function setZoom(nextZoom, anchor = null, options = {}) {
  if (!options.preserveWheelAnimation) cancelWheelZoomAnimation();
  const viewportRect = els.viewport.getBoundingClientRect();
  const anchorX = anchor && Number.isFinite(anchor.x) ? anchor.x : viewportRect.left + viewportRect.width / 2;
  const anchorY = anchor && Number.isFinite(anchor.y) ? anchor.y : viewportRect.top + viewportRect.height / 2;
  const point = getBoardPointFromClient(anchorX, anchorY);
  const radians = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  nextZoom = clamp(
    nextZoom,
    MIN_ZOOM,
    MAX_ZOOM
  );
  state.zoom = nextZoom;
  state.camera.x = anchorX - viewportRect.left - (point.x * cos - point.y * sin) * nextZoom;
  state.camera.y = anchorY - viewportRect.top - (point.x * sin + point.y * cos) * nextZoom;
  applyCamera();
}

function resetZoom() {
  cancelWheelZoomAnimation();
  const bounds = getContentBounds();
  const rect = els.viewport.getBoundingClientRect();
  state.zoom = 1;
  if (bounds) {
    const radians = (state.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    state.camera.x = rect.width / 2 - (cx * cos - cy * sin);
    state.camera.y = rect.height / 2 - (cx * sin + cy * cos);
  } else {
    state.camera.x = rect.width / 2;
    state.camera.y = rect.height / 2;
  }
  applyCamera();
}

function fitZoom() {
  cancelWheelZoomAnimation();
  const bounds = getContentBounds();
  const rect = els.viewport.getBoundingClientRect();
  if (!bounds || !bounds.w || !bounds.h) {
    centerOnOrigin();
    return;
  }
  const padding = 80;
  const rawScale = Math.min((rect.width - padding * 2) / bounds.w, (rect.height - padding * 2) / bounds.h);
  const scale = clamp(Math.min(rawScale, 1.5), MIN_ZOOM, MAX_ZOOM);
  const radians = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;
  state.zoom = scale;
  state.camera.x = rect.width / 2 - (centerX * cos - centerY * sin) * scale;
  state.camera.y = rect.height / 2 - (centerX * sin + centerY * cos) * scale;
  applyCamera();
}

function registerMiddleClick(targetId, event) {
  const now = performance.now();
  const x = Number(event.clientX ?? event.startX);
  const y = Number(event.clientY ?? event.startY);
  const previous = state.middleClick;
  state.middleClick = { targetId, time: now, x, y };
  if (
    previous &&
    previous.targetId === targetId &&
    now - previous.time <= MIDDLE_DOUBLE_CLICK_DELAY &&
    Math.hypot(x - previous.x, y - previous.y) <= MIDDLE_DOUBLE_CLICK_DISTANCE
  ) {
    state.middleClick = null;
    focusMiddleClickTarget(targetId, { x, y });
  }
}

function focusMiddleClickTarget(targetId, anchor = null) {
  if (!targetId) {
    state.middleFocusToggle = null;
    fitZoom();
    return;
  }
  const item = state.items.get(targetId);
  if (!item) return;
  const targetKey = `item:${targetId}`;
  const toggle = state.middleFocusToggle;
  if (toggle?.targetKey === targetKey && cameraViewMatches(toggle.focusedView)) {
    restoreCameraView(toggle.previousView);
    state.middleFocusToggle = null;
    return;
  }

  const previousView = captureCameraView();
  const zoomCap =
    item.type === 'sheet' || item.type === 'table' || item.type === 'mindmap' || item.type === 'planning'
      ? 1.55
      : item.type === 'image' || item.type === 'ink'
        ? 2
        : MIDDLE_FOCUS_ZOOM_CAP;
  focusBoundsInViewport(
    { x: item.x, y: item.y, w: item.w, h: item.h },
    {
      screenPadding: window.innerWidth <= 760 ? 28 : MIDDLE_FOCUS_SCREEN_PADDING,
      zoomCap,
      minimumZoom: MIN_ZOOM
    }
  );
  state.middleFocusToggle = {
    targetKey,
    previousView,
    focusedView: captureCameraView()
  };
}

function restoreCameraView(view) {
  if (!view) return;
  state.zoom = view.zoom;
  state.rotation = view.rotation;
  state.camera.x = view.camera.x;
  state.camera.y = view.camera.y;
  applyCamera();
}

function getBoardPoint(event) {
  return getBoardPointFromClient(event.clientX, event.clientY);
}

function getBoardPointFromClient(clientX, clientY) {
  const rect = els.viewport.getBoundingClientRect();
  const radians = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = clientX - rect.left - state.camera.x;
  const dy = clientY - rect.top - state.camera.y;
  return {
    x: (dx * cos + dy * sin) / state.zoom,
    y: (-dx * sin + dy * cos) / state.zoom
  };
}

function resetRotation() {
  if (!state.rotation) {
    return;
  }
  state.rotation = 0;
  applyCamera();
}
export {
  cameraApplyFrame,
  wheelZoomTarget,
  wheelZoomAnchor,
  wheelZoomFrameTime,
  lastAppliedZoom,
  lastAppliedRotation,
  applyCamera,
  scheduleCameraApply,
  centerOnOrigin,
  centerOnContent,
  getContentBounds,
  onViewportWheel,
  queueWheelZoom,
  stepWheelZoomAnimation,
  cancelWheelZoomAnimation,
  zoomBy,
  setZoom,
  resetZoom,
  fitZoom,
  registerMiddleClick,
  focusMiddleClickTarget,
  restoreCameraView,
  getBoardPoint,
  getBoardPointFromClient,
  resetRotation
};

export { configureCamera };
