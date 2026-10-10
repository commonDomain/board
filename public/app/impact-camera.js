import { impactState } from './impact-state.js';
import { els } from './elements.js';
import { state } from './state.js';
import { MIN_ZOOM } from './constants.js';
import { applyCamera, cancelWheelZoomAnimation } from './camera.js';
import { selectItem } from './selection.js';
import {MIN_READABLE_ZOOM,reducedMotion,entity,visible} from './impact-primitives.js';

import { collect } from './impact-graph.js';
import { refreshMounted, rerenderEdges } from './impact-effects.js';

let syncTrigger,
  renderPanel;

function configureImpactCamera(callbacks) {
  ({
    syncTrigger,
    renderPanel
  } = callbacks);
}

function moveCamera(duration) {
  clearTimeout(impactState.cameraTimer);
  els.viewport.classList.toggle('impact-camera-moving', duration > 0);
  impactState.cameraTimer = setTimeout(() => {
    els.board.style.transition = '';
    els.viewport.classList.remove('impact-camera-moving');
    syncTrigger();
  }, duration + 30);
}

function fitNetwork() {
  if (!impactState.active) return;
  const nodes = impactState.cameraMode === 'all' ? impactState.active.graphNodes : impactState.active.nodes;
  const values = [...nodes.keys()].map(entity).filter(visible);
  if (!values.length) return;
  const radians = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  // Fit the projected corners so rotated canvases keep every related element in view.
  const corners = values.flatMap((value) =>
    [
      [value.x, value.y],
      [value.x + value.w, value.y],
      [value.x, value.y + value.h],
      [value.x + value.w, value.y + value.h]
    ].map(([x, y]) => ({ x: x * cos - y * sin, y: x * sin + y * cos }))
  );
  const bounds = corners.reduce(
    (box, point) => ({
      x: Math.min(box.x, point.x),
      y: Math.min(box.y, point.y),
      right: Math.max(box.right, point.x),
      bottom: Math.max(box.bottom, point.y)
    }),
    { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity }
  );
  const viewport = els.viewport.getBoundingClientRect();
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const panelWidth = narrow ? 0 : (impactState.panel?.offsetWidth || 368) + 28;
  const leftReserve = narrow ? 20 : Math.min(160, Math.max(80, viewport.width * 0.12));
  const topReserve = 75;
  const bottomReserve = narrow ? (impactState.panel?.offsetHeight || viewport.height * 0.31) + 36 : 75;
  const availableWidth = Math.max(1, viewport.width - panelWidth - leftReserve - (narrow ? 20 : 36));
  const availableHeight = Math.max(1, viewport.height - topReserve - bottomReserve);
  const width = Math.max(1, bounds.right - bounds.x);
  const height = Math.max(1, bounds.bottom - bounds.y);
  const exactFit = Math.max(MIN_ZOOM, Math.min(1.1, availableWidth / width, availableHeight / height));
  const fitScale = impactState.cameraMode === 'all' ? exactFit : Math.min(state.zoom, exactFit);
  const hasLargeSurface = values.some(
    (value) =>
      (state.sections.has(value.id) || ['image', 'kdocs', 'sheet', 'amap-map'].includes(value.type)) &&
      (value.w > 700 || value.h > 700)
  );
  const readableFloor = hasLargeSurface ? 0.82 : MIN_READABLE_ZOOM;
  const scale = impactState.cameraMode === 'all' ? fitScale : Math.max(fitScale, readableFloor);
  const root = entity(impactState.active.rootId);
  const rootX = root.x + root.w / 2;
  const rootY = root.y + root.h / 2;
  const rootCenterX = rootX * cos - rootY * sin;
  const rootCenterY = rootX * sin + rootY * cos;
  const blend = impactState.cameraMode === 'all' || scale === fitScale ? 0 : 0.5;
  const centerX = ((bounds.x + bounds.right) / 2) * (1 - blend) + rootCenterX * blend;
  const centerY = ((bounds.y + bounds.bottom) / 2) * (1 - blend) + rootCenterY * blend;
  const screenX = leftReserve + availableWidth / 2;
  const screenY = topReserve + availableHeight / 2;
  const nextCamera = {
    x: screenX - centerX * scale,
    y: screenY - centerY * scale
  };
  if (
    Math.abs(state.zoom - scale) < 0.002 &&
    Math.hypot(state.camera.x - nextCamera.x, state.camera.y - nextCamera.y) < 3
  )
    return;
  cancelWheelZoomAnimation();
  const duration = reducedMotion() ? 0 : 560;
  if (duration) els.board.style.transition = 'transform 560ms cubic-bezier(.2,.78,.2,1)';
  state.zoom = scale;
  state.camera = nextCamera;
  applyCamera();
  moveCamera(duration);
}

function focusEntity(id) {
  const value = entity(id);
  if (!value) return;
  if (impactState.active && !impactState.active.nodes.has(id)) {
    const previous = impactState.active;
    impactState.active = collect(id);
    refreshMounted();
    rerenderEdges(new Set([...previous.edges.keys(), ...impactState.active.edges.keys()]));
    renderPanel(true);
  }
  if (state.items.has(id)) selectItem(id);
  const rect = els.viewport.getBoundingClientRect();
  const leftReserve = Math.min(160, Math.max(80, rect.width * 0.12));
  const targetX =
    rect.width < 760 ? rect.width / 2 : (leftReserve + rect.width - Math.min(368, rect.width * 0.36) - 28) / 2;
  const targetY = rect.width < 760 ? rect.height * 0.35 : rect.height / 2;
  const radians = (state.rotation * Math.PI) / 180;
  const x = value.x + value.w / 2,
    y = value.y + value.h / 2;
  state.camera.x = targetX - (x * Math.cos(radians) - y * Math.sin(radians)) * state.zoom;
  state.camera.y = targetY - (x * Math.sin(radians) + y * Math.cos(radians)) * state.zoom;
  const duration = reducedMotion() ? 0 : 340;
  if (duration) els.board.style.transition = 'transform 340ms ease';
  applyCamera();
  moveCamera(duration);
}
export { moveCamera, fitNetwork, focusEntity };

export { configureImpactCamera };
