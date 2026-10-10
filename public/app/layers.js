import { pushUndoSnapshot, snapshotDocument } from './history-controller.js';
import { cancelConnectorDraft } from './drawing-model.js';
import { els } from './elements.js';
import { cancelActiveGesture } from './gestures.js';
import { refreshIcons, showToast } from './interface-model.js';
import { renderAll, renderItem } from './rendering.js';
import { markDirty } from './save-status.js';
import { getSelectedIds } from './selection-model.js';
import { updateSelectionUI } from './selection.js';
import { state } from './state.js';
import { enqueueOperation } from './sync-queue.js';
import { cssEscape, isImeEvent, makeId } from './utilities.js';
import { getLayer, getLayerIndex, canMutateItem } from './layers-model.js';
import { normalizeClientLayers } from './layer-visibility.js';
import { setControlAvailability } from './ui-feedback.js';

function ensureLayerContainers(options = {}) {
  const existing = new Map(
    Array.from(els.itemsLayer.querySelectorAll(':scope > .board-layer')).map((node) => [node.dataset.layerId, node])
  );
  state.layers.forEach((layer, index) => {
    let container = existing.get(layer.id);
    if (!container) {
      container = document.createElement('div');
      container.className = 'board-layer';
      container.dataset.layerId = layer.id;
      els.itemsLayer.appendChild(container);
    }
    container.hidden = !layer.visible;
    container.style.opacity = String(layer.opacity);
    container.style.mixBlendMode = layer.blendMode === 'normal' ? 'normal' : layer.blendMode;
    container.style.pointerEvents = layer.locked || layer.opacity <= 0 || !layer.visible ? 'none' : 'auto';
    container.style.zIndex = String(index + 1);
    container.dataset.locked = String(layer.locked);
    existing.delete(layer.id);
  });
  if (options.prune !== false) {
    for (const stale of existing.values()) {
      stale.remove();
    }
  }
}

function getLayerContainer(layerId) {
  const safeId = state.layers.some((layer) => layer.id === layerId) ? layerId : state.layers[0]?.id;
  if (!safeId) {
    return els.itemsLayer;
  }
  let container = els.itemsLayer.querySelector(`:scope > .board-layer[data-layer-id="${cssEscape(safeId)}"]`);
  if (!container) {
    ensureLayerContainers();
    container = els.itemsLayer.querySelector(`:scope > .board-layer[data-layer-id="${cssEscape(safeId)}"]`);
  }
  return container || els.itemsLayer;
}

function broadcastLayers() {
  enqueueOperation({
    kind: 'layers',
    layers: JSON.parse(JSON.stringify(state.layers))
  });
  markDirty(true);
}

function applyLayersChange() {
  state.layers = normalizeClientLayers(state.layers);
  if (!state.layers.some((layer) => layer.id === state.activeLayerId)) {
    state.activeLayerId = state.layers[state.layers.length - 1].id;
  }
  const fallbackLayerId = state.layers[0].id;
  for (const item of state.items.values()) {
    if (!state.layers.some((layer) => layer.id === (item.layerId || 'layer_default'))) {
      item.layerId = fallbackLayerId;
    }
  }
  reconcileLayerInteractionState();
  renderAll();
  renderLayerMenu();
  broadcastLayers();
}

