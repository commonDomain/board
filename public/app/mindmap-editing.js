
import { snapshotItems } from './history-controller-model.js';
import { els } from './elements.js';

import { cloneSelectionFocusRange } from './floating-toolbar-position-model.js';

import { normalizeFontFamily } from './format-actions-model.js';

import { showToast } from './interface-model.js';
import { broadcastUpsert } from './items.js';
import { canMutateItem, explainUnwritableLayer } from './layers-model.js';
import { createMindNode, ensureMindNodeIds, fitMindMapItem, measureMindNodeWidth } from './mindmap-model.js';

import { state } from './state.js';
import { acquireElementEditLease, beginElementEditSession, finishElementEditActivity } from './element-edit-leases.js';

import { clamp, cssEscape, isImeEvent, makeId, placeCursorAtEnd, placeCursorAtPoint } from './utilities.js';
import { getMindNodeAtPath, sameMindPath, currentMindNodeText } from './mindmap-editing-model.js';
import { serializeRichTextRuns } from './text-rendering-model.js';
import { wireRichTextInput } from './rich-text-input.js';
import { applyMindNodeVisualStyle } from './mindmap-rendering-model.js';

let pushUndoSnapshot,
  pushItemUndoPatch,
  scheduleFloatingToolbarPosition,
  ensureEditableZoom,
  resizeMindNodeEditor,
  updateContextPanel,
  attachMindNodeResizeHandles,
  renderItem,
  markDirty,
  selectItem,
  rememberTextSelection,
  updateUndoButton,
  updateRedoButton;

function configureMindmapEditing(callbacks) {
  ({
    pushUndoSnapshot,
    pushItemUndoPatch,
    scheduleFloatingToolbarPosition,
    ensureEditableZoom,
    resizeMindNodeEditor,
    updateContextPanel,
    attachMindNodeResizeHandles,
    renderItem,
    markDirty,
    selectItem,
    rememberTextSelection,
    updateUndoButton,
    updateRedoButton
  } = callbacks);
}

function selectMindNode(itemId, path, options = {}) {
  const item = state.items.get(itemId);
  if (!canMutateItem(item)) {
    return;
  }
  state.mindmapSelection = { itemId, path: [...path] };
  if (state.selectedId !== itemId) {
    selectItem(itemId, options.deferPanel ? { panels: false } : {});
  }
  document.querySelectorAll('.mind-node.selected').forEach((node) => node.classList.remove('selected'));
  document.querySelectorAll('.mind-node[role="treeitem"]').forEach((node) => {
    node.tabIndex = -1;
  });
  document.querySelectorAll('.mind-node-actions button').forEach((button) => {
    button.tabIndex = -1;
  });
  document.querySelectorAll('.mind-node-resize').forEach((handle) => handle.remove());
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(itemId)}"]`);
  const element = root?.querySelector(`[data-mn-path="${cssEscape(path.join('.'))}"]`);
  element?.classList.add('selected');
  if (element) {
    element.tabIndex = 0;
    element.querySelectorAll('.mind-node-actions button').forEach((button) => {
      button.tabIndex = 0;
    });
  }
  attachMindNodeResizeHandles(element, item, path);
  clearTimeout(state.mindNodePanelTimer);
  state.mindNodePanelTimer = null;
  if (options.deferPanel) {
    els.contextPanel.hidden = true;
    const epoch = state.canvasEpoch;
    state.mindNodePanelTimer = setTimeout(() => {
      state.mindNodePanelTimer = null;
      if (
        state.canvasEpoch !== epoch ||
        state.mindmapEditing ||
        state.mindmapSelection?.itemId !== itemId ||
        !sameMindPath(state.mindmapSelection.path, path)
      )
        return;
      updateContextPanel();
    }, 450);
  } else {
    updateContextPanel();
  }
}

let mindEditRequest = 0;

