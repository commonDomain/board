import { pushUndoSnapshot, redoLastChange, snapshotDocument, undoLastChange } from './history-controller.js';
import { fitNoteToContent } from './note-sizing-model.js';
import { floatingToolbarUsesTarget } from './floating-toolbar-menu-model.js';

import { cloneSelectionFocusRange, saveTextSelection } from './floating-toolbar-position-model.js';

import { getTextLineStyleAt, normalizeTextLineStyles, updateFormatControls } from './format-actions-model.js';
import { upsertItem } from './items.js';

import { state } from './state.js';

import {
  getTextListLineValue,
  createInlineTextFormatWrapper,
  getVisibleNumberForLine,
  placeCaretInTextListContent,
  setTextListLineValue
} from './text-rendering-model.js';
import { clamp } from './utilities.js';
import {
  getEditingTextContext,
  selectionBelongsToEditable,
  matchFontFamily,
  cssColorToHex,
  getTextElementEmphasis,
  getTextSelectionEmphasis,
  getEditingTableTextContext,
  insertPlainTextAtSelection,
  dispatchEditableInput
} from './text-input-model.js';

let getEditingMindNodeContext,
  scheduleFloatingToolbarPosition,
  getTextCaretLocation,
  restoreTextCaretLocation,
  updateTextListControls,
  renderItem,
  createTextListLine,
  syncTextItemFromDom;

function configureTextInput(callbacks) {
  ({
    getEditingMindNodeContext,
    scheduleFloatingToolbarPosition,
    getTextCaretLocation,
    restoreTextCaretLocation,
    updateTextListControls,
    renderItem,
    createTextListLine,
    syncTextItemFromDom
  } = callbacks);
}

let textSelectionSyncFrame = null;

let textAutosizeFrame = null;

let pendingTextAutosize = null;

let lastTextSelectionFormatSignature = '';

let lastTextSelectionLineSignature = '';

const editHistories = new WeakMap();
function textEditHistory() {
  if (!state.editSnapshot) return null;
  if (!editHistories.has(state.editSnapshot)) editHistories.set(state.editSnapshot, { redo: 0 });
  return editHistories.get(state.editSnapshot);
}

function rememberTextSelection() {
  const context = getEditingTextContext();
  const selection = window.getSelection();
  if (!context || !selectionBelongsToEditable(selection, context.editable)) {
    const mindContext = getEditingMindNodeContext();
    if (selectionBelongsToEditable(selection, mindContext?.editable)) {
      mindContext.editing.caretRange = cloneSelectionFocusRange(selection);
      mindContext.editing.range = selection.getRangeAt(0).cloneRange();
      scheduleFloatingToolbarPosition();
    }
    const tableContext = getEditingTableTextContext();
    if (selectionBelongsToEditable(selection, tableContext?.editable)) saveTextSelection(tableContext.item.id, selection.getRangeAt(0), selection);
    if ((selectionBelongsToEditable(selection,mindContext?.editable) || selectionBelongsToEditable(selection,tableContext?.editable)) && !textSelectionSyncFrame)
      textSelectionSyncFrame=requestAnimationFrame(flushTextSelectionSync);
    return;
  }
  // Preserve the DOM range synchronously so clicking a toolbar control cannot
  // lose the selection, then coalesce all expensive style/layout work to one
  // pass per animation frame.
  saveTextSelection(context.item.id, selection.getRangeAt(0), selection);
  if (textSelectionSyncFrame) return;
  textSelectionSyncFrame = requestAnimationFrame(flushTextSelectionSync);
}

