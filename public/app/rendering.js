
import { updateAmapMapChrome } from './amap-rendering-model.js';

import {
  MIN_ITEM_SIZE,
  MIN_ZOOM,
  TEXT_DECORATIVE_BORDER_STYLES,
  VIEWPORT_RENDER_MARGIN_PX,
  VIEWPORT_RETAIN_MARGIN_PX
} from './constants.js';
import { els } from './elements.js';

import { normalizeTextBorderStyle } from './format-panel-model.js';

import { renderConnector, renderImage, renderInk } from './ink-rendering-model.js';
import { renderSticker } from './ink-rendering.js';
import { refreshIcons } from './interface-model.js';
import { destroyKdocsInstance, initializeKdocsEmbed, kdocsInstances, renderKdocsEmbed } from './kdocs.js';
import {
  applyLayerStyleToNode,
  canMutateItem,
  compareRenderItems,
  getLayerIndex,
  isLayerVisible
} from './layers-model.js';

import { isItemVisible } from './layer-visibility.js';

import { isTransformableItem } from './marquee-model.js';

import { renderSections } from './sections.js';
import { getSelectedIds } from './selection-model.js';

import { renderShape } from './shape-rendering.js';

import { queryItemsAtPoint, queryItemsInRect } from './spatial-index-model.js';
import { indexUpsertItem } from './spatial-index.js';

import { state } from './state.js';

import { renderTextBorderDecoration } from './text-rendering-model.js';

import { cssEscape } from './utilities.js';
import { intersectsRect, pointHitsItemBounds, getPinnedRenderItems } from './rendering-model.js';

let destroyAmapFrame,
  renderAmapMap,
  renderAmapRoute,
  renderAmapSearch,
  syncAmapFrame,
  getBoardPointFromClient,
  scheduleFloatingToolbarPosition,
  updateFloatingFormatBar,
  cancelActiveGesture,
  ensureLayerContainers,
  getLayerContainer,
  attachSelectionFrame,
  renderNoteMoveHandle,
  renderMindMap,
  refreshOrganizationUi,
  selectItem,
  updateMultiSelectionFrame,
  updateSelectionUI,
  mountSheetPreview,
  destroySheetPreview,
  destroySheetRecord,
  rebuildSpatialIndex,
  renderTable,
  renderTextCard,
  updateCanvasStartState,
  updateItemElementGeometry;

function configureRendering(callbacks) {
  ({
    destroyAmapFrame,
    renderAmapMap,
    renderAmapRoute,
    renderAmapSearch,
    syncAmapFrame,
    getBoardPointFromClient,
    scheduleFloatingToolbarPosition,
    updateFloatingFormatBar,
    cancelActiveGesture,
    ensureLayerContainers,
    getLayerContainer,
    attachSelectionFrame,
    renderNoteMoveHandle,
    renderMindMap,
    refreshOrganizationUi,
    selectItem,
    updateMultiSelectionFrame,
    updateSelectionUI,
    mountSheetPreview,
    destroySheetPreview,
    destroySheetRecord,
    rebuildSpatialIndex,
    renderTable,
    renderTextCard,
    updateCanvasStartState,
    updateItemElementGeometry
  } = callbacks);
}

let cameraRefreshTimer = null;

let incrementalMountFrame = null;

let incrementalMountQueue = [];

let incrementalMountIndex = 0;

function renderAll(options = {}) {
  cancelIncrementalMounts();
  renderSections();
  if (options.rebuildIndexes !== false) rebuildSpatialIndex();
  const visible = getVisibleWorldRect();
  const candidates = (
    state.exporting || !state.viewportVirtualizationEnabled
      ? Array.from(state.items.values())
      : queryItemsInRect(visible)
  ).filter(isItemVisible);
  const pinned = getPinnedRenderItems().filter(isItemVisible);
  const items = Array.from(new Map([...candidates, ...pinned].map((item) => [item.id, item])).values()).sort(
    compareRenderItems
  );
  const mountedIds = new Set(items.map((item) => item.id));
  for (const node of Array.from(els.itemsLayer.querySelectorAll('.board-item'))) {
    const itemId = node.dataset.itemId;
    if (itemId && !mountedIds.has(itemId)) removeItemElement(itemId);
  }
  // Keep existing item nodes attached while a full canvas render is reconciled.
  // Removing the layer tree would unload every embedded document and charge a
  // fresh AMap JS initialization even when the map item itself did not change.
  ensureLayerContainers({ prune: false });
  const deferredItems = [];
  for (const item of items) {
    if (
      state.exporting ||
      !state.viewportVirtualizationEnabled ||
      pinned.includes(item) ||
      intersectsRect(item, visible)
    ) {
      const mounted = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
      const shouldDefer =
        (state.loadTier === 'large' || state.loadTier === 'extreme') &&
        !state.exporting &&
        !pinned.includes(item) &&
        !mounted;
      if (shouldDefer) deferredItems.push(item);
      else {
        renderItemSafely(item);
      }
    }
  }
  ensureLayerContainers();
  if (deferredItems.length) scheduleIncrementalMounts(deferredItems);
  const keepIds = new Set(Array.from(state.selectedIds).filter((id) => state.items.has(id)));
  state.selectedIds = keepIds;
  if (keepIds.size && !keepIds.has(state.selectedId)) {
    state.selectedId = Array.from(keepIds)[0];
  }
  if (!keepIds.size) {
    state.selectedId = null;
  }
  updateSelectionUI();
  refreshOrganizationUi();
  updateCanvasStartState();
}

