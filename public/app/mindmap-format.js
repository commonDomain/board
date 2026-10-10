import { snapshotItems } from './history-controller-model.js';
import { getEditingMindNodeContext } from './floating-toolbar-menu.js';
import { getSelectedOrEditingItem, updateContextPanel } from './format-panel.js';
import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';
import { getMindNodeAtPath, sameMindPath } from './mindmap-editing-model.js';
import { startMindNodeEdit } from './mindmap-editing.js';
import { fitMindMapItem, measureMindNodeWidth } from './mindmap-model.js';
import { applyMindNodeVisualStyle } from './mindmap-rendering-model.js';
import { renderItem } from './rendering.js';
import { state } from './state.js';
import { clamp } from './utilities.js';

function setMindMapBranchStyle(style) {
  let item = getSelectedOrEditingItem();
  if (!canMutateItem(item) || item.type !== 'mindmap') return;
  const nextStyle = window.MindMapLayout.normalizeStyle(style);
  if (nextStyle === window.MindMapLayout.normalizeStyle(item.branchStyle)) return;
  const editingPath = state.mindmapEditing?.itemId === item.id ? [...state.mindmapEditing.path] : null;
  if (editingPath) {
    state.mindmapEditing.finish?.(true);
    item = state.items.get(item.id);
  }
  const beforeItems = snapshotItems();
  item.branchStyle = nextStyle;
  fitMindMapItem(item);
  state.items.set(item.id, item);
  renderItem(item);
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
  updateContextPanel();
  if (editingPath && getMindNodeAtPath(item.tree, editingPath)) {
    startMindNodeEdit(item, editingPath);
  }
}

function setMindNodeStyle(patch, options = {}) {
  const item = getSelectedOrEditingItem();
  const selection = state.mindmapSelection?.itemId === item?.id ? state.mindmapSelection : null;
  const node =
    selection && canMutateItem(item) && item.type === 'mindmap' ? getMindNodeAtPath(item.tree, selection.path) : null;
  if (!node) {
    showToast('请先选择一个脑图节点');
    return false;
  }
  const editingContext = getEditingMindNodeContext();
  if (editingContext?.item.id === item.id && sameMindPath(editingContext.editing.path, selection.path)) {
    if (!editingContext.editing.beforeItems) editingContext.editing.beforeItems = snapshotItems();
    if (options.reset) delete node.style;
    else node.style = { ...(node.style || {}), ...(patch || {}) };
    editingContext.editing.changed = true;
    applyMindNodeVisualStyle(editingContext.element, node.style);
    resizeMindNodeEditor(editingContext);
    updateContextPanel();
    return true;
  }
  const beforeItems = snapshotItems();
  if (options.reset) delete node.style;
  else node.style = { ...(node.style || {}), ...(patch || {}) };
  fitMindMapItem(item);
  state.items.set(item.id, item);
  renderItem(item);
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
  state.mindmapSelection = { itemId: item.id, path: [...selection.path] };
  updateContextPanel();
  return true;
}

function applyMindNodeTextFormat(patch = {}, options = {}) {
  const context = getEditingMindNodeContext();
  if (!context || !canMutateItem(context.item)) return false;
  const { editing, item, node, element } = context;
  if (!editing.beforeItems) editing.beforeItems = snapshotItems();
  const style = { ...(node.style || {}) };
  const textKeys = [
    'color',
    'textColor',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'textDecoration',
    'textAlign'
  ];
  if (options.reset) {
    textKeys.forEach((key) => delete style[key]);
  } else {
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false || value === '') delete style[key];
      else style[key] = value;
    });
  }
  node.style = style;
  editing.changed = true;
  applyMindNodeVisualStyle(element, style);
  resizeMindNodeEditor(context);
  state.items.set(item.id, item);
  updateContextPanel();
  return true;
}

function resizeMindNodeEditor(context = getEditingMindNodeContext()) {
  if (!context?.element || !context.editable) return;
  const { item, node, element, editable, editing } = context;
  const automaticWidth = measureMindNodeWidth(editable.textContent, editing.path.length === 0, node);
  const minimumWidth = Math.max(Number(editing.initialWidth) || 0, automaticWidth);
  const fontSize = clamp(Number(node.style?.fontSize) || 12, 8, 96);
  const minimumHeight = Math.max(Number(editing.initialHeight) || 0, Math.ceil(fontSize * 1.55 + 18));
  element.style.width = `${minimumWidth}px`;
  element.style.height = `${minimumHeight}px`;
  const itemElement = element.closest('.board-item');
  const card = itemElement?.querySelector('.mindmap-card');
  if (!itemElement || !card) return;
  const requiredWidth = Math.ceil(element.offsetLeft + minimumWidth + 24);
  const requiredHeight = Math.ceil(element.offsetTop + minimumHeight + 24);
  if (requiredWidth > item.w) {
    itemElement.style.width = `${requiredWidth}px`;
    card.style.width = `${requiredWidth}px`;
  }
  if (requiredHeight > item.h) {
    itemElement.style.height = `${requiredHeight}px`;
    card.style.height = `${requiredHeight}px`;
  }
}
export { setMindMapBranchStyle, setMindNodeStyle, applyMindNodeTextFormat, resizeMindNodeEditor };