function flushTextSelectionSync() {
  textSelectionSyncFrame = null;
  const selection = window.getSelection();
  const context = [getEditingTextContext(),getEditingTableTextContext(),getEditingMindNodeContext()].find(candidate=>selectionBelongsToEditable(selection,candidate?.editable));
  if (!context || !selectionBelongsToEditable(selection, context.editable)) return;
  if(context.item.type!=='mindmap')saveTextSelection(context.item.id, selection.getRangeAt(0), selection);
  const caret = ['text','note'].includes(context.item.type) ? getTextCaretLocation(context.editable) : null;
  const anchor=selection.anchorNode?.nodeType===Node.ELEMENT_NODE?selection.anchorNode:selection.anchorNode?.parentElement;
  const emphasis = anchor ? getTextElementEmphasis(anchor,context.editable) : getTextSelectionEmphasis();
  document.querySelectorAll('[data-note-format]').forEach(button => {
    const active = Boolean(emphasis?.[button.dataset.noteFormat]);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if(caret)state.activeTextLine = { itemId: context.item.id, ...caret };
  const anchorElement =
    selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
  if (anchorElement) {
    const computed = getComputedStyle(anchorElement);
    state.fontSize = clamp(Math.round(parseFloat(computed.fontSize)) || state.fontSize, 10, 96);
    state.fontFamily = matchFontFamily(computed.fontFamily);
    state.bold = Number.parseInt(computed.fontWeight, 10) >= 600 || computed.fontWeight === 'bold';
    const normalizedColor = cssColorToHex(computed.color);
    if (normalizedColor) {
      state.color = normalizedColor;
    }
    const formatSignature = [
      context.item.id,
      state.fontSize,
      state.fontFamily,
      state.bold,
      state.align,
      state.color
    ].join('|');
    if (formatSignature !== lastTextSelectionFormatSignature) {
      lastTextSelectionFormatSignature = formatSignature;
      updateFormatControls();
    }
    const lineSignature = caret ? `${context.item.id}|${caret.lineIndex}|${getTextLineStyleAt(context.item, caret.lineIndex)}` : '';
    if (caret && lineSignature !== lastTextSelectionLineSignature) {
      lastTextSelectionLineSignature = lineSignature;
      updateTextListControls(context.item, caret);
    }
  }
  if (floatingToolbarUsesTarget(context.item)) {
    scheduleFloatingToolbarPosition();
  }
}

function restoreTextSelection(editable) {
  const saved = state.textSelection;
  const selection = window.getSelection();
  if (!editable) {
    return false;
  }
  if (saved?.itemId === state.editingId && saved.range) {
    try {
      selection.removeAllRanges();
      selection.addRange(saved.range.cloneRange());
      if (selectionBelongsToEditable(selection, editable)) return true;
    } catch {
      // A render may detach the saved Range. Restore from the logical caret
      // coordinates below instead of sending the cursor to the end.
    }
  }
  const logical = state.activeTextLine?.itemId === state.editingId ? state.activeTextLine : null;
  if (!logical) return false;
  const line = editable.querySelector(`.text-list-line[data-line-index="${Number(logical.lineIndex) || 0}"]`);
  const content = line?.querySelector('.text-list-content');
  if (!content) return false;
  const range = placeCaretInTextListContent(content, logical.column);
  saveTextSelection(state.editingId, range);
  return true;
}

function recordTextEditorHistory(editable, groupKey = null) {
  const itemElement = editable?.closest('.board-item');
  const item = itemElement && state.items.get(itemElement.dataset.itemId);
  if (!item || (item.type !== 'text' && item.type !== 'note')) return;
  const history = textEditHistory();
  if (history) history.redo = 0;
  const now = Date.now();
  const grouped = Boolean(
    groupKey &&
    state.editingHistoryInput?.itemId === item.id &&
    state.editingHistoryInput.groupKey === groupKey &&
    now - state.editingHistoryInput.at < 700
  );
  state.editingHistoryInput = groupKey ? { itemId: item.id, groupKey, at: now } : null;
  if (grouped) return;
  syncTextItemFromDom(itemElement, item, editable, { autosize: false });
  state.items.set(item.id, item);
  pushUndoSnapshot(snapshotDocument());
}

function onTextBeforeInput(event) {
  if (!event.currentTarget.isContentEditable) {
    return;
  }
  const inputType = String(event.inputType || '');
  if (inputType === 'historyUndo' || inputType === 'historyRedo') {
    event.preventDefault();
    return;
  }
  if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
    event.preventDefault();
    recordTextEditorHistory(event.currentTarget);
    insertTextListBreak(event.currentTarget);
    dispatchEditableInput(event.currentTarget);
    return;
  }
  if (inputType.startsWith('insert') || inputType.startsWith('delete')) {
    const groupKey =
      inputType === 'insertText' || inputType === 'insertCompositionText'
        ? 'typing'
        : inputType.startsWith('delete')
          ? 'deleting'
          : null;
    recordTextEditorHistory(event.currentTarget, groupKey);
  }
}

function onTextKeyDown(event) {
  if (event.isComposing) return;
  if (!event.currentTarget.isContentEditable) {
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.stopPropagation();
    undoTextEditorHistory(event.shiftKey ? 'redo' : 'undo');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    event.stopPropagation();
    undoTextEditorHistory('redo');
    return;
  }
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    recordTextEditorHistory(event.currentTarget);
    insertTextListBreak(event.currentTarget);
    dispatchEditableInput(event.currentTarget);
    return;
  }
  if (
    event.key === 'Backspace' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.currentTarget.dataset.structuredLines === 'true' &&
    deleteStructuredTextBackward(event.currentTarget)
  ) {
    event.preventDefault();
    dispatchEditableInput(event.currentTarget);
  }
}

