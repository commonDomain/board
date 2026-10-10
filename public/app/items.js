

import { DEFAULT_NOTE_APPEARANCE, DEFAULT_TEXT_BORDER_COLOR, DEFAULT_TEXT_FILL, MAX_IMAGE_SIDE } from './constants.js';
import { startEditingItem } from './editing.js';

import { connectorEndpoints } from './ink-rendering-model.js';
import { showToast } from './interface-model.js';
import { canMutateItem, explainUnwritableLayer, getWritableLayer } from './layers-model.js';
import { normalizeClipboardTableRows } from './paste-model.js';

import { findSectionForItem } from './sections.js';

import { state } from './state.js';
import { brainConnectorIds } from './planning-source-links.js';

import { getTableColumnWidths, getTableHeightForRows, getTableRowHeights } from './table-rendering-model.js';
import { getSticker } from './toolbar-model.js';

import { clamp, cssEscape, makeId } from './utilities.js';
import { nextZ } from './canvas-state.js';
import { xmindContentFingerprint } from './xmind-connection-model.js';

let pushUndoSnapshot,
  isGuestMode,
  focusNavigatorTarget,
  getViewportDropPoint,
  ensureReadableToolZoom,
  removeItemElement,
  renderItem,
  markDirty,
  selectItem,
  updateSelectionUI,
  indexRemoveItem,
  indexUpsertItem,
  enqueueOperation,
  restoreNavigationTool,
  scheduleXmindAutoSync;

function configureItems(callbacks) {
  ({
    pushUndoSnapshot,
    isGuestMode,
    focusNavigatorTarget,
    getViewportDropPoint,
    ensureReadableToolZoom,
    removeItemElement,
    renderItem,
    markDirty,
    selectItem,
    updateSelectionUI,
    indexRemoveItem,
    indexUpsertItem,
    enqueueOperation,
    restoreNavigationTool,
    scheduleXmindAutoSync
  } = callbacks);
}

function addTextLikeItem(type, point, text) {
  const item = {
    id: makeId(type),
    type,
    x: point.x,
    y: point.y,
    w: type === 'note' ? 190 : 240,
    h: type === 'note' ? 150 : 96,
    rotation: 0,
    z: nextZ(),
    text,
    color: state.color,
    fontSize: type === 'note' ? 16 : state.fontSize,
    fontFamily: state.fontFamily,
    bold: state.bold,
    align: state.align
  };
  if (type === 'text') {
    item.textFill = DEFAULT_TEXT_FILL;
    item.textBorderColor = DEFAULT_TEXT_BORDER_COLOR;
    item.textBorderStyle = 'solid';
  }
  if (type === 'note') {
    Object.assign(item, DEFAULT_NOTE_APPEARANCE);
  }
  return upsertItem(item);
}

function addTableItem(point, rows, header = true, options = {}) {
  rows = normalizeClipboardTableRows(rows);
  if (!rows.length) {
    return null;
  }
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => Array.from({ length: columns }, (_, index) => row[index] || ''));
  const tableWidth = clamp(columns * 110, 220, 2400);
  const item = {
    id: makeId('table'),
    type: 'table',
    x: point.x,
    y: point.y,
    w: tableWidth,
    h: getTableHeightForRows(normalizedRows),
    rotation: 0,
    z: nextZ(),
    header,
    color: state.color,
    rows: normalizedRows,
    columnWidths: getTableColumnWidths({ w: tableWidth }, columns),
    rowHeights: getTableRowHeights({ h: getTableHeightForRows(normalizedRows) }, normalizedRows.length)
  };
  if (!upsertItem(item, { select: options.select !== false })) {
    return null;
  }
  if (options.autoEdit || state.tool === 'table') {
    selectItem(item.id);
    startEditingItem(item.id, { isNew: false, focusTable: true });
  }
  return item;
}