function reconcileLayerInteractionState() {
  const sessionLayerId = state.currentPath?.layerId || state.currentShape?.layerId;
  const sessionLayer = sessionLayerId ? getLayer(sessionLayerId) : null;
  const interactionItem = state.interaction && state.items.get(state.interaction.id);
  const pendingMoveItem = state.pendingMove?.itemElement
    ? state.items.get(state.pendingMove.itemElement.dataset.itemId)
    : null;
  const interactionSection = state.sectionInteraction ? state.sections.get(state.sectionInteraction.sectionId) : null;
  const hasWritableLayer = state.layers.some((layer) => layer.visible && layer.opacity > 0 && !layer.locked);
  if (
    (sessionLayerId && (!sessionLayer || sessionLayer.locked || !sessionLayer.visible || sessionLayer.opacity <= 0)) ||
    (interactionItem && !canMutateItem(interactionItem)) ||
    (pendingMoveItem && !canMutateItem(pendingMoveItem)) ||
    (state.sectionInteraction && (!interactionSection || interactionSection.locked || interactionSection.hidden)) ||
    ((state.eraserPath || state.smudgePath) && !hasWritableLayer)
  ) {
    cancelActiveGesture();
  }
  const connectorLayer = state.connectorDraft?.layerId ? getLayer(state.connectorDraft.layerId) : null;
  if (
    state.connectorDraft &&
    (!connectorLayer || connectorLayer.locked || !connectorLayer.visible || connectorLayer.opacity <= 0)
  ) {
    cancelConnectorDraft();
  }
  if (state.editingId && !canMutateItem(state.items.get(state.editingId))) {
    state.editingId = null;
    state.editSnapshot = null;
    state.editingCreatedId = null;
    state.editingUndoDepth = null;
    state.editingHistoryInput = null;
    state.draftEditableId = null;
  }
  if (state.mindmapEditing && !canMutateItem(state.items.get(state.mindmapEditing.itemId))) {
    state.mindmapEditing = null;
  }
  state.selectedIds = new Set(Array.from(state.selectedIds).filter((id) => canMutateItem(state.items.get(id))));
  state.selectedId = state.selectedIds.has(state.selectedId)
    ? state.selectedId
    : Array.from(state.selectedIds)[0] || null;
  if (state.mindmapSelection && !canMutateItem(state.items.get(state.mindmapSelection.itemId))) {
    state.mindmapSelection = null;
  }
}

function buildLayerMenu() {
  if (!els.layerMenu) {
    return;
  }
  els.layerMenu.textContent = '';
  const list = document.createElement('div');
  list.className = 'layer-list';
  const controls = document.createElement('div');
  controls.className = 'layer-controls';
  const makeControl = (action, label, iconName) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-btn';
    button.dataset.layerControl = action;
    const icon = document.createElement('i');
    icon.dataset.lucide = iconName;
    const text = document.createElement('span');
    text.textContent = label;
    button.append(icon, text);
    return button;
  };
  controls.append(
    makeControl('add', '新建', 'plus'),
    makeControl('up', '上移', 'arrow-up'),
    makeControl('down', '下移', 'arrow-down'),
    makeControl('delete', '删除', 'trash-2')
  );
  controls.addEventListener('click', (event) => {
    const button = event.target.closest('[data-layer-control]');
    if (!button) {
      return;
    }
    const action = button.dataset.layerControl;
    if (action === 'add') {
      pushUndoSnapshot();
      state.layers.push({
        id: makeId('layer'),
        name: `图层 ${state.layers.length + 1}`,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'normal'
      });
      state.activeLayerId = state.layers[state.layers.length - 1].id;
      applyLayersChange();
    } else if (action === 'up' || action === 'down') {
      const index = getLayerIndex(state.activeLayerId);
      const target = action === 'up' ? index + 1 : index - 1;
      if (target < 0 || target >= state.layers.length) {
        return;
      }
      pushUndoSnapshot();
      const [layer] = state.layers.splice(index, 1);
      state.layers.splice(target, 0, layer);
      applyLayersChange();
    } else if (action === 'delete') {
      const index = getLayerIndex(state.activeLayerId);
      const removed = state.layers[index];
      if (!removed) {
        return;
      }
      if (state.layers.length <= 1) {
        showToast('至少保留一个图层');
        return;
      }
      if (removed.locked) {
        showToast('请先解锁图层再删除');
        return;
      }
      pushUndoSnapshot();
      state.layers.splice(index, 1);
      const fallback = state.layers[0];
      for (const item of state.items.values()) {
        if ((item.layerId || 'layer_default') === removed.id) {
          item.layerId = fallback.id;
        }
      }
      if (state.activeLayerId === removed.id) {
        state.activeLayerId = fallback.id;
      }
      applyLayersChange();
    }
  });
  els.layerMenu.append(list, controls);
  refreshIcons(els.layerMenu);
}

function syncLayerControls() {
  const activeLayer=getLayer(state.activeLayerId),activeIndex=getLayerIndex(state.activeLayerId);
  for(const control of els.layerMenu.querySelectorAll('[data-layer-control]')){
    const action=control.dataset.layerControl;
    const reason=state.compatibilityReadOnly?'当前画板只读':action==='up'&&activeIndex>=state.layers.length-1?'已经是最上层':action==='down'&&activeIndex===0?'已经是最下层':action==='delete'&&state.layers.length===1?'请至少保留一个图层':action==='delete'&&activeLayer?.locked?'请先解锁图层再删除':'';
    setControlAvailability(control,Boolean(reason),reason);
  }
}