function getVisibleWorldRect(marginPixels = VIEWPORT_RENDER_MARGIN_PX) {
  const rect = els.viewport.getBoundingClientRect();
  const margin = Math.max(0, Number(marginPixels) || 0) / Math.max(state.zoom, MIN_ZOOM);
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.left, y: rect.bottom },
    { x: rect.right, y: rect.bottom }
  ].map((point) => getBoardPointFromClient(point.x, point.y));
  return {
    x: Math.min(...corners.map((point) => point.x)) - margin,
    y: Math.min(...corners.map((point) => point.y)) - margin,
    w: Math.max(...corners.map((point) => point.x)) - Math.min(...corners.map((point) => point.x)) + margin * 2,
    h: Math.max(...corners.map((point) => point.y)) - Math.min(...corners.map((point) => point.y)) + margin * 2
  };
}

function hitTestItem(point, options = {}) {
  let best = null;
  for (const item of queryItemsAtPoint(point)) {
    if (!isItemVisible(item)) continue;
    if (options.includeLocked ? !isLayerVisible(item) : !canMutateItem(item)) {
      continue;
    }
    if (pointHitsItemBounds(item, point)) {
      const itemLayer = getLayerIndex(item.layerId || 'layer_default');
      const bestLayer = best ? getLayerIndex(best.layerId || 'layer_default') : -1;
      if (!best || itemLayer > bestLayer || (itemLayer === bestLayer && (item.z || 1) >= (best.z || 1))) {
        best = item;
      }
    }
  }
  return best;
}

