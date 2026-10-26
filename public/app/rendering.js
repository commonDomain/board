import { canRenderPhoneItem } from './phone-view-model.js';
import { getViewportRect } from './viewport-rect.js';
import { deferBackgroundWork, registerBackgroundSuspender } from './background-work.js';
import { renderItemEditLock } from './element-lock-ui.js';
import { isStackIsolatedItem } from './stack-inspector.js';
import { scheduleItemStacking, flushItemStacking } from './stacking.js';

import { updateAmapMapChrome } from './amap-rendering-model.js';

import {
  MIN_ITEM_SIZE,
  MIN_ZOOM,
  TEXT_DECORATIVE_BORDER_STYLES
} from './constants.js';
import { els } from './elements.js';

import { normalizeTextBorderStyle } from './format-panel-model.js';
import { renderNotePaper } from './note-paper.js';

import { renderConnector, renderImage, renderInk } from './ink-rendering-model.js';
import { renderSticker } from './ink-rendering.js';
import { refreshIcons } from './interface-model.js';
import { destroyKdocsInstance, initializeKdocsEmbed, kdocsInstances, renderKdocsEmbed } from './kdocs.js';
import {
  applyLayerStyleToNode,
  canMutateItem,
  compareRenderItems,
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
import { fitNoteToContent } from './note-sizing-model.js';
import { fitTableToContent } from './table-rendering-model.js';
import { itemElementById, syncBoardEditingClass } from './item-elements-model.js';
import { updateViewportPerformance, getViewportWorkPolicy } from './canvas-performance.js';

import { cssEscape } from './utilities.js';
import { intersectsRect, pointHitsItemBounds, getPinnedRenderItems } from './rendering-model.js';
import { getCanvasRenderPolicy, releaseItemSurfaces } from './render-resources-model.js';
import { mountManagedImage, releaseManagedImages } from './image-rendering.js';

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
let selectionGeometryFrame = null;

function scheduleSelectionGeometry() {
  if (selectionGeometryFrame !== null) return;
  selectionGeometryFrame = requestAnimationFrame(() => {
    selectionGeometryFrame = null;
    if (state.selectedIds.size > 1) updateMultiSelectionFrame();
  });
}

registerBackgroundSuspender('canvas', () => {
  const interrupted = Boolean(cameraRefreshTimer || incrementalMountFrame);
  if (cameraRefreshTimer) cancelAnimationFrame(cameraRefreshTimer);
  cameraRefreshTimer = null;
  if (selectionGeometryFrame !== null) cancelAnimationFrame(selectionGeometryFrame);
  selectionGeometryFrame = null;
  cancelIncrementalMounts();
  if (interrupted) deferBackgroundWork('canvas', () => renderAll());
});

function releaseRenderSurfaces(node) {
  releaseManagedImages(node);
  if (getCanvasRenderPolicy().bounded) releaseItemSurfaces(node);
}

function renderAll(options = {}) {
  if (deferBackgroundWork('canvas', () => renderAll())) {
    // Spatial indexes are document state; keep them current even when DOM work
    // is postponed. The foreground render uses the latest model once.
    if (options.rebuildIndexes !== false) rebuildSpatialIndex();
    return;
  }
  cancelIncrementalMounts();
  renderSections();
  if (options.rebuildIndexes !== false) rebuildSpatialIndex();
  const visible = getVisibleWorldRect();
  const candidates = (
    state.exporting || !state.viewportVirtualizationEnabled
      ? Array.from(state.items.values())
      : queryItemsInRect(visible)
  ).filter(item => isItemVisible(item) && canRenderPhoneItem(item));
  const pinned = getPinnedRenderItems().filter(item => isItemVisible(item) && canRenderPhoneItem(item));
  updateViewportPerformance(candidates.filter(item => intersectsRect(item, visible)));
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
      const mounted = itemElementById(item.id);
      const shouldDefer =
        (getCanvasRenderPolicy().bounded || state.loadTier === 'large' || state.loadTier === 'extreme') &&
        !state.exporting &&
        !pinned.includes(item) &&
        !mounted;
      if (shouldDefer) deferredItems.push(item);
      else {
        // Full reconciliation must not replace an editor's DOM: its selection,
        // IME composition and not-yet-dispatched input belong to the live node.
        // Explicit editor completion renders the committed model separately.
        const editingHere = state.editingId === item.id || state.mindmapEditing?.itemId === item.id;
        const editingEnded = mounted?.classList.contains('editing') && !editingHere;
        const activeInput = mounted?.contains(document.activeElement) &&
          document.activeElement?.matches('input, textarea, [contenteditable="true"]');
        // A deferred reparent may already have ended this editor's model
        // session. Focus alone must not preserve its obsolete editable DOM.
        if (activeInput && !editingEnded || editingHere && mounted?.querySelector('[contenteditable="true"]')) {
          refreshItemPresentation(item, visible);
          window.ConnectorUI?.contentChanged(item.id);
        } else renderItemSafely(item);
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
  flushItemStacking();
  syncBoardEditingClass();
}

function getVisibleWorldRect(marginPixels = getCanvasRenderPolicy().renderMargin) {
  const rect = getViewportRect();
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
    if (!isStackIsolatedItem(item)) continue;
    if (!isItemVisible(item)) continue;
    if (options.includeLocked ? !isLayerVisible(item) : !canMutateItem(item)) {
      continue;
    }
    if (pointHitsItemBounds(item, point)) {
      if (!best || compareRenderItems(item, best) > 0) {
        best = item;
      }
    }
  }
  return best;
}

function refreshVisibleItems() {
  if (deferBackgroundWork('canvas', () => renderAll())) return;
  if (state.exporting) {
    return;
  }
  if (cameraRefreshTimer) {
    return;
  }
  cameraRefreshTimer = requestAnimationFrame(() => {
    cameraRefreshTimer = null;
    const policy = getCanvasRenderPolicy();
    const visible = getVisibleWorldRect(policy.renderMargin);
    const candidates = queryItemsInRect(visible).filter(
      item => isItemVisible(item) && canRenderPhoneItem(item) && intersectsRect(item, visible)
    );
    updateViewportPerformance(candidates);
    if (!state.viewportVirtualizationEnabled) return;
    const retain = getVisibleWorldRect(policy.retainMargin);
    const pinned = new Set(getPinnedRenderItems().map((item) => item.id));
    const mountedNodes = Array.from(els.itemsLayer.querySelectorAll('.board-item'));
    const mountedIds = new Set(mountedNodes.map(node => node.dataset.itemId));
    const unmountOffscreen = () => {
      for (const node of mountedNodes) {
        const id = node.dataset.itemId;
        const item = id ? state.items.get(id) : null;
        if (id && !pinned.has(id) && (!item || !canRenderPhoneItem(item) || (policy.bounded && !isItemVisible(item)) || !intersectsRect(item, retain))) {
          removeItemElement(id);
          mountedIds.delete(id);
        }
      }
    };
    // Phone allocation releases the old viewport first. Other devices retain
    // their existing reconciliation order and mount policy.
    if (policy.bounded) unmountOffscreen();
    const mountCandidates = candidates.filter(
      item => !mountedIds.has(item.id)
    );
    if (policy.bounded || state.loadTier === 'large' || state.loadTier === 'extreme') {
      scheduleIncrementalMounts(mountCandidates);
    } else {
      for (const item of mountCandidates) renderItemSafely(item);
    }
    if (!policy.bounded) unmountOffscreen();
  });
}

function renderItemSafely(item) {
  try {
    renderItem(item);
  } catch (error) {
    console.warn('[render] Item failed during render', item.type, item.id, error);
    state.renderErrorIds.add(item.id);
    if (getCanvasRenderPolicy().bounded) removeItemElement(item.id);
    else document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`)?.remove();
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
    const policy = getCanvasRenderPolicy();
    const visible = getVisibleWorldRect(policy.renderMargin);
    const pinned = new Set(getPinnedRenderItems().map((item) => item.id));
    let mounted = 0;
    const work = getViewportWorkPolicy();
    while (incrementalMountIndex < incrementalMountQueue.length && mounted < Math.min(policy.mountLimit, work.mountLimit) && performance.now() - startedAt < Math.min(policy.mountBudgetMs, work.mountBudgetMs)) {
      const queued = incrementalMountQueue[incrementalMountIndex++];
      const item = state.items.get(queued.id);
      if (!item || !canRenderPhoneItem(item) || (policy.bounded && !isItemVisible(item)) || (!pinned.has(item.id) && !intersectsRect(item, visible))) continue;
      if (!itemElementById(item.id)) renderItemSafely(item);
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
  if (deferBackgroundWork('canvas', () => renderAll())) return;
  if (!canRenderPhoneItem(item)) { removeItemElement(item.id); return; }
  window.ConnectorUI?.observe(item);
  state.renderErrorIds.delete(item.id);
  let node = itemElementById(item.id);
  const layerContainer = getLayerContainer(item.layerId || 'layer_default');
  if (!node) {
    node = document.createElement('div');
    node.className = 'board-item';
    node.dataset.itemId = item.id;
    layerContainer.appendChild(node);
  } else if (node.parentElement !== layerContainer) {
    layerContainer.appendChild(node);
  }
  // Retain passive SVG geometry and event targets. A connector move must not
  // tear down its DOM or run text-editor/selection UI work for every edge.
  const connectionSvg = item.type === 'connector' && node.querySelector('.connection-svg');
  if (connectionSvg && window.ConnectorUI) {
    const nextSvg = window.ConnectorUI.render(item, connectionSvg);
    if (nextSvg !== connectionSvg) connectionSvg.replaceWith(nextSvg);
    applyLayerStyleToNode(item, node);
    node.className = `board-item connector-item${state.selectedIds.has(item.id) ? ' selected' : ''}`;
    node.dataset.hidden = String(!isItemVisible(item));
    window.ConnectorImpact?.decorateNode(node, item);
    updateItemElementGeometry(item);
    renderItemEditLock(node);
    if (state.selectedIds.size > 1) scheduleSelectionGeometry();
    return;
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
  const wasEditing = node.classList.contains('editing');
  node.className = `board-item ${item.type}-item${selected ? ' selected' : ''}${editing ? ' editing' : ''}`;
  if (wasEditing !== editing) syncBoardEditingClass();
  window.ConnectorImpact?.decorateNode(node, item);
  node.style.left = `${item.x}px`;
  node.style.top = `${item.y}px`;
  node.style.width = `${Math.max(MIN_ITEM_SIZE, item.w || 120)}px`;
  node.style.height = `${Math.max(MIN_ITEM_SIZE, item.h || 80)}px`;
  node.style.setProperty('--rotation', `${item.rotation || 0}deg`);
  scheduleItemStacking(item, node);
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
    if (getCanvasRenderPolicy().bounded) destroySheetPreview(item.id);
    releaseRenderSurfaces(node);
    node.innerHTML = '';
  }

  try {
    if (item.type === 'planning') {
      node.appendChild(window.MusePlanning.mount(item, view => {
        const current = state.items.get(item.id);
        if (current) return import('./items.js').then(({ upsertItem }) => upsertItem({ ...current, planView: view }, { select: false }));
      }, {
        select: () => { if (!state.selectedIds.has(item.id)) selectItem(item.id); },
        move: event => { if (event.button !== 0 || state.spacePan) return false; if (canMutateItem(item)) { if (!state.selectedIds.has(item.id)) selectItem(item.id); return window.MusePlanning.moveCanvasComponent(event, item.id); } },
        remove: () => import('./items.js').then(({ deleteItems }) => { if (canMutateItem(state.items.get(item.id))) deleteItems([item.id]); }),
        writable: () => Boolean(state.items.has(item.id) && canMutateItem(state.items.get(item.id))),
        refreshConnections: () => window.ConnectorUI?.contentChanged(item.id)
      }));
    } else if (item.taskRef && window.MusePlanning?.enabled && state.editingId !== item.id) {
      node.appendChild(window.MusePlanning.renderLinked(item.taskRef, item.text));
    } else if (item.type === 'ink') {
      node.appendChild(renderInk(item));
    } else if (item.type === 'connector') {
      node.appendChild(renderConnector(item));
    } else if (item.type === 'image') {
      const image = renderImage(item);
      node.appendChild(image);
      mountManagedImage(item, image);
    } else if (item.type === 'kdocs' && !reuseKdocsFrame) {
      const card = renderKdocsEmbed(item);
      node.appendChild(card);
      initializeKdocsEmbed(item, card);
    } else if (item.type === 'sticker') {
      node.appendChild(renderSticker(item));
    } else if (item.type === 'shape') {
      node.appendChild(renderShape(item));
    } else if (item.type === 'text' || item.type === 'note') {
      const card = renderTextCard(item);
      node.appendChild(item.type === 'note' ? renderNotePaper(item, card) : card);
      fitNoteToContent(item, card);
      if (item.type === 'text' && TEXT_DECORATIVE_BORDER_STYLES.has(normalizeTextBorderStyle(item.textBorderStyle))) {
        node.appendChild(renderTextBorderDecoration(item));
      }
    } else if (item.type === 'table') {
      node.appendChild(renderTable(item));
      fitTableToContent(item, node);
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
    if (item.type !== 'connector') window.ConnectorUI?.contentChanged(item.id);
    if (item.type === 'kdocs') {
      requestAnimationFrame(() => kdocsInstances.get(item.id)?.forceIframeResize?.());
    }

    if (selected && state.selectedId === item.id) {
      attachSelectionFrame(node);
    }
    if (state.selectedIds.size > 1) {
      scheduleSelectionGeometry();
    }
    refreshIcons(node);
    renderItemEditLock(node);
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
    if (getCanvasRenderPolicy().bounded) destroySheetPreview(item.id);
    releaseRenderSurfaces(node);
    state.renderErrorIds.add(item.id);
    node.remove();
    renderItemFallback(item);
  }
}

function renderItemFallback(item) {
  if (deferBackgroundWork('canvas', () => renderAll())) return null;
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
    renderItemEditLock(node);
    layerContainer.appendChild(node);
    scheduleItemStacking(item, node);
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
  const node = itemElementById(id);
  releaseRenderSurfaces(node);
  const wasEditing = node?.classList.contains('editing');
  node?.remove();
  if (wasEditing) syncBoardEditingClass();
  if (node) window.ConnectorUI?.contentChanged(id);
  // Virtualization removes only the DOM surface. A deleted item has no model to
  // remount, so its store/listeners can be released as well.
  if (!state.items.has(id)) destroySheetRecord(id);
}

// Reparenting and translation change presentation, not a card's editable DOM.
function refreshItemPresentation(item, visible = null) {
  if (!item) return;
  if (deferBackgroundWork('canvas', () => renderAll())) { indexUpsertItem(item); return; }
  if (!isItemVisible(item) || !canRenderPhoneItem(item)) {
    indexUpsertItem(item);
    removeItemElement(item.id);
    return;
  }
  const node = itemElementById(item.id);
  if (!node) {
    indexUpsertItem(item);
    if (!state.viewportVirtualizationEnabled || intersectsRect(item, visible || getVisibleWorldRect())) renderItemSafely(item);
    return;
  }
  const editing = state.editingId === item.id || state.mindmapEditing?.itemId === item.id;
  // Reparenting can revoke editing through a locked container. Preserve a
  // live editor only while its model session is still active.
  if (node.classList.contains('editing') !== editing) { renderItemSafely(item); return; }
  const container = getLayerContainer(item.layerId || 'layer_default');
  if (node.parentElement !== container) {
    const focused = node.contains(document.activeElement) ? document.activeElement : null;
    const selection = focused && window.getSelection();
    const caret = selection && node.contains(selection.anchorNode) && node.contains(selection.focusNode)
      ? [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset] : null;
    if (typeof container.moveBefore === 'function') container.moveBefore(node, null);
    else container.appendChild(node);
    if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
    if (caret) selection.setBaseAndExtent(...caret);
  }
  applyLayerStyleToNode(item, node);
  const attributes = { hidden: String(!isItemVisible(item)), locked: String(!canMutateItem(item)),
    sectionCollapsed: String(Boolean(item.sectionId && state.sections.get(item.sectionId)?.collapsed)) };
  for (const [key, value] of Object.entries(attributes)) if (node.dataset[key] !== value) node.dataset[key] = value;
  updateItemElementGeometry(item);
  renderItemEditLock(node);
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
  refreshItemPresentation,
  removeItemElement
};

export { configureRendering };