function renderLayerMenu() {
  const list = els.layerMenu?.querySelector('.layer-list');
  if (!list) return;
  list.textContent = '';
  syncLayerControls();
  [...state.layers].reverse().forEach((layer) => {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.classList.toggle('active', layer.id === state.activeLayerId);
    row.dataset.layerId = layer.id;
    const activateLayer = () => {
      state.activeLayerId = layer.id;
      list.querySelectorAll('.layer-row').forEach((candidate) => {
        candidate.classList.toggle('active', candidate === row);
      });
      syncLayerControls();
    };

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'layer-eye';
    eye.title = `${layer.visible ? '隐藏' : '显示'}图层：${layer.name}`;
    eye.setAttribute('aria-label', eye.title);
    const eyeIcon = document.createElement('i');
    eyeIcon.dataset.lucide = layer.visible ? 'eye' : 'eye-off';
    eye.appendChild(eyeIcon);
    eye.addEventListener('click', (event) => {
      event.stopPropagation();
      activateLayer();
      pushUndoSnapshot();
      layer.visible = !layer.visible;
      applyLayersChange();
    });

    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'layer-lock';
    lock.title = `${layer.locked ? '解锁' : '锁定'}图层：${layer.name}`;
    lock.setAttribute('aria-label', lock.title);
    const lockIcon = document.createElement('i');
    lockIcon.dataset.lucide = layer.locked ? 'lock' : 'unlock';
    lock.appendChild(lockIcon);
    lock.classList.toggle('locked', layer.locked);
    lock.setAttribute('aria-pressed',String(layer.locked));
    row.setAttribute('aria-label',`${layer.name}${layer.locked?' · 已锁定':''}${!layer.visible?' · 已隐藏':''}`);
    lock.addEventListener('click', (event) => {
      event.stopPropagation();
      activateLayer();
      pushUndoSnapshot();
      layer.locked = !layer.locked;
      applyLayersChange();
    });

    const name = document.createElement('input');
    name.className = 'layer-name';
    name.value = layer.name;
    name.title = '点击重命名';
    name.setAttribute('aria-label', `图层名称：${layer.name}`);
    name.readOnly = true;
    if(layer.locked){name.setAttribute('aria-description','图层已锁定，内容暂不可编辑');name.title=`${layer.name} · 已锁定`;}
    let originalName = layer.name;
    const finishRename = (commit) => {
      if (name.readOnly) {
        return;
      }
      name.readOnly = true;
      const nextName = commit ? name.value.trim().slice(0, 64) || `图层 ${getLayerIndex(layer.id) + 1}` : originalName;
      name.value = nextName;
      if (commit && nextName !== layer.name) {
        pushUndoSnapshot();
        layer.name = nextName;
        applyLayersChange();
      }
    };
    name.addEventListener('click', (event) => {
      event.stopPropagation();
      activateLayer();
      if (name.readOnly) {
        originalName = layer.name;
        name.readOnly = false;
        name.focus({ preventScroll: true });
        name.select();
      }
    });
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finishRename(true);
        name.blur();
      } else if (event.key === 'Escape' && !isImeEvent(event)) {
        event.preventDefault();
        finishRename(false);
        name.blur();
      }
    });
    name.addEventListener('blur', () => finishRename(true));

    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.min = '0';
    opacity.max = '100';
    opacity.value = String(Math.round(layer.opacity * 100));
    opacity.title = `图层不透明度：${layer.name}`;
    opacity.setAttribute('aria-label', opacity.title);
    let opacityHistory = null;
    const captureOpacityHistory = () => {
      opacityHistory ||= snapshotDocument();
    };
    opacity.addEventListener('pointerdown', () => {
      activateLayer();
      captureOpacityHistory();
    });
    opacity.addEventListener('keydown', captureOpacityHistory);
    opacity.addEventListener('click', (event) => event.stopPropagation());
    opacity.addEventListener('input', (event) => {
      layer.opacity = Number(event.target.value) / 100;
      ensureLayerContainers();
    });
    opacity.addEventListener('change', () => {
      if (opacityHistory) {
        pushUndoSnapshot(opacityHistory);
      }
      opacityHistory = null;
      applyLayersChange();
    });

    const blend = document.createElement('select');
    blend.className = 'layer-blend';
    blend.setAttribute('aria-label', `图层混合模式：${layer.name}`);
    const blendNames = {
      normal: '正常',
      multiply: '正片叠底',
      screen: '滤色',
      overlay: '叠加',
      darken: '变暗',
      lighten: '变亮',
      'color-dodge': '颜色减淡',
      'color-burn': '颜色加深',
      'hard-light': '强光',
      'soft-light': '柔光'
    };
    [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light'
    ].forEach((mode) => {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = blendNames[mode] || mode;
      if (mode === layer.blendMode) {
        option.selected = true;
      }
      blend.appendChild(option);
    });
    blend.addEventListener('pointerdown', activateLayer);
    blend.addEventListener('click', (event) => event.stopPropagation());
    blend.addEventListener('change', () => {
      pushUndoSnapshot();
      layer.blendMode = blend.value;
      applyLayersChange();
    });

    row.append(eye, lock, name, opacity, blend);
    row.addEventListener('click', () => {
      activateLayer();
    });
    list.appendChild(row);
  });
  refreshIcons(els.layerMenu);
}