function refreshVisibleItems() {
  if (state.exporting || !state.viewportVirtualizationEnabled) {
    return;
  }
  if (cameraRefreshTimer) {
    return;
  }
  cameraRefreshTimer = requestAnimationFrame(() => {
    cameraRefreshTimer = null;
    const visible = getVisibleWorldRect(VIEWPORT_RENDER_MARGIN_PX);
    const retain = getVisibleWorldRect(VIEWPORT_RETAIN_MARGIN_PX);
    const pinned = new Set(getPinnedRenderItems().map((item) => item.id));
    const mountCandidates = queryItemsInRect(visible).filter(
      (item) =>
        intersectsRect(item, visible) && !document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`)
    );
    if (state.loadTier === 'extreme') {
      scheduleIncrementalMounts(mountCandidates);
    } else {
      for (const item of mountCandidates) renderItemSafely(item);
    }
    for (const node of Array.from(els.itemsLayer.querySelectorAll('.board-item'))) {
      const id = node.dataset.itemId;
      const item = id ? state.items.get(id) : null;
      if (id && !pinned.has(id) && (!item || !intersectsRect(item, retain))) {
        removeItemElement(id);
      }
    }
  });
}

function renderItemSafely(item) {
  try {
    renderItem(item);
  } catch (error) {
    console.warn('[render] Item failed during render', item.type, item.id, error);
    state.renderErrorIds.add(item.id);
    document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`)?.remove();
    renderItemFallback(item);
  }
}

function cancelIncrementalMounts() {
  incrementalMountQueue = [];
  incrementalMountIndex = 0;
  if (incrementalMountFrame) cancelAnimationFrame(incrementalMountFrame);
  incrementalMountFrame = null;
}

function scheduleIncrementalMounts(items) {
  incrementalMountQueue = Array.from(new Map((items || []).map((item) => [item.id, item])).values());
  incrementalMountIndex = 0;
  if (incrementalMountFrame || !incrementalMountQueue.length) return;
  const mountBatch = () => {
    incrementalMountFrame = null;
    const startedAt = performance.now();
    const visible = getVisibleWorldRect(VIEWPORT_RENDER_MARGIN_PX);
    const pinned = new Set(getPinnedRenderItems().map((item) => item.id));
    let mounted = 0;
    while (incrementalMountIndex < incrementalMountQueue.length && mounted < 120 && performance.now() - startedAt < 6) {
      const queued = incrementalMountQueue[incrementalMountIndex++];
      const item = state.items.get(queued.id);
      if (!item || (!pinned.has(item.id) && !intersectsRect(item, visible))) continue;
      if (!document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`)) renderItemSafely(item);
      mounted += 1;
    }
    if (incrementalMountIndex < incrementalMountQueue.length) incrementalMountFrame = requestAnimationFrame(mountBatch);
    else {
      incrementalMountQueue = [];
      incrementalMountIndex = 0;
    }
  };
  incrementalMountFrame = requestAnimationFrame(mountBatch);
}

function renderItem(item) {
  window.ConnectorUI?.observe(item);
  state.renderErrorIds.delete(item.id);
  let node = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  const layerContainer = getLayerContainer(item.layerId || 'layer_default');
  if (!node) {
    node = document.createElement('div');
    node.className = 'board-item';
    node.dataset.itemId = item.id;
    layerContainer.appendChild(node);
  } else if (node.parentElement !== layerContainer) {
    layerContainer.appendChild(node);
  }
  const reuseKdocsFrame =
    item.type === 'kdocs' &&
    node.querySelector('.kdocs-embed-mount')?.dataset.url === item.url &&
    Boolean(node.querySelector('.kdocs-embed-frame'));
  const reuseAmapFrame =
    item.type === 'amap-map' && node.querySelector('.amap-map-frame')?.dataset.boardId === state.boardId;
  if (item.type !== 'kdocs' || !reuseKdocsFrame) {
    destroyKdocsInstance(item.id);
  }
  if (item.type !== 'amap-map' || !reuseAmapFrame) destroyAmapFrame(item.id);
  applyLayerStyleToNode(item, node);

  const selected =
    state.selectedIds.has(item.id) &&
    isTransformableItem(item) &&
    (item.type === 'table' || item.type === 'note' || state.editingId !== item.id);
  const editing = state.editingId === item.id || state.mindmapEditing?.itemId === item.id;
  node.className = `board-item ${item.type}-item${selected ? ' selected' : ''}${editing ? ' editing' : ''}`;
  window.ConnectorImpact?.decorateNode(node, item);
  node.style.left = `${item.x}px`;
  node.style.top = `${item.y}px`;
  node.style.width = `${Math.max(MIN_ITEM_SIZE, item.w || 120)}px`;
  node.style.height = `${Math.max(MIN_ITEM_SIZE, item.h || 80)}px`;
  node.style.setProperty('--rotation', `${item.rotation || 0}deg`);
  node.style.setProperty('--z', item.z || 1);
  node.dataset.type = item.type;
  node.dataset.hidden = String(!isItemVisible(item));
  node.dataset.locked = String(!canMutateItem(item));
  node.dataset.sectionCollapsed = String(Boolean(item.sectionId && state.sections.get(item.sectionId)?.collapsed));
  node.draggable = false;
  node.ondragstart = node.draggable
    ? (event) => {
        if (!state.selectedIds.has(item.id)) selectItem(item.id);
        cancelActiveGesture();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-museboard-items', getSelectedIds().join(','));
      }
    : null;
  if (reuseKdocsFrame || reuseAmapFrame) {
    node.querySelector('.selection-frame')?.remove();
  } else {
    node.innerHTML = '';
  }

  try {
    if (item.type === 'planning') {
      node.appendChild(window.MusePlanning.mount(item, view => {
        const current = state.items.get(item.id);
        if (current) return import('./items.js').then(({ upsertItem }) => upsertItem({ ...current, planView: view }, { select: false }));
      }, {
        move: event => { if (event.button !== 0 || state.spacePan) return false; if (canMutateItem(item)) { if (!state.selectedIds.has(item.id)) selectItem(item.id); return window.MusePlanning.moveCanvasComponent(event, item.id); } },
        remove: () => import('./items.js').then(({ deleteItems }) => { if (canMutateItem(state.items.get(item.id))) deleteItems([item.id]); }),
        writable: () => Boolean(state.items.has(item.id) && canMutateItem(state.items.get(item.id)))
      }));
    } else if (item.taskRef && window.MusePlanning?.enabled && state.editingId !== item.id) {
      node.appendChild(window.MusePlanning.renderLinked(item.taskRef, item.text));
    } else if (item.type === 'ink') {
      node.appendChild(renderInk(item));
    } else if (item.type === 'connector') {
      node.appendChild(renderConnector(item));
    } else if (item.type === 'image') {
      node.appendChild(renderImage(item));
    } else if (item.type === 'kdocs' && !reuseKdocsFrame) {
      const card = renderKdocsEmbed(item);
      node.appendChild(card);
      initializeKdocsEmbed(item, card);
    } else if (item.type === 'sticker') {
      node.appendChild(renderSticker(item));
    } else if (item.type === 'shape') {
      node.appendChild(renderShape(item));
    } else if (item.type === 'text' || item.type === 'note') {
      node.appendChild(renderTextCard(item));
      if (item.type === 'text' && TEXT_DECORATIVE_BORDER_STYLES.has(normalizeTextBorderStyle(item.textBorderStyle))) {
        node.appendChild(renderTextBorderDecoration(item));
      }
    } else if (item.type === 'table') {
      node.appendChild(renderTable(item));
    } else if (item.type === 'sheet') {
      const preview = mountSheetPreview(item, node);
      if (preview) node.appendChild(preview);
    } else if (item.type === 'mindmap') {
      const previousWidth = item.w, previousHeight = item.h;
      node.appendChild(renderMindMap(item));
      node.style.width = `${item.w}px`; node.style.height = `${item.h}px`;
      if (item.w !== previousWidth || item.h !== previousHeight) indexUpsertItem(item);
    } else if (item.type === 'amap-map') {
      if (!reuseAmapFrame) node.appendChild(renderAmapMap(item));
      updateAmapMapChrome(node, item);
      syncAmapFrame(item.id);
    } else if (item.type === 'amap-search') {
      node.appendChild(renderAmapSearch(item));
    } else if (item.type === 'amap-route') {
      node.appendChild(renderAmapRoute(item));
    }

    if (item.type === 'note' && (selected || state.editingId === item.id)) {
      node.appendChild(renderNoteMoveHandle());
    }

    updateItemElementGeometry(item);
    if (item.type === 'kdocs') {
      requestAnimationFrame(() => kdocsInstances.get(item.id)?.forceIframeResize?.());
    }

    if (selected && state.selectedId === item.id) {
      attachSelectionFrame(node);
    }
    if (state.selectedIds.size > 1) {
      updateMultiSelectionFrame();
    }
    refreshIcons(node);
    if (item.id === state.selectedId || editing) {
      updateFloatingFormatBar(item);
      scheduleFloatingToolbarPosition();
    }
  } catch (error) {
    // One malformed item must never abort the full render loop: drop the
    // half-built node and mount a visible placeholder instead. The reason is
    // logged with the item id and kept on the placeholder so a failure in the
    // field can be diagnosed without a debugger attached.
    console.warn('[render] Failed to render item', item.type, item.id, error);
    destroyKdocsInstance(item.id);
    destroyAmapFrame(item.id);
    state.renderErrorIds.add(item.id);
    node.remove();
    renderItemFallback(item);
  }
}

function renderItemFallback(item) {
  // Must never throw: it is the last-resort path inside render error
  // handlers, so an exception here would still abort the render loop.
  try {
    const layerContainer = getLayerContainer(item.layerId || 'layer_default');
    const node = document.createElement('div');
    node.className = 'board-item render-error';
    node.dataset.itemId = item.id;
    if (item.type) node.dataset.type = item.type;
    node.style.left = `${Number(item.x) || 0}px`;
    node.style.top = `${Number(item.y) || 0}px`;
    node.style.width = `${Math.max(MIN_ITEM_SIZE, Number(item.w) || 120)}px`;
    node.style.height = `${Math.max(MIN_ITEM_SIZE, Number(item.h) || 80)}px`;
    const label = document.createElement('span');
    label.className = 'render-error-label';
    label.textContent = '内容渲染失败';
    node.appendChild(label);
    layerContainer.appendChild(node);
    return node;
  } catch (error) {
    console.warn('[render] Could not mount render-error placeholder', item.id, error);
    return null;
  }
}

function removeItemElement(id) {
  destroyKdocsInstance(id);
  destroyAmapFrame(id);
  destroySheetPreview(id);
  document.querySelector(`.board-item[data-item-id="${cssEscape(id)}"]`)?.remove();
  // Virtualization removes only the DOM surface. A deleted item has no model to
  // remount, so its store/listeners can be released as well.
  if (!state.items.has(id)) destroySheetRecord(id);
}
export {
  cameraRefreshTimer,
  incrementalMountFrame,
  incrementalMountQueue,
  incrementalMountIndex,
  renderAll,
  getVisibleWorldRect,
  hitTestItem,
  refreshVisibleItems,
  renderItemSafely,
  cancelIncrementalMounts,
  scheduleIncrementalMounts,
  renderItem,
  renderItemFallback,
  removeItemElement
};

export { configureRendering };
