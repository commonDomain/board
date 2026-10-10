import { state } from '../state.js';
import { canMutateItem } from '../layers-model.js';
import { snapshotItems } from '../history-controller-model.js';
import { pushUndoSnapshot } from '../history-controller.js';
import { makeId } from '../utilities.js';
import { nextZ } from '../canvas-state.js';
import { renderItem } from '../rendering.js';
import { enqueueOperation } from '../sync-queue.js';
import { markDirty } from '../save-status.js';
import { selectItem } from '../selection.js';
import { finishEditing } from '../editing.js';
import { showToast } from '../interface-model.js';
import { els } from '../elements.js';

import { boardRect, rootFor, textMap } from './binding.js';
import { schedule } from './controls.js';
import { cancel, finish } from './draft.js';
import { stateRuntime } from './runtime/state.js';
import { C, button } from './state.js';

function showCreate(item) {
  const panel = document.createElement('div');
  panel.className = 'connection-create connection-toolbar';
  panel.style.bottom = '110px';
  panel.style.top = 'auto';
  document.body.append(panel);
  const remove = () => panel.remove();
  button('＋ 便签', () => createAt(item, 'note', remove), panel);
  button('＋ 形状', () => createAt(item, 'shape', remove), panel);
  const source = state.items.get(item.source.binding?.id);
  if (source?.type === 'text') button('＋ 同类文本', () => createAt(item, 'text', remove), panel);
  button('关闭', remove, panel);
  setTimeout(remove, 8e3);
}

function createAt(connector, type, done) {
  if (!canMutateItem(connector)) return;
  const p = connector.target.fallback,
    before = snapshotItems();
  const item = {
    id: makeId(type),
    type,
    layerId: connector.layerId,
    sectionId: null,
    groupId: null,
    x: p.x + 24,
    y: p.y - 60,
    w: 190,
    h: 120,
    rotation: 0,
    z: nextZ(),
    text: '',
    color: state.color,
    shape: 'rect',
    stroke: '#475569',
    strokeWidth: 2,
    fill: '#ffffff'
  };
  const next = C.clone(connector);
  next.target = C.terminal({ binding: { kind: 'item', id: item.id }, fallback: p });
  C.apply(next);
  pushUndoSnapshot(before);
  state.items.set(item.id, item);
  state.items.set(next.id, next);
  renderItem(item);
  renderItem(next);
  enqueueOperation({
    kind: 'batch',
    ops: [
      { kind: 'upsert', item },
      { kind: 'upsert', item: next, connectorCapabilities: 1 }
    ]
  });
  markDirty(true);
  done();
  selectItem(item.id);
}

function captureTextSelection() {
  if (stateRuntime.composing) return;
  const s = getSelection();
  if (!s?.rangeCount || s.isCollapsed) {
    if (stateRuntime.selectionBar && !stateRuntime.targetTextMode && !stateRuntime.draft)
      stateRuntime.selectionBar.hidden = true;
    return;
  }
  const range = s.getRangeAt(0),
    a = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement,
    b = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  const boardItem = a.closest('.board-item');
  if (!boardItem || boardItem !== b.closest('.board-item')) return;
  const item = state.items.get(boardItem.dataset.itemId);
  if (!item) return;
  const node = a.closest('[data-mn-id]'),
    cell = a.closest('[data-row][data-column]');
  let scope = {};
  if (node) {
    if (node !== b.closest('[data-mn-id]')) return;
    scope.nodeId = node.dataset.mnId;
  } else if (cell) {
    if (cell !== b.closest('[data-row][data-column]')) return;
    C.ensureTableIds(item);
    scope = { rowId: item.rowIds[Number(cell.dataset.row)], columnId: item.columnIds[Number(cell.dataset.column)] };
  }
  const root = rootFor(item, scope);
  if (!root) return;
  const map = textMap(root),
    find = (container, offset) => {
      if (container.nodeType === 3) {
        const entry = map.entries.find((e) => e.node === container);
        return entry ? entry.start + offset : null;
      }
      const r = document.createRange();
      r.selectNodeContents(root);
      try {
        r.setEnd(container, offset);
      } catch {
        return null;
      }
      return r.toString().length;
    };
  const from = find(range.startContainer, range.startOffset),
    to = find(range.endContainer, range.endOffset);
  if (from === null || to === null || from === to) return;
  stateRuntime.selectedText = {
    itemId: item.id,
    scope,
    start: C.chars(map.value.slice(0, from)).length,
    end: C.chars(map.value.slice(0, to)).length,
    value: map.value
  };
  const rect = range.getBoundingClientRect();
  stateRuntime.selectionBar.hidden = false;
  stateRuntime.selectionBar.style.left = `${Math.max(8, Math.min(innerWidth - 270, rect.left))}px`;
  stateRuntime.selectionBar.style.top = `${Math.max(8, rect.top - 44)}px`;
  stateRuntime.selectionBar.replaceChildren();
  button(
    stateRuntime.targetTextMode ? '确认目标文字' : '连接选中文字',
    () => useTextSelection(),
    stateRuntime.selectionBar
  );
  if (stateRuntime.draft && !stateRuntime.targetTextMode)
    button('选择目标文字', enterTargetText, stateRuntime.selectionBar);
}

function useTextSelection() {
  if (!stateRuntime.selectedText) return;
  const saved = stateRuntime.selectedText;
  if (state.editingId) finishEditing();
  const item = state.items.get(saved.itemId),
    value = C.contentText(item, saved.scope);
  if (C.text(value) !== C.text(saved.value)) {
    showToast('内容已更新，请重新选择文字');
    return;
  }
  const locator = C.quoteRange(value, saved.start, saved.end, makeId('anchor'), item.contentVersion || 0, saved.scope),
    root = rootFor(item, locator),
    rect = root ? boardRect(root) : item;
  const t = C.terminal({
    binding: { kind: 'item', id: item.id, content: locator },
    fallback: { x: rect.x + rect.w, y: rect.y + rect.h / 2 }
  });
  if (stateRuntime.draft && stateRuntime.targetTextMode) {
    finish(stateRuntime.lastPointer, t);
    stateRuntime.selectionBar.hidden = true;
    return;
  }
  cancel();
  stateRuntime.draft = {
    source: t,
    target: C.terminal({ fallback: t.fallback }),
    pointerId: null,
    dragging: false,
    layerId: state.activeLayerId
  };
  state.connectorDraft = stateRuntime.draft;
  state.tool = 'connector';
  stateRuntime.targetTextMode = false;
  stateRuntime.selectionBar.hidden = false;
  stateRuntime.selectionBar.replaceChildren();
  button('选择目标文字', enterTargetText, stateRuntime.selectionBar);
  button('取消连接', cancel, stateRuntime.selectionBar);
  schedule();
}

function enterTargetText() {
  stateRuntime.targetTextMode = true;
  state.tool = 'select';
  state.connectorDraft = null;
  els.viewport.dataset.tool = 'select';
  showToast('双击进入目标文字编辑，选择文字后确认');
}

export { captureTextSelection, createAt, enterTargetText, showCreate, useTextSelection };