function addAmapItem(type, point) {
  if (isGuestMode() || !state.amapCapabilities?.enabled) {
    showToast(isGuestMode() ? '登录后才能使用导航工具' : '导航服务尚未启用');
    return false;
  }
  const existing = Array.from(state.items.values()).find((item) => item.type === type);
  if (existing) {
    selectItem(existing.id);
    focusNavigatorTarget(existing);
    showToast('当前画布已经有这个导航组件');
    return false;
  }
  const base = {
    id: makeId(type.replace('amap-', 'amap_')),
    type,
    x: point.x,
    y: point.y,
    rotation: 0,
    z: nextZ()
  };
  if (type === 'amap-map') {
    Object.assign(base, {
      w: 640,
      h: 420,
      center: { lng: 116.397428, lat: 39.90923 },
      zoom: 11,
      viewMode: '2D',
      pitch: 0,
      heading: 0,
      place: null
    });
  } else if (type === 'amap-search') {
    Object.assign(base, { w: 380, h: 420, query: '', results: [], selectedPoi: null });
  } else {
    Object.assign(base, {
      w: 430,
      h: 500,
      mode: 'driving',
      origin: null,
      destination: null,
      routes: [],
      selectedRouteId: ''
    });
  }
  return upsertItem(base, { select: true });
}

function addImageItem(point, asset, width, height) {
  const src = typeof asset === 'string' ? asset : asset?.url;
  const naturalWidth = Number(asset?.width) || width;
  const naturalHeight = Number(asset?.height) || height;
  const displaySize = getImageDisplaySize(width, height);
  return upsertItem({
    id: makeId('image'),
    type: 'image',
    x: point.x,
    y: point.y,
    w: displaySize.w,
    h: displaySize.h,
    rotation: 0,
    z: nextZ(),
    src,
    ...(asset?.assetId ? { assetId: asset.assetId, naturalWidth, naturalHeight } : {})
  });
}

function getImageDisplaySize(width, height) {
  const ratio = width && height ? width / height : 1.33;
  let w = width || 320;
  let h = height || 240;
  if (w > MAX_IMAGE_SIDE) {
    w = MAX_IMAGE_SIDE;
    h = w / ratio;
  }
  if (h > MAX_IMAGE_SIDE) {
    h = MAX_IMAGE_SIDE;
    w = h * ratio;
  }
  return { w, h };
}

function addStickerItem(icon) {
  if (!getSticker(icon)) {
    showToast('贴纸数据无效');
    return false;
  }
  ensureReadableToolZoom('sticker');
  const point = getViewportDropPoint(80, 80, true);
  const inserted = upsertItem({
    id: makeId('sticker'),
    type: 'sticker',
    icon,
    x: point.x,
    y: point.y,
    w: 80,
    h: 80,
    rotation: 0,
    z: nextZ(),
    color: state.color
  });
  if (inserted) {
    restoreNavigationTool();
  }
  return inserted;
}

function upsertItem(item, options = {}) {
  const existing = state.items.get(item?.id);
  const layerId = item?.layerId || existing?.layerId || state.activeLayerId;
  if (!item || !item.id || !getWritableLayer(layerId) || (existing && !canMutateItem(existing))) {
    showToast(explainUnwritableLayer(layerId));
    return false;
  }
  if (options.history !== false) {
    pushUndoSnapshot(options.historySnapshot);
  }
  item.layerId = layerId;
  if (!Object.hasOwn(item, 'sectionId')) item.sectionId = existing?.sectionId || findSectionForItem(item)?.id || null;
  if (!Object.hasOwn(item, 'groupId')) item.groupId = existing?.groupId || null;
  if (!Object.hasOwn(item, 'locked')) item.locked = Boolean(existing?.locked);
  if (!Object.hasOwn(item, 'hidden')) item.hidden = Boolean(existing?.hidden);
  state.items.set(item.id, item);
  state.zCounter = Math.max(state.zCounter, Number(item.z || 1) + 1);
  indexUpsertItem(item);
  if (options.rerender !== false) {
    renderItem(item);
    if (options.select === true) {
      selectItem(item.id);
    } else if (state.selectedId === item.id) {
      selectItem(null);
    }
  }
  broadcastUpsert(item);
  markDirty(true);
  return true;
}

function broadcastUpsert(item) {
  if (item?.source?.provider === 'xmind') {
    const currentFingerprint = xmindContentFingerprint(item);
    const previousFingerprint = state.xmindSyncFingerprints.get(item.id);
    if (state.xmindCleanBroadcastIds.has(item.id)) {
      state.xmindCleanBroadcastIds.delete(item.id);
      state.xmindSyncFingerprints.set(item.id, currentFingerprint);
    } else if (!previousFingerprint) {
      state.xmindSyncFingerprints.set(item.id, currentFingerprint);
    } else if (
      currentFingerprint !== previousFingerprint &&
      item.source.connectedUserId === window.MuseAccount?.session?.user?.id
    ) {
      item.source.syncState = 'pending';
      state.xmindAutoSyncFailures.delete(item.id);
      const card = document.querySelector(`.mindmap-card[data-item-id="${cssEscape(item.id)}"]`);
      if (card) card.dataset.syncState = 'pending';
      const badge = card?.querySelector('.mindmap-source-badge');
      if (badge) {
        badge.hidden = false;
        badge.disabled = false;
        badge.title = '确认并同步到 XMind';
      }
    }
  }
  enqueueOperation({ kind: 'upsert', item });
  if (item?.source?.syncState === 'pending') scheduleXmindAutoSync();
}

