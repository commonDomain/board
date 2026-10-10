import {
  EXTREME_CANVAS_OBJECT_THRESHOLD,
  SPATIAL_INDEX_OBJECT_THRESHOLD,
  VIEWPORT_VIRTUALIZATION_OBJECT_THRESHOLD
} from './constants.js';
import { els } from './elements.js';
import { canMutateItem } from './layers-model.js';
import { isItemVisible } from './layer-visibility.js';
import { pickPrimarySelection } from './marquee-model.js';
import { clearMindNodeSelection } from './mindmap-editing-model.js';
import { canvasInteraction } from './pan.js';
import { spatialIndexRuntime } from './runtime/spatial-index.js';
import { selectionChangedIds } from './selection-model.js';
import { updateSelectionUI } from './selection.js';
import { state } from './state.js';
import { staticAssetUrl } from './utilities.js';
import {
  updateItemLoadMetrics,
  removeItemLoadMetrics,
  rebuildItemLoadMetrics,
  removeConnectorFromIndex,
  indexConnector,
  rebuildConnectorIndex,
  geometryWorkerItem
} from './spatial-index-model.js';

let geometryWorker = null;

let geometrySelectionInFlight = false;

function rebuildSpatialIndex() {
  updateCanvasLoadTier(true);
  if (els.viewport) els.viewport.dataset.loadTier = state.loadTier;
  if (!state.spatialIndexEnabled) {
    state.spatialIndex.clear();
  } else {
    state.spatialIndex.rebuild(
      Array.from(state.items.values())
        .filter(isItemVisible)
        .map((item) => ({ ...item, value: item }))
    );
  }
  rebuildConnectorIndex();
  syncGeometryWorker();
}

function refreshAdaptiveCanvasModes() {
  const previousTier = state.loadTier;
  const wasIndexed = state.spatialIndexEnabled;
  updateCanvasLoadTier(false);
  const shouldIndex = state.loadTier !== 'small';
  const shouldVirtualize = state.loadTier === 'large' || state.loadTier === 'extreme';
  if (shouldIndex !== wasIndexed) {
    state.spatialIndexEnabled = shouldIndex;
    if (shouldIndex) {
      state.spatialIndex.rebuild(
        Array.from(state.items.values())
          .filter(isItemVisible)
          .map((item) => ({ ...item, value: item }))
      );
    } else {
      state.spatialIndex.clear();
    }
  }
  state.viewportVirtualizationEnabled = shouldVirtualize;
  if (previousTier !== state.loadTier) {
    els.viewport.dataset.loadTier = state.loadTier;
    syncGeometryWorker();
  }
}

function updateCanvasLoadTier(forceComplexityScan = false) {
  const now = performance.now();
  if (forceComplexityScan || state.renderComplexityByItem.size !== state.items.size) {
    rebuildItemLoadMetrics();
    state.mountedNodeCount = els.itemsLayer?.querySelectorAll('.board-item').length || 0;
  }
  const candidateTier = canvasInteraction?.getLoadTier
    ? canvasInteraction.getLoadTier({
        itemCount: state.items.size,
        inkPointCount: state.inkPointCount,
        renderComplexity: state.renderComplexity,
        mountedNodeCount: state.mountedNodeCount || 0,
        gestureP95: state.gestureFrameP95 || 0
      })
    : state.items.size >= EXTREME_CANVAS_OBJECT_THRESHOLD
      ? 'extreme'
      : state.items.size >= VIEWPORT_VIRTUALIZATION_OBJECT_THRESHOLD
        ? 'large'
        : state.items.size >= SPATIAL_INDEX_OBJECT_THRESHOLD
          ? 'medium'
          : 'small';
  const tierOrder = canvasInteraction?.LOAD_TIER_ORDER || ['small', 'medium', 'large', 'extreme'];
  const currentIndex = Math.max(0, tierOrder.indexOf(state.loadTier));
  const candidateIndex = Math.max(0, tierOrder.indexOf(candidateTier));
  if (candidateIndex >= currentIndex) {
    state.loadTier = candidateTier;
    state.loadTierDowngrade = null;
  } else {
    const nominalThreshold = [0, 500, 2000, 10000][currentIndex] || 0;
    const belowHysteresis = state.items.size < nominalThreshold * 0.9;
    if (!belowHysteresis) {
      state.loadTierDowngrade = null;
    } else if (state.loadTierDowngrade?.tier !== candidateTier) {
      state.loadTierDowngrade = { tier: candidateTier, since: now };
    } else if (now - state.loadTierDowngrade.since >= 3000) {
      state.loadTier = candidateTier;
      state.loadTierDowngrade = null;
    }
  }
  state.spatialIndexEnabled = state.loadTier !== 'small';
  state.viewportVirtualizationEnabled = state.loadTier === 'large' || state.loadTier === 'extreme';
}

