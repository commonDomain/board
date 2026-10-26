import { applyCamera, getContentBounds } from './camera.js';
import { boardToScreen } from './camera-model.js';
import { MAX_ZOOM, MIN_ZOOM } from './constants.js';
import { els } from './elements.js';
import { getGroupMemberItemIds } from './groups-model.js';
import { getBoundsOfItems } from './selection-model.js';
import { state } from './state.js';
import { clamp } from './utilities.js';

function focusWorldBounds(bounds) {
  const viewport = els.viewport.getBoundingClientRect();
  const center = boardToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
  state.camera.x += viewport.width / 2 - center.x;
  state.camera.y += viewport.height / 2 - center.y;
  applyCamera();
}

function getSearchTargetBounds(targetId, fallbackX = 0, fallbackY = 0) {
  const item = state.items.get(targetId);
  if (item) return { bounds: item, kind: 'item', item };
  const section = state.sections.get(targetId);
  if (section) return { bounds: section, kind: 'section', section };
  const group = state.groups.get(targetId);
  if (group) {
    const bounds = getBoundsOfItems(getGroupMemberItemIds(group.id));
    if (bounds) return { bounds, kind: 'group', group };
  }
  if (targetId === state.boardId) {
    const bounds = getContentBounds();
    if (bounds) return { bounds, kind: 'canvas' };
  }
  return { bounds: { x: fallbackX - 40, y: fallbackY - 40, w: 80, h: 80 }, kind: 'fallback' };
}

function getFocusSafeViewport() {
  const viewportRect = els.viewport.getBoundingClientRect();
  const margin = window.innerWidth <= 760 ? 24 : 72;
  let left = margin;
  let top = margin;
  let right = viewportRect.width - margin;
  let bottom = viewportRect.height - margin;
  const documentBar = document.querySelector('.document-bar');
  const barRect = documentBar?.getBoundingClientRect();
  if (barRect && barRect.bottom > viewportRect.top && barRect.top < viewportRect.bottom) {
    top = Math.max(top, barRect.bottom - viewportRect.top + 22);
  }
  const overlayPanels = [els.navigatorPanel, document.getElementById('contextPanel'), ...document.querySelectorAll('.planning-panel:not([hidden]),.planning-property-panel[open]')];
  for (const panel of overlayPanels) {
    if (!panel || panel.hidden) continue;
    const panelRect = panel.getBoundingClientRect();
    if (!panelRect.width || !panelRect.height) continue;
    if (panelRect.left > viewportRect.left + viewportRect.width / 2) {
      right = Math.min(right, panelRect.left - viewportRect.left - 22);
    } else if (panel.matches('.planning-panel')&&panelRect.right<viewportRect.left+viewportRect.width/2) {
      left=Math.max(left,panelRect.right-viewportRect.left+22);
    } else if (panelRect.top > viewportRect.top + viewportRect.height / 2) {
      bottom = Math.min(bottom, panelRect.top - viewportRect.top - 22);
    }
  }
  if (els.arrangeBar && !els.arrangeBar.hidden) {
    const arrangeRect = els.arrangeBar.getBoundingClientRect();
    bottom = Math.min(bottom, arrangeRect.top - viewportRect.top - 22);
  }
  if (right - left < 240) [left, right] = [24, viewportRect.width - 24];
  if (bottom - top < 200) [top, bottom] = [24, viewportRect.height - 24];
  return { left, top, right, bottom, w: right - left, h: bottom - top };
}

function focusBoundsInViewport(bounds, options = {}) {
  const viewport = els.viewport.getBoundingClientRect();
  const safe = options.fullViewport
    ? { left: 0, top: 0, right: viewport.width, bottom: viewport.height, w: viewport.width, h: viewport.height }
    : getFocusSafeViewport();
  const worldPadding = Math.max(0, Number(options.worldPadding || 0));
  const screenPadding = Math.max(0, Number(options.screenPadding || 0));
  const width = Math.max(1, Number(bounds.w || 0) + worldPadding * 2);
  const height = Math.max(1, Number(bounds.h || 0) + worldPadding * 2);
  const radians = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedWidth = Math.abs(width * cos) + Math.abs(height * sin);
  const rotatedHeight = Math.abs(width * sin) + Math.abs(height * cos);
  const availableWidth = Math.max(1, safe.w - screenPadding * 2);
  const availableHeight = Math.max(1, safe.h - screenPadding * 2);
  const fitScale = Math.min(availableWidth / rotatedWidth, availableHeight / rotatedHeight);
  const zoomCap = clamp(Number(options.zoomCap ?? MAX_ZOOM), MIN_ZOOM, MAX_ZOOM);
  const minimumZoom = clamp(Number(options.minimumZoom ?? MIN_ZOOM), MIN_ZOOM, zoomCap);
  const nextZoom = clamp(Math.min(fitScale, zoomCap), minimumZoom, MAX_ZOOM);
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;
  state.zoom = nextZoom;
  state.camera.x = safe.left + safe.w / 2 - (centerX * cos - centerY * sin) * nextZoom;
  state.camera.y = safe.top + safe.h / 2 - (centerX * sin + centerY * cos) * nextZoom;
  applyCamera();
}

function focusSearchTarget(bounds, kind) {
  const zoomCap = kind === 'item' || kind === 'fallback' ? 1.6 : kind === 'group' ? 1.35 : 1.15;
  focusBoundsInViewport(bounds, {
    worldPadding: 48,
    zoomCap,
    minimumZoom: Math.max(MIN_ZOOM, 0.45)
  });
}

function focusNavigatorTarget(bounds) {
  focusBoundsInViewport(bounds, {
    screenPadding: window.innerWidth <= 760 ? 8 : 16,
    zoomCap: MAX_ZOOM,
    minimumZoom: MIN_ZOOM
  });
}

export {
  focusBoundsInViewport,
  focusNavigatorTarget,
  focusSearchTarget,
  focusWorldBounds,
  getFocusSafeViewport,
  getSearchTargetBounds
};