async function startMindNodeEdit(item, path, options = {}) {
  const linkedNode = getMindNodeAtPath(item.tree, path);
  if (linkedNode?.taskRef && window.MusePlanning?.enabled) { window.MusePlanning.editTask(linkedNode.taskRef); return; }
  clearTimeout(state.mindNodePanelTimer);
  state.mindNodePanelTimer = null;
  if (!canMutateItem(item)) {
    showToast(explainUnwritableLayer(item?.layerId));
    return;
  }
  const request = ++mindEditRequest, epoch = state.canvasEpoch, itemId = item.id;
  const result = await acquireElementEditLease(itemId);
  if (request !== mindEditRequest || epoch !== state.canvasEpoch) {
    if (result.granted && epoch === state.canvasEpoch && state.mindmapEditing?.itemId !== itemId) finishElementEditActivity(itemId);
    return;
  }
  item = state.items.get(itemId);
  if (!result.granted || !canMutateItem(item)) {
    if (result.granted) finishElementEditActivity(itemId);
    showToast('此脑图正在被其他成员编辑，或连接尚未确认');
    return;
  }
  if (options.focusAnchor) ensureEditableZoom(options.focusAnchor, item);
  if (state.selectedId !== itemId || !sameMindPath(state.mindmapSelection?.path, path)) selectMindNode(itemId,path);
  let node = getMindNodeAtPath(item.tree, path);
  if (!node) {
    finishElementEditActivity(itemId);
    return;
  }
  document.querySelector('.mind-node-text.editing')?.blur();
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  const element = root?.querySelector(`[data-mn-path="${cssEscape(path.join('.'))}"]`);
  const textElement = element && element.querySelector('.mind-node-text');
  if (!textElement) {
    finishElementEditActivity(itemId);
    return;
  }
  const editToken = makeId('mindedit');
  state.mindmapEditing = {
    itemId: item.id,
    path: [...path],
    token: editToken,
    caretRange: null,
    range: null,
    initialWidth: Number(node.w) || measureMindNodeWidth(node.text, path.length === 0, node),
    initialHeight: Number(node.h) || (node.status || node.note ? 50 : 38),
    beforeItems: null,
    changed: false,
    finish: null
  };
  const style = node.style || {};
  state.fontSize = clamp(Number(style.fontSize) || 12, 8, 96);
  state.fontFamily = normalizeFontFamily(style.fontFamily);
  state.bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
  state.align = ['left', 'center', 'right'].includes(style.textAlign) ? style.textAlign : 'center';
  textElement.contentEditable = 'true';
  textElement.classList.add('editing');
  textElement.focus();
  if (!placeCursorAtPoint(textElement, options.focusAnchor)) placeCursorAtEnd(textElement);
  state.mindmapEditing.caretRange = cloneSelectionFocusRange(window.getSelection());
  state.mindmapEditing.range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0).cloneRange() : null;
  updateContextPanel();
  resizeMindNodeEditor();

  const finish = (commit) => {
    textElement.removeEventListener('blur', onBlur);
    textElement.removeEventListener('keydown', onKey);
    cleanupInput();
    textElement.removeEventListener('pointerup', onPointerUp);
    textElement.contentEditable = 'false';
    textElement.classList.remove('editing');
    const editing = state.mindmapEditing;
    if (!editing || editing.token !== editToken) {
      return;
    }
    item = state.items.get(itemId) || item;
    node = getMindNodeAtPath(item.tree, editing.path) || node;
    const originalText = currentMindNodeText(node.text);
    const richText = serializeRichTextRuns(textElement, {});
    const value = richText.map(run=>run.text).join('') || '未命名';
    const changed = Boolean(editing.changed || originalText !== value);
    state.mindmapEditing = null;
    // Release after the final content operation has been queued below.
    queueMicrotask(() => finishElementEditActivity(itemId));
    if (!commit && editing.beforeItems) {
      const restored = editing.beforeItems.find((entry) => entry.id === item.id);
      if (restored) {
        const next = { ...structuredClone(restored), contentVersion: state.items.get(item.id)?.contentVersion || 0 };
        state.items.set(item.id, next);
        broadcastUpsert(next);
        markDirty(true);
      }
      renderItem(state.items.get(item.id) || item);
      updateContextPanel();
      return;
    }
    if (commit && canMutateItem(item)) {
      const current = getMindNodeAtPath(item.tree, editing.path);
      if (current && changed) {
        const beforeItem = editing.beforeItems?.find(entry => entry.id === item.id) || structuredClone(item);
        current.text = value;
        current.richText = richText;
        const automaticWidth = measureMindNodeWidth(current.text, editing.path.length === 0, current);
        if (Number(current.w) < automaticWidth) current.w = automaticWidth;
        const fontSize = clamp(Number(current.style?.fontSize) || 12, 8, 96);
        current.h = Math.max(Number(current.h) || 0, Math.ceil(fontSize * 1.55 + 18));
        fitMindMapItem(item);
        state.items.set(item.id, item);
        // The edit owns this brain only; other members may have changed the
        // rest of the board since its initial snapshot was captured.
        pushItemUndoPatch(beforeItem, item);
        renderItem(item);
        broadcastUpsert(item);
        markDirty(true);
        updateContextPanel();
        return;
      }
    }
    renderItem(item);
    updateContextPanel();
  };
  const resizeForText = () => {
    const editing=state.mindmapEditing;
    if(!editing||editing.token!==editToken)return;
    if(!editing.beforeItems)editing.beforeItems=snapshotItems();
    editing.changed=true;resizeMindNodeEditor();
  };
  const cleanupInput = wireRichTextInput(textElement, {
    history: {
      changed:()=>{updateUndoButton();updateRedoButton();},
      capture:()=>structuredClone(node.style || {}),
      restore:style=>{node.style=style;applyMindNodeVisualStyle(element,style);element.style.textDecoration='none';textElement.style.textAlign=style.textAlign||'center';}
    },
    beforeChange: () => { if(state.mindmapEditing&&!state.mindmapEditing.beforeItems)state.mindmapEditing.beforeItems=snapshotItems(); },
    change: resizeForText
  });
  const onPointerUp = (event) => {
    if (event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    requestAnimationFrame(() => {
      if (state.mindmapEditing?.token !== editToken) return;
      if (window.getSelection()?.isCollapsed) placeCursorAtPoint(textElement, point);
      rememberTextSelection();
    });
  };
  const onBlur = (event) => {
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest('.floating-format-bar, .context-panel')) return;
    finish(true);
  };
  const onKey = (event) => {
    if (isImeEvent(event)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };
  textElement.addEventListener('blur', onBlur);
  textElement.addEventListener('keydown', onKey);
  textElement.addEventListener('pointerup', onPointerUp);
  state.mindmapEditing.finish = finish;
  requestAnimationFrame(scheduleFloatingToolbarPosition);
}