function ensureGeometryWorker() {
  if (state.loadTier !== 'extreme' || typeof Worker !== 'function') return null;
  if (geometryWorker) return geometryWorker;
  geometryWorker = new Worker(staticAssetUrl('canvas-geometry-worker.js'));
  geometryWorker.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type !== 'selection') return;
    geometrySelectionInFlight = false;
    spatialIndexRuntime.completedGeometrySelectionSequence = Math.max(
      spatialIndexRuntime.completedGeometrySelectionSequence,
      Number(message.sequence) || 0
    );
    const finalizing =
      spatialIndexRuntime.geometryMarqueeFinalize?.sequence === message.sequence
        ? spatialIndexRuntime.geometryMarqueeFinalize
        : null;
    if (message.sequence === spatialIndexRuntime.latestGeometrySelectionSequence && (state.marquee || finalizing)) {
      const previousIds = state.selectedIds;
      const previousPrimary = state.selectedId;
      const nextIds = new Set(
        (message.ids || []).filter((id) => state.items.has(id) && canMutateItem(state.items.get(id)))
      );
      state.selectedIds = nextIds;
      state.selectedId = pickPrimarySelection(state.marquee?.start || finalizing.start, nextIds);
      clearMindNodeSelection();
      updateSelectionUI({
        panels: !state.marquee,
        itemIds: selectionChangedIds(previousIds, nextIds, previousPrimary, state.selectedId),
        selectionBounds: message.bounds
      });
      if (finalizing) spatialIndexRuntime.geometryMarqueeFinalize = null;
    }
    if (
      spatialIndexRuntime.pendingGeometrySelection &&
      (state.marquee || spatialIndexRuntime.geometryMarqueeFinalize)
    ) {
      const next = spatialIndexRuntime.pendingGeometrySelection;
      spatialIndexRuntime.pendingGeometrySelection = null;
      geometrySelectionInFlight = true;
      geometryWorker.postMessage(next);
    } else {
      spatialIndexRuntime.pendingGeometrySelection = null;
    }
  });
  geometryWorker.postMessage({ type: 'reset', items: Array.from(state.items.values(), geometryWorkerItem) });
  return geometryWorker;
}

function syncGeometryWorker() {
  if (state.loadTier === 'extreme') {
    ensureGeometryWorker()?.postMessage({ type: 'reset', items: Array.from(state.items.values(), geometryWorkerItem) });
  } else if (geometryWorker) {
    geometryWorker.terminate();
    geometryWorker = null;
    geometrySelectionInFlight = false;
    spatialIndexRuntime.pendingGeometrySelection = null;
    spatialIndexRuntime.geometryMarqueeFinalize = null;
  }
}

function requestWorkerMarqueeSelection(marquee) {
  const worker = ensureGeometryWorker();
  if (!worker) return false;
  const sequence = ++spatialIndexRuntime.geometrySelectionSequence;
  spatialIndexRuntime.latestGeometrySelectionSequence = sequence;
  marquee.workerSequence = sequence;
  const request = {
    type: 'select',
    sequence,
    mode: marquee.mode,
    start: marquee.start,
    current: marquee.current,
    points: marquee.points
  };
  if (geometrySelectionInFlight) {
    spatialIndexRuntime.pendingGeometrySelection = request;
  } else {
    geometrySelectionInFlight = true;
    worker.postMessage(request);
  }
  return true;
}

function indexUpsertItem(item) {
  updateItemLoadMetrics(item);
  refreshAdaptiveCanvasModes();
  if (state.spatialIndexEnabled) state.spatialIndex.upsert(item.id, item, item);
  indexConnector(item);
  if (geometryWorker) geometryWorker.postMessage({ type: 'upsert', item: geometryWorkerItem(item) });
}

function indexRemoveItem(id) {
  removeItemLoadMetrics(id);
  removeConnectorFromIndex(id);
  state.connectorIndex.delete(id);
  if (geometryWorker) geometryWorker.postMessage({ type: 'remove', id });
  if (state.spatialIndexEnabled) state.spatialIndex.remove(id);
  refreshAdaptiveCanvasModes();
}
export {
  geometryWorker,
  geometrySelectionInFlight,
  rebuildSpatialIndex,
  refreshAdaptiveCanvasModes,
  updateCanvasLoadTier,
  ensureGeometryWorker,
  syncGeometryWorker,
  requestWorkerMarqueeSelection,
  indexUpsertItem,
  indexRemoveItem
};
