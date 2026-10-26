import { state } from '../state.js';
import { getBoardPoint } from '../camera.js';
import { DEFAULT_NOTE_WIDTH, DEFAULT_NOTE_HEIGHT } from '../note-sizing-model.js';
import { canMutateItem } from '../layers-model.js';
import { snapshotItems } from '../history-controller-model.js';
import { pushUndoSnapshot } from '../history-controller.js';
import { makeId } from '../utilities.js';
import { nextZ } from '../canvas-state.js';
import { renderItem, getVisibleWorldRect } from '../rendering.js';
import { queryItemsInRect } from '../spatial-index-model.js';
import { mounted } from './state.js';
import { enqueueOperation } from '../sync-queue.js';
import { markDirty } from '../save-status.js';
import { selectItem } from '../selection.js';
import { finishEditing } from '../editing.js';
import { showToast } from '../interface-model.js';
import { els } from '../elements.js';

import { boardRect, rootFor, textMap, resolve } from './binding.js';
import { schedule } from './controls.js';
import { cancel, finish } from './draft.js';
import { stateRuntime } from './runtime/state.js';
import { C, button } from './state.js';
import { placeTextConnectionToolbar } from './text-toolbar-placement-model.js';

let selectionFrame = null;

function scheduleTextSelection() {
  if (selectionFrame !== null) return;
  selectionFrame = requestAnimationFrame(() => { selectionFrame = null; captureTextSelection(); });
}

function positionTextSelectionBar(range, boardItem) {
  const bar = stateRuntime.selectionBar;
  const selection = range.getBoundingClientRect(), owner = boardItem.getBoundingClientRect();
  const viewport = els.viewport.getBoundingClientRect();
  const obstacles = [];
  const nodes = queryItemsInRect(getVisibleWorldRect(0)).filter(item => item.type !== 'connector').map(item => mounted(item.id)).filter(Boolean);
  nodes.push(...document.querySelectorAll('.floating-format-bar:not([hidden]),.tool-dock,.document-bar,.connection-toolbar:not([hidden])'));
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (r.width && r.height && r.right > viewport.left && r.left < viewport.right && r.bottom > viewport.top && r.top < viewport.bottom) obstacles.push(r);
    // Formatting controls animate toward their committed position. Avoid both
    // the visible rectangle and the destination rather than chasing animation.
    if (node === els.floatingFormatBar && node.dataset.positionX !== undefined && node.dataset.positionY !== undefined) {
      const left = Number(node.dataset.positionX), top = Number(node.dataset.positionY);
      obstacles.push({ left: left - 8, top: top - 8, right: left + r.width + 8, bottom: top + r.height + 8 });
    }
  }
  const placement = placeTextConnectionToolbar({ selection, owner, width: bar.offsetWidth, height: bar.offsetHeight, viewport, obstacles });
  bar.style.left = `${placement.left}px`; bar.style.top = `${placement.top}px`;
}

function showCreate(item) {
  const boardId = state.boardId, epoch = state.canvasEpoch;
  const panel = document.createElement('div');
  panel.className = 'connection-create connection-toolbar';
  panel.style.bottom = '110px';
  panel.style.top = 'auto';
  document.body.append(panel);
  const remove = () => panel.remove();
  const create = type => {
    if (state.boardId !== boardId || state.canvasEpoch !== epoch) { remove(); return; }
    createAt(item, type, remove);
  };
  button('＋ 便签', () => create('note'), panel);
  button('＋ 形状', () => create('shape'), panel);
  const source = state.items.get(item.source.binding?.id);
  if (source?.type === 'text') button('＋ 同类文本', () => create('text'), panel);
  button('关闭', remove, panel);
  setTimeout(remove, 8e3);
}

function createAt(connector, type, done) {
  connector = state.items.get(connector.id);
  if (connector?.type !== 'connector' || !canMutateItem(connector)) { done(); return; }
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
    w: type === 'note' ? DEFAULT_NOTE_WIDTH : 190,
    h: type === 'note' ? DEFAULT_NOTE_HEIGHT : 120,
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
    if (!stateRuntime.draft) stateRuntime.selectedText = null;
    return;
  }
  const range = s.getRangeAt(0),
    a = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement,
    b = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  const boardItem = a.closest('.board-item');
  if (!boardItem || boardItem !== b.closest('.board-item')) {
    if (!stateRuntime.draft) { stateRuntime.selectionBar.hidden = true; stateRuntime.selectedText = null; }
    return;
  }
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
    boardId: state.boardId,
    epoch: state.canvasEpoch,
    itemId: item.id,
    scope,
    start: C.chars(map.value.slice(0, from)).length,
    end: C.chars(map.value.slice(0, to)).length,
    value: map.value
  };
  stateRuntime.selectionBar.hidden = false;
  const mode = stateRuntime.targetTextMode ? 'target' : stateRuntime.draft ? 'draft' : 'source';
  if (stateRuntime.selectionBar.dataset.mode !== mode) {
    stateRuntime.selectionBar.dataset.mode = mode;
    stateRuntime.selectionBar.replaceChildren();
    button(stateRuntime.targetTextMode ? '确认目标文字' : '连接选中文字', useTextSelection, stateRuntime.selectionBar);
    if (stateRuntime.draft && !stateRuntime.targetTextMode) button('选择目标文字', enterTargetText, stateRuntime.selectionBar);
  }
  positionTextSelectionBar(range, boardItem);
}

function useTextSelection() {
  if (!stateRuntime.selectedText) return;
  const saved = stateRuntime.selectedText;
  if (saved.boardId !== state.boardId || saved.epoch !== state.canvasEpoch) { cancel(); return; }
  // Read only the selected owner's layout; finishing editing can enqueue many
  // connected edges, whose painting is handled in later frames.
  if (state.editingId) finishEditing();
  const item = state.items.get(saved.itemId),
    value = C.contentText(item, saved.scope);
  if (!item || C.text(value) !== C.text(saved.value)) {
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
  const pointer = stateRuntime.lastPointer;
  let target = pointer ? getBoardPoint(pointer) : { x: t.fallback.x + 96 / state.zoom, y: t.fallback.y - 48 / state.zoom };
  t.fallback = resolve(t, target).point;
  if (Math.hypot(target.x - t.fallback.x, target.y - t.fallback.y) * state.zoom < 24)
    target = { x: t.fallback.x + 96 / state.zoom, y: t.fallback.y - 48 / state.zoom };
  cancel();
  stateRuntime.draft = {
    source: t,
    target: C.terminal({ fallback: target }),
    pointerId: null,
    dragging: false,
    layerId: state.activeLayerId
  };
  state.connectorDraft = stateRuntime.draft;
  state.tool = 'connector';
  els.viewport.dataset.tool = 'connector';
  stateRuntime.targetTextMode = false;
  stateRuntime.selectionBar.hidden = false;
  stateRuntime.selectionBar.replaceChildren();
  stateRuntime.selectionBar.dataset.mode = 'connecting';
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

export { captureTextSelection, scheduleTextSelection, createAt, enterTargetText, showCreate, useTextSelection };
