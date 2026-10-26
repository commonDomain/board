import { snapshotItems } from './history-controller-model.js';
import { getEditingMindNodeContext } from './floating-toolbar-menu.js';
import { getSelectedOrEditingItem, updateContextPanel } from './format-panel.js';
import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';
import { getMindNodeAtPath, sameMindPath } from './mindmap-editing-model.js';
import { startMindNodeEdit } from './mindmap-editing.js';
import { fitMindMapItem, measureMindNodeWidth, measureMindNodeHeight, layoutMindTree, mindNodeTextDefaults } from './mindmap-model.js';
import { applyRichTextRangeFormat, serializeRichTextRuns, renderRichTextRuns } from './text-rendering-model.js';
import { restoreRichTextRange } from './rich-text-input.js';
import { recordRichTextHistory } from './rich-text-history.js';
import { selectionBelongsToEditable } from './text-input-model.js';
import { cloneSelectionFocusRange } from './floating-toolbar-position-model.js';
import { indexUpsertItem } from './spatial-index.js';
import { applyMindNodeVisualStyle } from './mindmap-rendering-model.js';
import { renderItem } from './rendering.js';
import { state } from './state.js';
import { cssEscape, placeCursorAtEnd } from './utilities.js';

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
    if (!options.reset && Object.keys(mindInlinePatch(patch)).length) return applyMindNodeTextFormat(patch, options);
    if (!editingContext.editing.beforeItems) editingContext.editing.beforeItems = snapshotItems();
    recordRichTextHistory(editingContext.editable);
    if (options.reset) {
      delete node.style;
      const defaults = mindNodeTextDefaults({},selection.path.length===0);
      node.richText = serializeRichTextRuns(editingContext.editable,{}).map(run=>({...run,...defaults}));
      renderRichTextRuns(editingContext.editable,node.richText,defaults);
      placeCursorAtEnd(editingContext.editable);
      editingContext.editing.range=window.getSelection().getRangeAt(0).cloneRange();
      editingContext.editing.caretRange=cloneSelectionFocusRange(window.getSelection());
    }
    else node.style = { ...(node.style || {}), ...(patch || {}) };
    editingContext.editing.changed = true;
    applyMindNodeVisualStyle(editingContext.element, node.style);
    editingContext.element.style.textDecoration='none';
    resizeMindNodeEditor(editingContext);
    updateContextPanel();
    return true;
  }
  const beforeItems = snapshotItems();
  if (options.reset) delete node.style;
  else node.style = { ...(node.style || {}), ...(patch || {}) };
  const inlinePatch = mindInlinePatch(patch,options.reset,selection.path.length===0);
  if(node.richText&&Object.keys(inlinePatch).length)node.richText=node.richText.map(run=>({...run,...inlinePatch}));
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
  recordRichTextHistory(context.editable);
  const inlinePatch = mindInlinePatch(patch, options.reset,editing.path.length===0);
  if (Object.keys(inlinePatch).length) {
    const selection = window.getSelection();
    const range = restoreRichTextRange(context.editable, selectionBelongsToEditable(selection, context.editable) ? selection.getRangeAt(0) : editing.range);
    if (range) {
      const formatted = applyRichTextRangeFormat(context.editable, range, inlinePatch);
      selection.removeAllRanges();selection.addRange(formatted);
      editing.range = formatted.cloneRange();editing.caretRange = cloneSelectionFocusRange(selection);
    }
  }
  const style = { ...(node.style || {}) };
  if (options.reset) {
    delete style.textAlign;
  } else {
    Object.entries(patch).forEach(([key, value]) => {
      if (key !== 'textAlign') return;
      if (value === null || value === undefined || value === false || value === '') delete style[key];
      else style[key] = value;
    });
  }
  node.style = style;
  editing.changed = true;
  applyMindNodeVisualStyle(element, style);
  element.style.textDecoration = 'none';
  context.editable.style.textAlign = style.textAlign || 'center';
  resizeMindNodeEditor(context);
  state.items.set(item.id, item);
  updateContextPanel();
  return true;
}

