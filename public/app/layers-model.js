import { isPhoneViewer } from './phone-view-model.js';
import { numberOr } from './background-model.js';
import { SECTION_BACKDROPS, SECTION_FRAME_STYLES } from './constants.js';
import { isLocalEditingBlocked, isRemoteBoardLocked } from './connection-model.js';
import { state } from './state.js';
import { clamp } from './utilities.js';

function normalizeClientSection(input, fallbackOrder = 0) {
  return {
    id: String(input.id),
    ...(Number.isSafeInteger(input.mutationVersion) ? { mutationVersion: input.mutationVersion } : {}),
    name: String(input.name || `画框 ${fallbackOrder + 1}`).slice(0, 100),
    x: numberOr(input.x, 0),
    y: numberOr(input.y, 0),
    w: clamp(numberOr(input.w, 960), 80, 1000000),
    h: clamp(numberOr(input.h, 540), 60, 1000000),
    order: Math.max(0, Math.floor(numberOr(input.order, fallbackOrder))),
    navigatorOrder: Number.isFinite(Number(input.navigatorOrder)) ? Number(input.navigatorOrder) : fallbackOrder,
    collapsed: Boolean(input.collapsed),
    locked: Boolean(input.locked),
    lockChildren: Boolean(input.lockChildren),
    hidden: Boolean(input.hidden),
    style: {
      fill: String(input.style?.fill || '#ffffff').slice(0, 64),
      stroke: String(input.style?.stroke || '#94a3b8').slice(0, 64),
      titleColor: String(input.style?.titleColor || '#334155').slice(0, 64),
      ...(isSectionFrameStyle(input.style?.frame) ? { frame: input.style.frame } : {}),
      ...(isSectionBackdrop(input.style?.backdrop) ? { backdrop: input.style.backdrop } : {})
    }
  };
}

// The plain frame is stored as no `frame` field, so existing sections are unchanged.
function isSectionFrameStyle(value) {
  return value !== 'default' && SECTION_FRAME_STYLES.some((style) => style.id === value);
}

function isSectionBackdrop(value) {
  return value !== 'default' && SECTION_BACKDROPS.some((backdrop) => backdrop.id === value);
}

function normalizeClientGroup(input, fallbackOrder = 0) {
  return {
    id: String(input.id),
    ...(Number.isSafeInteger(input.mutationVersion) ? { mutationVersion: input.mutationVersion } : {}),
    name: String(input.name || '分组').slice(0, 100),
    parentGroupId: input.parentGroupId || null,
    sectionId: input.sectionId || null,
    navigatorOrder: Number.isFinite(Number(input.navigatorOrder)) ? Number(input.navigatorOrder) : fallbackOrder,
    locked: Boolean(input.locked),
    hidden: Boolean(input.hidden)
  };
}

function getLayer(layerId) {
  const id = layerId || state.activeLayerId;
  return state.layers.find((layer) => layer.id === id) || null;
}

function getLayerIndex(layerId) {
  return Math.max(
    0,
    state.layers.findIndex((layer) => layer.id === (layerId || state.activeLayerId))
  );
}

function isLayerLocked(item) {
  const layer = getLayer(item && (item.layerId || 'layer_default'));
  return !layer || layer.locked;
}

function isLayerVisible(item) {
  const layer = getLayer(item && (item.layerId || 'layer_default'));
  return Boolean(layer && layer.visible && layer.opacity > 0);
}

function canMutateItem(item, options) {
  if (isLocalEditingBlocked(options)) return false;
  if (isPhoneViewer()) return false;
  if (state.compatibilityReadOnly || isRemoteBoardLocked(item?.id)) return false;
  if (!item || item.hidden || !isLayerVisible(item) || isLayerLocked(item) || item.locked) return false;
  if (item.source?.provider === 'xmind') {
    if (String(item.source.connectedUserId || '') !== String(window.MuseAccount?.session?.user?.id || '')) return false;
  }
  const section = item.sectionId ? state.sections.get(item.sectionId) : null;
  if (section?.lockChildren) return false;
  let group = item.groupId ? state.groups.get(item.groupId) : null;
  const visited = new Set();
  while (group && !visited.has(group.id)) {
    if (group.locked) return false;
    visited.add(group.id);
    group = group.parentGroupId ? state.groups.get(group.parentGroupId) : null;
  }
  return true;
}

function getWritableLayer(layerId = state.activeLayerId, options) {
  if (isLocalEditingBlocked(options) || isRemoteBoardLocked()) return null;
  if (isPhoneViewer()) return null;
  if (state.compatibilityReadOnly) return null;
  const layer = getLayer(layerId);
  return layer && layer.visible && layer.opacity > 0 && !layer.locked ? layer : null;
}

function explainUnwritableLayer(layerId = state.activeLayerId) {
  if (state.draftStorageFailed || state.draftRestoreFailed || state.draftRestoring) return '正在保护和恢复本地草稿，恢复后会自动继续编辑';
  if (state.compatibilityReadOnly) return '连接数据需要更新版本，当前画布为只读；请刷新后重试';
  const layer = getLayer(layerId);
  if (!layer) return '图层不存在，请先选择可用图层';
  if (!layer.visible || layer.opacity <= 0) return '当前图层不可见，请先显示图层';
  if (layer.locked) return '当前图层已锁定，请先解锁';
  return '当前图层不可编辑';
}

function applyLayerStyleToNode(item, node) {
  if (!node) {
    return;
  }
  node.style.display = '';
  node.style.opacity = '';
  node.style.mixBlendMode = '';
  node.dataset.layerId = item.layerId || 'layer_default';
}

function sortedRenderItems() {
  return Array.from(state.items.values()).sort(compareRenderItems);
}

function compareRenderItems(a, b) {
  const layerA = getLayerIndex(a.layerId);
  const layerB = getLayerIndex(b.layerId);
  if (layerA !== layerB) return layerA - layerB;
  const rank = item => Number.isFinite(Number(item.z)) ? Number(item.z) : 1;
  return rank(a) - rank(b) || String(a.id).localeCompare(String(b.id));
}
export {
  normalizeClientSection,
  normalizeClientGroup,
  getLayer,
  getLayerIndex,
  isLayerLocked,
  isLayerVisible,
  canMutateItem,
  getWritableLayer,
  explainUnwritableLayer,
  applyLayerStyleToNode,
  compareRenderItems,
  sortedRenderItems
};
