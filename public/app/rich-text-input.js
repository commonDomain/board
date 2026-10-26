import { insertPlainTextAtSelection, selectionBelongsToEditable } from './text-input-model.js';
import { getStructuredClipboardTable } from './paste-model.js';
import { createRichTextHistory, recordRichTextHistory, undoRichTextHistory } from './rich-text-history.js';

// Keep native IME editing, but represent explicit breaks and pasted plain text
// as literal newlines so DOM block wrappers cannot erase paragraph boundaries.
function wireRichTextInput(editable, { beforeChange = () => {}, change = () => {}, history = null, undo = null } = {}) {
  const cleanupHistory=history?createRichTextHistory(editable,history):()=>{};
  const undoEdit=kind=>undo?undo(kind):undoRichTextHistory(editable,kind);
  const beforeEdit=type=>{beforeChange(type);recordRichTextHistory(editable,type);};
  const before = event => {
    if (!editable.isContentEditable) return;
    if (event.inputType==='historyUndo' || event.inputType==='historyRedo') {
      if (undoEdit(event.inputType==='historyRedo'?'redo':'undo')) event.preventDefault();
      return;
    }
    beforeEdit(event.inputType);
    if (event.inputType === 'deleteContentBackward') {
      const selection=window.getSelection(),range=selectionBelongsToEditable(selection,editable)?selection.getRangeAt(0):null;
      if(range?.collapsed&&range.startContainer.nodeType===Node.TEXT_NODE&&range.startContainer.data.slice(Math.max(0,range.startOffset-2),range.startOffset)==='\n\u200b') {
        event.preventDefault();range.setStart(range.startContainer,range.startOffset-2);range.deleteContents();range.collapse(true);
        selection.removeAllRanges();selection.addRange(range);editable.dispatchEvent(new Event('input',{bubbles:true}));return;
      }
    }
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      event.preventDefault();
      // Chromium can normalize a caret immediately after a trailing newline
      // back to the preceding visual line. A non-persisted marker anchors it.
      insertPlainTextAtSelection(editable, '\n\u200b');
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  const paste = event => {
    if (!editable.isContentEditable) return;
    if (editable.matches('td,th') && getStructuredClipboardTable(event.clipboardData)) return;
    event.preventDefault();event.stopPropagation();beforeEdit('insertFromPaste');
    const text = event.clipboardData?.getData('text/plain') || '';
    insertPlainTextAtSelection(editable, text + (/[\r\n]$/.test(text) ? '\u200b' : ''));
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const input = event => {
    if(event.inputType && !event.isComposing && !['insertParagraph','insertLineBreak'].includes(event.inputType)) removeCaretMarkers(editable);
    change();
  };
  const keydown=event=>{
    if(event.isComposing || !(event.ctrlKey||event.metaKey) || event.altKey) return;
    const key=event.key.toLowerCase();
    if(key!=='z'&&key!=='y')return;
    if(undoEdit(key==='y'||event.shiftKey?'redo':'undo')){event.preventDefault();event.stopPropagation();}
  };
  editable.addEventListener('keydown',keydown);
  editable.addEventListener('beforeinput', before);
  editable.addEventListener('paste', paste);
  editable.addEventListener('input', input);
  return () => {
    cleanupHistory();
    editable.removeEventListener('keydown',keydown);
    editable.removeEventListener('beforeinput', before);
    editable.removeEventListener('paste', paste);
    editable.removeEventListener('input', input);
  };
}

function removeCaretMarkers(editable) {
  const selection=window.getSelection();
  if(!selectionBelongsToEditable(selection,editable))return;
  const range=selection.getRangeAt(0),start={node:range.startContainer,offset:range.startOffset},end={node:range.endContainer,offset:range.endOffset};
  const walker=document.createTreeWalker(editable,NodeFilter.SHOW_TEXT);let node,changed=false;
  while((node=walker.nextNode())) {
    if(!node.data.includes('\u200b'))continue;
    for(const point of [start,end])if(point.node===node)point.offset-=node.data.slice(0,point.offset).split('\u200b').length-1;
    node.data=node.data.replace(/\u200b/g,'');changed=true;
  }
  if(changed){range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);selection.removeAllRanges();selection.addRange(range);}
}

function restoreRichTextRange(editable, saved) {
  const selection = window.getSelection();
  const range = saved && editable.contains(saved.startContainer) && editable.contains(saved.endContainer) ? saved.cloneRange()
    : selectionBelongsToEditable(selection, editable) ? selection.getRangeAt(0).cloneRange() : null;
  editable.focus({ preventScroll: true });
  if (!range) return null;
  selection.removeAllRanges();selection.addRange(range);
  return range;
}

export { wireRichTextInput, restoreRichTextRange };
