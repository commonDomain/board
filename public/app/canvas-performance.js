import { state } from './state.js';
import { els } from './elements.js';
import { resolveViewportLoad, viewportWorkPolicy } from './canvas-performance-model.js';

let boardId, epoch, previous = {}, metrics = {}, downgradeTimer = null, navigationTimer = null;

function resetViewportPerformance() {
  clearTimeout(downgradeTimer);
  clearTimeout(navigationTimer);
  downgradeTimer = navigationTimer = null;
  boardId = state.boardId;
  epoch = state.canvasEpoch;
  previous = {};
  metrics = { items: 0, connectors: 0, complexity: 0 };
  state.viewportLoadTier = 'small';
  state.viewportLoad = metrics;
  if (els.viewport) {
    els.viewport.dataset.renderTier = 'small';
    delete els.viewport.dataset.navigating;
  }
}

function reconcileViewportLoad() {
  previous = resolveViewportLoad(metrics, previous, performance.now());
  state.viewportLoadTier = previous.tier;
  if (els.viewport.dataset.renderTier !== previous.tier) els.viewport.dataset.renderTier = previous.tier;
  clearTimeout(downgradeTimer);
  downgradeTimer = previous.downgradeAt == null ? null : setTimeout(reconcileViewportLoad, Math.max(1, previous.downgradeAt - performance.now()));
}

function updateViewportPerformance(items) {
  if (boardId !== state.boardId || epoch !== state.canvasEpoch) {
    resetViewportPerformance();
  }
  metrics = { items: 0, connectors: 0, complexity: 0 };
  for (const item of items) {
    metrics.items++;
    if (item.type === 'connector') metrics.connectors++;
    metrics.complexity += state.renderComplexityByItem.get(item.id) || 1;
  }
  state.viewportLoad = metrics;
  reconcileViewportLoad();
}

function getViewportWorkPolicy() { return viewportWorkPolicy(state.viewportLoadTier); }

function markCanvasNavigation() {
  if (!getViewportWorkPolicy().navigationLayer) return;
  if (els.viewport.dataset.navigating !== 'true') els.viewport.dataset.navigating = 'true';
  clearTimeout(navigationTimer);
  navigationTimer = setTimeout(() => {
    navigationTimer = null;
    delete els.viewport.dataset.navigating;
  }, 180);
}

export { resetViewportPerformance, updateViewportPerformance, getViewportWorkPolicy, markCanvasNavigation };
