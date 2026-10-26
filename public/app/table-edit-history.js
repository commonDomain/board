import { state } from './state.js';
import { pushUndoSnapshot, snapshotDocument, undoLastChange, redoLastChange } from './history-controller.js';
import { syncTableFromDom } from './table-rendering-model.js';
import { renderItem } from './rendering.js';
import { saveTextSelection } from './floating-toolbar-position-model.js';
import { captureEditableSelection, restoreEditableSelection } from './rich-text-history.js';
import { cssEscape } from './utilities.js';

const sessions=new WeakMap();
function sessionHistory() {
  if (!state.editSnapshot) return null;
  if (!sessions.has(state.editSnapshot)) sessions.set(state.editSnapshot,{redo:0});
  return sessions.get(state.editSnapshot);
}

function recordTableEditorHistory(item, inputType = 'format') {
  if (state.editingId!==item.id || item.type!=='table') return;
  const root=document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  if (!root) return;
  syncTableFromDom(root,item);
  const cell=document.activeElement?.closest('td,th');
  const group=/^(insertText|insertCompositionText)$/.test(inputType)?'typing':/^delete/.test(inputType)?'deleting':null;
  const key=group?`${item.id}/${cell?.dataset.row}/${cell?.dataset.column}/${group}`:null;
  const now=Date.now(), previous=state.editingHistoryInput;
  const session=sessionHistory();if(session)session.redo=0;
  if (!key || previous?.groupKey!==key || now-previous.at>700) pushUndoSnapshot(snapshotDocument());
  state.editingHistoryInput=key?{itemId:item.id,groupKey:key,at:now}:null;
}

function undoTableEditorHistory(kind = 'undo') {
  const item=state.items.get(state.editingId);
  if (item?.type!=='table') return false;
  const depth=state.editingUndoDepth;
  const local=sessionHistory();
  if (kind==='undo' && Number.isInteger(depth) && state.undoStack.length<=depth || kind==='redo' && (!state.redoStack.length || !local?.redo)) return true;
  const root=document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  const cell=document.activeElement?.closest('td,th');
  const point=cell&&root?.contains(cell)?{row:Number(cell.dataset.row),column:Number(cell.dataset.column)}:state.tableFocus;
  const selection=cell?captureEditableSelection(cell):null;
  if (root) syncTableFromDom(root,item);
  const session={editSnapshot:state.editSnapshot,editingCreatedId:state.editingCreatedId,editingUndoDepth:depth,planningEdit:state.planningEdit};
  // Keep the confirmed lease while history redraws the item. Selection changes
  // during a document restore must not commit the active edit session.
  state.editingId=null;state.editSnapshot=null;state.textSelection=null;
  const previousLength=state.undoStack.length;
  if (kind==='redo') redoLastChange(); else undoLastChange();
  if(local && state.undoStack.length!==previousLength)local.redo+=kind==='redo'?-1:1;
  if (!state.items.has(item.id)) return true;
  Object.assign(state,session,{editingId:item.id,editingHistoryInput:null,selectedId:item.id,selectedIds:new Set([item.id])});
  renderItem(state.items.get(item.id));
  const nextRoot=document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  const next=nextRoot?.querySelector(`[data-row="${point?.row || 0}"][data-column="${point?.column || 0}"]`) || nextRoot?.querySelector('td,th');
  if (next) {
    state.tableFocus={itemId:item.id,row:Number(next.dataset.row),column:Number(next.dataset.column)};
    saveTextSelection(item.id,restoreEditableSelection(next,selection));
  }
  return true;
}

export { recordTableEditorHistory, undoTableEditorHistory };