function resizeMindNodeEditor(context = getEditingMindNodeContext()) {
  if (!context?.element || !context.editable) return;
  const { item, node, element, editable, editing } = context;
  const richText = serializeRichTextRuns(editable, {});
  const text = richText.map(run => run.text).join('');
  if (editing.changed || text !== node.text || node.richText) node.richText = richText;
  node.text = text;
  const automaticWidth = measureMindNodeWidth(node.text, editing.path.length === 0, node);
  const minimumWidth = Math.max(Number(editing.initialWidth) || 0, automaticWidth);
  element.style.width = `${minimumWidth}px`;
  const minimumHeight = Math.max(Number(editing.initialHeight) || 0, measureMindNodeHeight(node, minimumWidth, editing.path.length === 0), editable.scrollHeight + 18);
  node.w = minimumWidth; node.h = minimumHeight;
  element.style.width = `${minimumWidth}px`;
  element.style.height = `${minimumHeight}px`;
  const itemElement = element.closest('.board-item');
  const card = itemElement?.querySelector('.mindmap-card');
  if (!itemElement || !card) return;
  fitMindMapItem(item);
  const layout = layoutMindTree(item.tree,item.w,item.h,item.branchStyle,item.layoutMode);
  for (const entry of layout.nodes) {
    const current = card.querySelector(`[data-mn-path="${cssEscape(entry.path.join('.'))}"]`);
    if (current) Object.assign(current.style,{left:`${entry.x}px`,top:`${entry.y}px`,width:`${entry.w}px`,height:`${entry.h}px`});
  }
  const paths = card.querySelectorAll(':scope > svg > path:not([data-relation])');
  layout.links.forEach((link,i) => {
    const left = link.to.side === 'left';
    const route = window.MindMapLayout.createLinkPath({startX:left?link.from.x:link.from.x+link.from.w,startY:link.from.y+link.from.h/2,endX:left?link.to.x+link.to.w:link.to.x,endY:link.to.y+link.to.h/2,siblingCount:link.siblingCount},item.branchStyle);
    paths[i]?.setAttribute('d',route.d);
  });
  const byId = new Map(layout.nodes.map(entry=>[entry.id,entry]));
  for (const relation of item.relations || []) {
    const from=byId.get(relation.startId),to=byId.get(relation.endId);
    if(from&&to)card.querySelector(`[data-relation="${cssEscape(relation.id)}"]`)?.setAttribute('d',window.MindMapLayout.createLinkPath({startX:from.x+from.w/2,startY:from.y+from.h/2,endX:to.x+to.w/2,endY:to.y+to.h/2,siblingCount:1},'curve').d);
  }
  itemElement.style.width=card.style.width=`${item.w}px`;itemElement.style.height=card.style.height=`${item.h}px`;
  indexUpsertItem(item);window.ConnectorUI?.contentChanged(item.id);
}

function mindInlinePatch(patch, reset = false, isRoot = false) {
  if(reset)return mindNodeTextDefaults({},isRoot);
  const result={};
  for(const key of ['color','fontSize','fontFamily'])if(Object.hasOwn(patch,key))result[key]=patch[key];
  if(Object.hasOwn(patch,'textColor'))result.color=patch.textColor;
  if(Object.hasOwn(patch,'fontWeight'))result.bold=patch.fontWeight==='bold'||Number(patch.fontWeight)>=600;
  if(Object.hasOwn(patch,'fontStyle'))result.italic=patch.fontStyle==='italic';
  if(Object.hasOwn(patch,'textDecoration'))result.underline=patch.textDecoration==='underline';
  return result;
}
export { setMindMapBranchStyle, setMindNodeStyle, applyMindNodeTextFormat, resizeMindNodeEditor };
