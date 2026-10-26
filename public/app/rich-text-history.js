import { selectionBelongsToEditable } from './text-input-model.js';

const histories = new WeakMap();

function captureEditableSelection(editable) {
  const selection = window.getSelection();
  if (!selectionBelongsToEditable(selection,editable)) return null;
  const range = selection.getRangeAt(0), before = document.createRange();
  before.selectNodeContents(editable); before.setEnd(range.startContainer,range.startOffset);
  const start = before.toString().length;
  return { start, end:start+range.toString().length };
}

function restoreEditableSelection(editable, point) {
  const at = offset => {
    const walker = document.createTreeWalker(editable,NodeFilter.SHOW_TEXT); let node, last;
    while ((node=walker.nextNode())) {
      last=node;
      if (offset<=node.length) return [node,offset];
      offset-=node.length;
    }
    return last ? [last,last.length] : [editable,0];
  };
  editable.focus({preventScroll:true});
  const range=document.createRange();
  range.setStart(...at(point?.start ?? editable.textContent.length));
  range.setEnd(...at(point?.end ?? editable.textContent.length));
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  return range;
}

function createRichTextHistory(editable, { capture = () => null, restore = () => {}, changed = () => {} } = {}) {
  const history = { undo:[], redo:[], group:null, at:0, capture, restore, changed };
  histories.set(editable,history);
  changed();
  return () => {histories.delete(editable);changed();};
}

function richTextHistoryAvailability(editable) {
  const history=editable&&histories.get(editable);
  return history?{undo:Boolean(history.undo.length),redo:Boolean(history.redo.length)}:null;
}

function richTextSnapshot(editable, history) {
  return { html:editable.innerHTML, selection:captureEditableSelection(editable), data:history.capture() };
}

function recordRichTextHistory(editable, inputType = 'format') {
  const history=histories.get(editable);
  if (!history) return;
  const group = /^(insertText|insertCompositionText)$/.test(inputType) ? 'typing'
    : /^delete/.test(inputType) ? 'deleting' : null;
  const now=Date.now();
  if (!group || group!==history.group || now-history.at>700) {
    history.undo.push(richTextSnapshot(editable,history));
    // Node text is bounded by validation; also bound edit-session memory.
    while (history.undo.length>100 || history.undo.length>1 && history.undo.reduce((sum,entry)=>sum+entry.html.length,0)>2_000_000) history.undo.shift();
  }
  history.redo=[];history.group=group;history.at=now;
  history.changed();
}

function undoRichTextHistory(editable, kind = 'undo') {
  const history=histories.get(editable);
  if (!history) return false;
  const source=history[kind], target=history[kind==='undo'?'redo':'undo'];
  const entry=source.pop();
  if (!entry) return true;
  target.push(richTextSnapshot(editable,history));history.group=null;
  editable.innerHTML=entry.html;
  history.restore(entry.data);
  restoreEditableSelection(editable,entry.selection);
  editable.dispatchEvent(new Event('input',{bubbles:true}));
  history.changed();
  return true;
}

export { captureEditableSelection, restoreEditableSelection, createRichTextHistory, recordRichTextHistory, undoRichTextHistory, richTextHistoryAvailability };