function updateMindMapTree(item, nextTree, selectionPath) {
  if (!canMutateItem(item)) {
    showToast(explainUnwritableLayer(item?.layerId));
    return false;
  }
  let normalizedTree;
  try {
    normalizedTree = ensureMindNodeIds(nextTree);
  } catch (error) {
    showToast(error.message || '脑图结构无效');
    return false;
  }
  const nextItem = { ...item, tree: normalizedTree };
  try {
    fitMindMapItem(nextItem);
  } catch (error) {
    showToast(error.message || '脑图布局失败');
    return false;
  }
  pushUndoSnapshot();
  Object.assign(item, nextItem);
  state.items.set(item.id, item);
  if (selectionPath) {
    state.mindmapSelection = { itemId: item.id, path: [...selectionPath] };
  }
  renderItem(item);
  broadcastUpsert(item);
  markDirty(true);
  return true;
}

function addMindChild(item, path) {
  if (path.length >= 31) {
    showToast('脑图最多支持 32 层节点');
    return;
  }
  const nextTree = JSON.parse(JSON.stringify(item.tree));
  const node = getMindNodeAtPath(nextTree, path);
  if (!node) {
    return;
  }
  if (!Array.isArray(node.children)) {
    node.children = [];
  }
  node.children.push(createMindNode('新分支'));
  const selectionPath = [...path, node.children.length - 1];
  if (updateMindMapTree(item, nextTree, selectionPath)) {
    requestAnimationFrame(() => startMindNodeEdit(item, selectionPath));
  }
}