function undoTextEditorHistory(kind = 'undo') {
  const context = getEditingTextContext();
  if (!context) return false;
  const depth = state.editingUndoDepth, history = textEditHistory();
  const stack = kind === 'redo' ? state.redoStack : state.undoStack;
  if (!stack.length || kind === 'undo' && Number.isInteger(depth) && stack.length <= depth ||
      kind === 'redo' && !history?.redo) return true;
  syncTextItemFromDom(context.root, context.item, context.editable);
  state.items.set(context.item.id, context.item);
  const itemId = context.item.id;
  const caret = getTextCaretLocation(context.editable);
  const session = { editSnapshot: state.editSnapshot, editingCreatedId: state.editingCreatedId,
    editingUndoDepth: depth, planningEdit: state.planningEdit };
  // Redraw history without ending this edit or replacing its cancel baseline.
  state.editingId = null;
  state.editSnapshot = null;
  state.textSelection = null;
  state.activeTextLine = null;
  const previousLength = state.undoStack.length;
  if (kind === 'redo') redoLastChange();
  else undoLastChange();
  if (history && state.undoStack.length !== previousLength) history.redo += kind === 'redo' ? -1 : 1;
  if (!state.items.has(itemId)) return true;
  Object.assign(state, session, { editingId: itemId, editingHistoryInput: null,
    selectedId: itemId, selectedIds: new Set([itemId]) });
  renderItem(state.items.get(itemId));
  const editable = getEditingTextContext()?.editable;
  if (editable) {
    editable.focus({ preventScroll: true });
    if (caret) restoreTextCaretLocation(editable, caret);
    rememberTextSelection();
  }
  return true;
}

