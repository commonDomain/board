import { applyCamera } from './camera.js';
import { boardToScreen } from './camera-model.js';
import { els } from './elements.js';
import { focusNavigatorTarget, focusSearchTarget, focusWorldBounds, getSearchTargetBounds } from './focus.js';
import { refreshIcons } from './interface-model.js';
import { selectItem } from './selection.js';
import { state } from './state.js';
import { clearSearchLocator, findSearchTextClientRects } from './search-locator-model.js';

function positionSearchTextHighlights(locator) {
  const viewportRect = els.viewport.getBoundingClientRect();
  const clientRects = findSearchTextClientRects(locator.targetId, locator.query);
  const children = Array.from(locator.textHighlights.children);
  while (children.length < clientRects.length) {
    const highlight = document.createElement('div');
    highlight.className = 'search-text-match';
    locator.textHighlights.appendChild(highlight);
    children.push(highlight);
  }
  children.forEach((highlight, index) => {
    const rect = clientRects[index];
    highlight.hidden = !rect;
    if (!rect) return;
    highlight.style.left = `${rect.left - viewportRect.left - 4}px`;
    highlight.style.top = `${rect.top - viewportRect.top - 3}px`;
    highlight.style.width = `${rect.width + 8}px`;
    highlight.style.height = `${rect.height + 6}px`;
  });
  if (!clientRects.length) return null;
  const first = clientRects[0];
  return {
    left: first.left - viewportRect.left,
    right: first.right - viewportRect.left,
    top: first.top - viewportRect.top,
    bottom: first.bottom - viewportRect.top
  };
}

function getSearchLocatorAnchor(locator) {
  const textRect = positionSearchTextHighlights(locator);
  if (textRect) return { ...textRect, hasTextMatch: true };
  const sheetCell = locator.sheetCell;
  if (sheetCell?.canvas?.isConnected && sheetCell.renderer) {
    const cell = sheetCell.renderer.cellRect(sheetCell.row, sheetCell.column);
    const canvasRect = sheetCell.canvas.getBoundingClientRect();
    const viewportRect = els.viewport.getBoundingClientRect();
    const canvasWidth = Math.max(1, sheetCell.canvas.clientWidth || sheetCell.renderer.state.width || 1);
    const canvasHeight = Math.max(1, sheetCell.canvas.clientHeight || sheetCell.renderer.state.height || 1);
    const scaleX = canvasRect.width / canvasWidth;
    const scaleY = canvasRect.height / canvasHeight;
    if (cell) {
      return {
        left: canvasRect.left - viewportRect.left + cell.x * scaleX,
        right: canvasRect.left - viewportRect.left + (cell.x + cell.width) * scaleX,
        top: canvasRect.top - viewportRect.top + cell.y * scaleY,
        bottom: canvasRect.top - viewportRect.top + (cell.y + cell.height) * scaleY,
        hasTextMatch: true
      };
    }
  }
  const { bounds } = locator;
  const corners = [
    boardToScreen({ x: bounds.x, y: bounds.y }),
    boardToScreen({ x: bounds.x + bounds.w, y: bounds.y }),
    boardToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h }),
    boardToScreen({ x: bounds.x, y: bounds.y + bounds.h })
  ];
  return {
    left: Math.min(...corners.map((point) => point.x)),
    right: Math.max(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    bottom: Math.max(...corners.map((point) => point.y)),
    hasTextMatch: false
  };
}

function positionSearchLocator() {
  const locator = state.searchLocator;
  if (!locator || !els.viewport) return;
  const { bounds, ring, indicator } = locator;
  const corners = [
    boardToScreen({ x: bounds.x, y: bounds.y }),
    boardToScreen({ x: bounds.x + bounds.w, y: bounds.y }),
    boardToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h }),
    boardToScreen({ x: bounds.x, y: bounds.y + bounds.h })
  ];
  const left = Math.min(...corners.map((point) => point.x));
  const right = Math.max(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const bottom = Math.max(...corners.map((point) => point.y));
  ring.style.left = `${left - 9}px`;
  ring.style.top = `${top - 9}px`;
  ring.style.width = `${Math.max(26, right - left + 18)}px`;
  ring.style.height = `${Math.max(26, bottom - top + 18)}px`;
  const anchor = getSearchLocatorAnchor(locator);
  const pointerGap = 28;
  indicator.classList.toggle('has-text-match', anchor.hasTextMatch);
  indicator.style.left = `${(anchor.left + anchor.right) / 2}px`;
  indicator.style.top = `${anchor.top - pointerGap}px`;
}

function centerSearchLocatorIndicator(locator) {
  if (!locator || !els.viewport) return;
  const anchor = getSearchLocatorAnchor(locator);
  const pointerGap = 28;
  const currentIndicatorX = (anchor.left + anchor.right) / 2;
  const currentIndicatorY = anchor.top - pointerGap;
  state.camera.x += els.viewport.clientWidth / 2 - currentIndicatorX;
  state.camera.y += els.viewport.clientHeight / 2 - currentIndicatorY;
  applyCamera();
}

function showSearchLocator(targetId, bounds, query = '') {
  clearSearchLocator();
  const ring = document.createElement('div');
  ring.className = 'search-location-ring';
  ring.dataset.searchTargetId = targetId || '';
  ring.setAttribute('aria-hidden', 'true');
  const textHighlights = document.createElement('div');
  textHighlights.className = 'search-text-highlights';
  textHighlights.setAttribute('aria-hidden', 'true');
  const indicator = document.createElement('div');
  indicator.className = 'search-location-indicator';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.setAttribute('aria-label', '搜索结果位置');
  const icon = document.createElement('i');
  icon.dataset.lucide = 'arrow-down';
  icon.setAttribute('aria-hidden', 'true');
  indicator.appendChild(icon);
  els.viewport.append(ring, textHighlights, indicator);
  state.searchLocator = { targetId, bounds: { ...bounds }, query, ring, textHighlights, indicator };
  refreshIcons(indicator);
  centerSearchLocatorIndicator(state.searchLocator);
  const locator = state.searchLocator;
  state.searchLocatorFrame = requestAnimationFrame(() => {
    state.searchLocatorFrame = null;
    if (state.searchLocator === locator) centerSearchLocatorIndicator(locator);
  });
  state.searchLocatorTimer = setTimeout(clearSearchLocator, 3000);
}

function locateTarget(targetId, fallbackX = 0, fallbackY = 0, options = {}) {
  const target = getSearchTargetBounds(targetId, fallbackX, fallbackY);
  if (target.item) selectItem(target.item.id);
  if (options.fromSearch) {
    focusSearchTarget(target.bounds, target.kind);
    showSearchLocator(targetId, target.bounds, options.query);
  } else if (options.fromNavigator) {
    focusNavigatorTarget(target.bounds, target.kind);
  } else {
    focusWorldBounds(target.bounds);
  }
}
export {
  positionSearchTextHighlights,
  getSearchLocatorAnchor,
  positionSearchLocator,
  centerSearchLocatorIndicator,
  showSearchLocator,
  locateTarget
};