function deleteItems(ids) {
  const existingIds = ids.filter((id) => canMutateItem(state.items.get(id)));
  if (!existingIds.length) {
    return;
  }
  const lines = brainConnectorIds([...state.items.values()], existingIds);
  if (lines.some(id => !canMutateItem(state.items.get(id)))) { showToast('关联连接线已锁定，请先解锁再删除脑图'); return; }
  existingIds.push(...lines.filter(id => !existingIds.includes(id)));
  pushUndoSnapshot();
  detachConnectorsFor(existingIds);
  for (const id of existingIds) {
    state.items.delete(id);
    state.xmindSyncFingerprints.delete(id);
    state.xmindRemoteAlerts.delete(id);
    indexRemoveItem(id);
    removeItemElement(id);
  }
  let selectionChanged = false;
  for (const id of existingIds) {
    if (state.selectedIds.delete(id)) {
      selectionChanged = true;
    }
  }
  if (selectionChanged) {
    if (!state.selectedIds.size) {
      state.selectedId = null;
    } else if (!state.selectedIds.has(state.selectedId)) {
      state.selectedId = Array.from(state.selectedIds)[0];
    }
    updateSelectionUI();
  }
  enqueueOperation({ kind: 'delete', ids: existingIds });
  window.MusePlanning?.notify();
  markDirty(true);
}

function detachConnectorsFor(ids) {
  if (window.ConnectorCore) {
    for (const id of ids) {
      const before = state.items.get(id);
      if (before)
        for (const connector of window.ConnectorCore.reconcile(state.items.values(), before, null))
          renderItem(connector);
    }
    return;
  }
  const removed = new Set(ids);
  for (const connector of state.items.values()) {
    if (connector.type !== 'connector' || removed.has(connector.id)) {
      continue;
    }
    const endpoints = connectorEndpoints(connector);
    let changed = false;
    if (connector.startId && removed.has(connector.startId)) {
      connector.startId = null;
      connector.startX = endpoints.start.x;
      connector.startY = endpoints.start.y;
      changed = true;
    }
    if (connector.endId && removed.has(connector.endId)) {
      connector.endId = null;
      connector.endX = endpoints.end.x;
      connector.endY = endpoints.end.y;
      changed = true;
    }
    if (changed) {
      state.items.set(connector.id, connector);
      renderItem(connector);
    }
  }
}

function bringToFront(id) {
  const item = state.items.get(id);
  if (!canMutateItem(item)) {
    return;
  }
  const siblings = Array.from(state.items.values()).filter((other) => other.layerId === item.layerId);
  const nextZValue = Math.max(0, ...siblings.map((other) => Number(other.z || 0))) + 1;
  if (Number(item.z || 0) >= nextZValue - 1) {
    return;
  }
  pushUndoSnapshot();
  item.z = nextZValue;
  state.items.set(id, item);
  renderItem(item);
  broadcastUpsert(item);
  markDirty(true);
}

function sendToBack(id) {
  const item = state.items.get(id);
  if (!canMutateItem(item)) {
    return;
  }
  const siblings = Array.from(state.items.values()).filter((other) => other.layerId === item.layerId);
  const minZ = Math.min(...siblings.map((other) => Number(other.z || 1)));
  if (Number(item.z || 1) <= minZ) {
    return;
  }
  pushUndoSnapshot();
  item.z = minZ - 1;
  state.items.set(id, item);
  renderItem(item);
  broadcastUpsert(item);
  markDirty(true);
}

export {
  addAmapItem,
  addImageItem,
  addStickerItem,
  addTableItem,
  addTextLikeItem,
  bringToFront,
  broadcastUpsert,
  deleteItems,
  detachConnectorsFor,
  getImageDisplaySize,
  sendToBack,
  upsertItem
};

export { configureItems };