async function startMindNodeNoteEdit(item, path, element) {
  if (!canMutateItem(item)) {
    showToast(explainUnwritableLayer(item?.layerId));
    return;
  }
  const epoch = state.canvasEpoch, id = item.id;
  const session = await beginElementEditSession([id]);
  if (!session || epoch !== state.canvasEpoch) { session?.release(); showToast('脑图正在被其他成员编辑，或连接尚未确认'); return; }
  item = state.items.get(id);
  const pathKey = cssEscape(path.join('.'));
  element = document.querySelector(`.board-item[data-item-id="${cssEscape(id)}"] [data-mn-path="${pathKey}"]`);
  const node = item && getMindNodeAtPath(item.tree, path);
  if (!node || !element) {
    session.release();
    return;
  }
  element.querySelector('.mind-note-editor')?.remove();
  const editor = document.createElement('textarea');
  editor.className = 'mind-note-editor';
  editor.value = node.note || '';
  const initialNote = node.note || '';
  editor.placeholder = '补充备注；Ctrl/⌘ + Enter 保存';
  editor.setAttribute('aria-label', `节点备注：${node.text}`);
  element.appendChild(editor);
  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    queueMicrotask(() => session.release());
    const value = commit ? editor.value.trim().slice(0, 4000) : initialNote;
    editor.remove();
    if (value === (getMindNodeAtPath(state.items.get(item.id)?.tree, path)?.note || '')) {
      return;
    }
    const current = state.items.get(id);
    if (epoch !== state.canvasEpoch || !current || !session.current()) return;
    const nextTree = structuredClone(current.tree);
    const nextNode = getMindNodeAtPath(nextTree, path);
    if (!nextNode) return;
    if (value) nextNode.note = value;
    else delete nextNode.note;
    updateMindMapTree(current, nextTree, [...path]);
  };
  editor.addEventListener('pointerdown', (event) => event.stopPropagation());
  editor.addEventListener('click', (event) => event.stopPropagation());
  editor.addEventListener('keydown', (event) => {
    if (isImeEvent(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
  });
  editor.addEventListener('blur', () => finish(true));
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

function addMindSibling(item, path) {
  if (!path.length) {
    return;
  }
  const parentPath = path.slice(0, -1);
  const nextTree = JSON.parse(JSON.stringify(item.tree));
  const parent = getMindNodeAtPath(nextTree, parentPath);
  if (!parent || !Array.isArray(parent.children)) {
    return;
  }
  const index = path[path.length - 1];
  parent.children.splice(index + 1, 0, createMindNode('新分支'));
  const selectionPath = [...parentPath, index + 1];
  if (updateMindMapTree(item, nextTree, selectionPath)) {
    requestAnimationFrame(() => startMindNodeEdit(item, selectionPath));
  }
}

function deleteMindNode(item, path) {
  if (!path.length) {
    return;
  }
  const parentPath = path.slice(0, -1);
  const nextTree = JSON.parse(JSON.stringify(item.tree));
  const parent = getMindNodeAtPath(nextTree, parentPath);
  if (!parent || !Array.isArray(parent.children)) {
    return;
  }
  const index = path[path.length - 1];
  parent.children.splice(index, 1);
  const selectionPath = parent.children.length
    ? parentPath.concat(Math.min(index, parent.children.length - 1))
    : parentPath;
  updateMindMapTree(item, nextTree, selectionPath);
}

function toggleMindCollapse(item, path) {
  const nextTree = JSON.parse(JSON.stringify(item.tree));
  const node = getMindNodeAtPath(nextTree, path);
  if (!node || !Array.isArray(node.children) || !node.children.length) {
    return;
  }
  node.collapsed = !node.collapsed;
  updateMindMapTree(item, nextTree, [...path]);
}

function cycleMindStatus(item, path) {
  const nextTree = JSON.parse(JSON.stringify(item.tree));
  const node = getMindNodeAtPath(nextTree, path);
  if (!node) {
    return;
  }
  if (node.taskRef && window.MusePlanning?.enabled) {
    const task = window.MusePlanning.getTask(node.taskRef);
    if (!task || task.deleted) return;
    window.MusePlanning.chooseStatus(node.taskRef);
    return;
  }
  const statuses = ['', 'todo', 'doing', 'done', 'blocked'];
  node.status = statuses[(statuses.indexOf(node.status || '') + 1) % statuses.length];
  if (!node.status) {
    delete node.status;
  }
  updateMindMapTree(item, nextTree, [...path]);
}
export {
  selectMindNode,
  startMindNodeEdit,
  updateMindMapTree,
  addMindChild,
  startMindNodeNoteEdit,
  addMindSibling,
  deleteMindNode,
  toggleMindCollapse,
  cycleMindStatus
};

export { configureMindmapEditing };