function moveLayerPrimary(direction) {
  moveSelectionZ(direction > 0 ? 'up' : 'down');
}

function moveSelectionZ(action) {
  const selected = new Set(getSelectedIds().filter((id) => canMutateItem(state.items.get(id))));
  if (!selected.size || !['up', 'down', 'top', 'bottom'].includes(action)) return;

  const layerIds = new Set(Array.from(selected, (id) => state.items.get(id)?.layerId).filter(Boolean));
  const updated = new Map();
  for (const layerId of layerIds) {
    const ordered = Array.from(state.items.values())
      .filter((item) => item.layerId === layerId)
      .sort((a, b) => Number(a.z || 0) - Number(b.z || 0) || a.id.localeCompare(b.id));
    const original = ordered.map((item) => item.id).join('\u0000');
    let next = ordered.slice();
    if (action === 'top' || action === 'bottom') {
      const chosen = next.filter((item) => selected.has(item.id));
      const rest = next.filter((item) => !selected.has(item.id));
      next = action === 'top' ? [...rest, ...chosen] : [...chosen, ...rest];
    } else if (action === 'up') {
      for (let index = next.length - 2; index >= 0; index -= 1) {
        if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
        }
      }
    } else {
      for (let index = 1; index < next.length; index += 1) {
        if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
          [next[index], next[index - 1]] = [next[index - 1], next[index]];
        }
      }
    }
    if (original === next.map((item) => item.id).join('\u0000')) continue;
    next.forEach((item, index) => {
      if (Number(item.z) !== index + 1) {
        item.z = index + 1;
        updated.set(item.id, item);
      }
    });
  }
  if (!updated.size) return;
  pushUndoSnapshot();
  for (const item of updated.values()) {
    state.items.set(item.id, item);
    renderItem(item);
  }
  enqueueOperation({ kind: 'batch', ops: Array.from(updated.values(), (item) => ({ kind: 'upsert', item })) });
  markDirty(true);
  updateSelectionUI();
}

function moveLayer(id, direction) {
  const item = state.items.get(id);
  if (!canMutateItem(item)) {
    return;
  }
  const sorted = Array.from(state.items.values())
    .filter((candidate) => candidate.layerId === item.layerId)
    .sort((a, b) => (a.z || 1) - (b.z || 1));
  const index = sorted.findIndex((candidate) => candidate.id === id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
    return;
  }
  const other = sorted[targetIndex];
  pushUndoSnapshot();
  const previousZ = item.z;
  item.z = other.z;
  other.z = previousZ;
  state.items.set(id, item);
  state.items.set(other.id, other);
  renderItem(item);
  renderItem(other);
  enqueueOperation({
    kind: 'batch',
    ops: [
      { kind: 'upsert', item },
      { kind: 'upsert', item: other }
    ]
  });
  markDirty(true);
}
export {
  ensureLayerContainers,
  getLayerContainer,
  broadcastLayers,
  applyLayersChange,
  reconcileLayerInteractionState,
  buildLayerMenu,
  renderLayerMenu,
  moveLayerPrimary,
  moveSelectionZ,
  moveLayer
};