function deleteStructuredTextBackward(editable) {
  const selection = window.getSelection();
  if (!selectionBelongsToEditable(selection, editable) || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const selectionElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const line = selectionElement?.closest?.('.text-list-line');
  const content = line?.querySelector('.text-list-content');
  const item = state.items.get(editable.dataset.itemId);
  if (!line || !content || !item || !content.contains(range.startContainer)) return false;

  const offsetRange = document.createRange();
  offsetRange.selectNodeContents(content);
  offsetRange.setEnd(range.startContainer, range.startOffset);
  const column = offsetRange.toString().length;
  const value = getTextListLineValue(content);
  const index = Number(line.dataset.lineIndex) || 0;
  const lines = Array.from(editable.querySelectorAll('.text-list-line'));

  if (column > 0) return false;

  if (index > 0) {
    recordTextEditorHistory(editable);
    const previous = lines[index - 1];
    const previousContent = previous.querySelector('.text-list-content');
    const previousValue = getTextListLineValue(previousContent);
    if (!previousValue) previousContent.replaceChildren();
    Array.from(content.childNodes).forEach((node) => {
      if (!(node.nodeType === Node.ELEMENT_NODE && node.matches('br[data-empty-line]'))) {
        previousContent.appendChild(node);
      }
    });
    ensureTextListLinePlaceholder(previousContent);
    removeStructuredTextLine(item, line, index, editable);
    placeCaretInTextListContent(previousContent, previousValue.length);
    return true;
  }

  if (!value && lines.length > 1) {
    recordTextEditorHistory(editable);
    const nextContent = lines[1].querySelector('.text-list-content');
    removeStructuredTextLine(item, line, index, editable);
    placeCaretInTextListContent(nextContent, 0);
    return true;
  }

  const style = line.dataset.lineStyle || 'none';
  if (style !== 'none') {
    recordTextEditorHistory(editable);
    const styles = normalizeTextLineStyles(item, lines.length);
    styles[0] = 'none';
    item.lineStyles = styles;
    item.completedLines = (item.completedLines || []).filter((lineIndex) => lineIndex !== 0);
    state.items.set(item.id, item);
    renderItem(item);
    const freshEditable = getEditingTextContext()?.editable;
    freshEditable?.focus({ preventScroll: true });
    if (freshEditable) restoreTextCaretLocation(freshEditable, { lineIndex: 0, column: 0 });
    upsertItem(item, { rerender: false, history: false });
    return true;
  }
  return false;
}

function removeStructuredTextLine(item, line, index, editable) {
  const styles = normalizeTextLineStyles(item, editable.querySelectorAll('.text-list-line').length);
  styles.splice(index, 1);
  item.lineStyles = styles;
  item.completedLines = (item.completedLines || [])
    .filter((lineIndex) => lineIndex !== index)
    .map((lineIndex) => (lineIndex > index ? lineIndex - 1 : lineIndex));
  line.remove();
  editable.querySelectorAll('.text-list-line').forEach((entry, nextIndex) => {
    entry.dataset.lineIndex = String(nextIndex);
    if (entry.dataset.lineStyle === 'number') {
      entry.querySelector('.text-list-marker').textContent = `${getVisibleNumberForLine(item, nextIndex)}.`;
    }
  });
}

function insertTextListBreak(editable) {
  const selection = window.getSelection();
  if (selectionBelongsToEditable(selection, editable) && !selection.isCollapsed) deleteStructuredTextSelection(editable);
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const selectionElement =
    range?.startContainer?.nodeType === Node.ELEMENT_NODE ? range.startContainer : range?.startContainer?.parentElement;
  const line = selectionElement?.closest?.('.text-list-line') || editable.querySelector('.text-list-line:last-child');
  const content = line?.querySelector('.text-list-content');
  const item = state.items.get(editable.dataset.itemId);
  if (!range || !line || !content || !item) return insertPlainTextAtSelection(editable, '\n');
  if (!content.contains(range.startContainer))
    placeCaretInTextListContent(content, getTextListLineValue(content).length);
  const activeRange = window.getSelection().getRangeAt(0);
  const caretElement = activeRange.startContainer.nodeType === Node.ELEMENT_NODE
    ? activeRange.startContainer : activeRange.startContainer.parentElement;
  const computed = getComputedStyle(caretElement);
  const caretStyle = {
    color: computed.color, fontSize: parseFloat(computed.fontSize),
    fontFamily: computed.fontFamily,
    bold: Number.parseInt(computed.fontWeight, 10) >= 600 || computed.fontWeight === 'bold',
    ...getTextElementEmphasis(caretElement, editable)
  };
  const tailRange = document.createRange();
  tailRange.setStart(activeRange.startContainer, activeRange.startOffset);
  tailRange.setEnd(content, content.childNodes.length);
  const tail = tailRange.extractContents();
  ensureTextListLinePlaceholder(content);
  const index = Number(line.dataset.lineIndex) || 0;
  const styles = normalizeTextLineStyles(item, editable.querySelectorAll('.text-list-line').length);
  const inheritedStyle = line.dataset.lineStyle || styles[index] || 'none';
  styles.splice(index + 1, 0, inheritedStyle);
  item.lineStyles = styles;
  const next = createTextListLine(item, '', index + 1, inheritedStyle);
  line.after(next);
  const nextContent = next.querySelector('.text-list-content');
  nextContent.replaceChildren(...Array.from(tail.childNodes));
  ensureTextListLinePlaceholder(nextContent);
  if (!getTextListLineValue(nextContent)) {
    const wrapper = createInlineTextFormatWrapper(caretStyle);
    wrapper.append(...Array.from(nextContent.childNodes));
    nextContent.replaceChildren(wrapper);
  }
  editable.querySelectorAll('.text-list-line').forEach((entry, nextIndex) => {
    entry.dataset.lineIndex = String(nextIndex);
    if (entry.dataset.lineStyle === 'number')
      entry.querySelector('.text-list-marker').textContent = `${getVisibleNumberForLine(item, nextIndex)}.`;
  });
  if (Array.isArray(item.completedLines)) {
    item.completedLines = item.completedLines.map((lineIndex) => (lineIndex > index ? lineIndex + 1 : lineIndex));
  }
  placeCaretInTextListContent(nextContent, 0);
}

function deleteStructuredTextSelection(editable) {
  const selection = window.getSelection(), range = selection.getRangeAt(0);
  const lines = [...editable.querySelectorAll('.text-list-line')];
  const selected = lines.filter(line => range.intersectsNode(line.querySelector('.text-list-content')));
  if (!selected.length) return;
  const first = selected[0], last = selected.at(-1);
  const firstContent = first.querySelector('.text-list-content'), lastContent = last.querySelector('.text-list-content');
  if (first === last && firstContent.contains(range.startContainer) && firstContent.contains(range.endContainer)) {
    range.deleteContents(); range.collapse(true);
    return;
  }
  const head = document.createRange(), tail = document.createRange();
  head.selectNodeContents(firstContent); tail.selectNodeContents(lastContent);
  if (firstContent.contains(range.startContainer)) head.setEnd(range.startContainer, range.startOffset);
  else head.collapse(true);
  if (lastContent.contains(range.endContainer)) tail.setStart(range.endContainer, range.endOffset);
  else tail.collapse(false);
  const column = head.toString().length, before = head.cloneContents(), after = tail.cloneContents();
  firstContent.replaceChildren(before, after);
  const item = state.items.get(editable.dataset.itemId);
  // Remove from the end so numbering, list styles and completed indices retain
  // their meaning while a multi-line selection is replaced by one paragraph.
  for (let i = selected.length - 1; i > 0; i--) removeStructuredTextLine(item, selected[i], lines.indexOf(selected[i]), editable);
  ensureTextListLinePlaceholder(firstContent);
  placeCaretInTextListContent(firstContent, column);
}

function ensureTextListLinePlaceholder(content) {
  if (!content || getTextListLineValue(content)) return false;
  if (content.querySelector('br[data-empty-line]')) return false;
  setTextListLineValue(content, '');
  return true;
}

function onTextPaste(event) {
  if (!event.currentTarget.isContentEditable) {
    return;
  }
  event.preventDefault();
  recordTextEditorHistory(event.currentTarget);
  insertStructuredPlainText(event.currentTarget, event.clipboardData?.getData('text/plain') || '');
  dispatchEditableInput(event.currentTarget);
}

function insertStructuredPlainText(editable, text) {
  const selection = window.getSelection();
  if (selectionBelongsToEditable(selection, editable) && !selection.isCollapsed) deleteStructuredTextSelection(editable);
  const parts = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  insertPlainTextAtSelection(editable, parts[0]);
  for (let index = 1; index < parts.length; index += 1) {
    insertTextListBreak(editable);
    insertPlainTextAtSelection(editable, parts[index]);
  }
}

function autosizeTextItem(itemElement, item, editable) {
  if (!itemElement || !item || !['text', 'note'].includes(item.type) || !editable) {
    return;
  }
  if (pendingTextAutosize?.editable === editable) {
    cancelAnimationFrame(textAutosizeFrame);
    textAutosizeFrame = null;
    pendingTextAutosize = null;
  }
  fitNoteToContent(item, editable);
  itemElement.style.width = `${item.w}px`;
  itemElement.style.height = `${item.h}px`;
}

function scheduleTextAutosize(itemElement, item, editable) {
  pendingTextAutosize = { itemElement, item, editable };
  if (textAutosizeFrame !== null) return;
  textAutosizeFrame = requestAnimationFrame(() => {
    textAutosizeFrame = null;
    const pending = pendingTextAutosize;
    pendingTextAutosize = null;
    if (pending?.editable.isConnected && state.items.get(pending.item.id) === pending.item) {
      autosizeTextItem(pending.itemElement, pending.item, pending.editable);
    }
  });
}
export {
  textSelectionSyncFrame,
  textAutosizeFrame,
  pendingTextAutosize,
  lastTextSelectionFormatSignature,
  lastTextSelectionLineSignature,
  rememberTextSelection,
  flushTextSelectionSync,
  restoreTextSelection,
  recordTextEditorHistory,
  onTextBeforeInput,
  onTextKeyDown,
  undoTextEditorHistory,
  deleteStructuredTextBackward,
  removeStructuredTextLine,
  insertTextListBreak,
  ensureTextListLinePlaceholder,
  onTextPaste,
  insertStructuredPlainText,
  autosizeTextItem,
  scheduleTextAutosize
};

export { configureTextInput };
