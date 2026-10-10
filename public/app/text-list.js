import { snapshotItems } from './history-controller-model.js';
import { els } from './elements.js';
import { saveTextSelection } from './floating-toolbar-position-model.js';
import { updateContextPanel } from './format-panel.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';
import { renderItem } from './rendering.js';
import { state } from './state.js';
import { getEditingTextContext, selectionBelongsToEditable } from './text-input-model.js';
import { syncTextItemFromDom } from './text-rendering.js';
import { placeCaretInTextListContent } from './text-rendering-model.js';
import { clamp, cssEscape, placeCursorAtEnd } from './utilities.js';
import { getFormatTarget, getTextLineStyleAt, normalizeTextLineStyles } from './format-actions-model.js';

function toggleTextListMode(mode) {
  if (!['number', 'bullet', 'todo'].includes(mode)) return;
  const item = getFormatTarget();
  if (!canMutateItem(item) || (item.type !== 'text' && item.type !== 'note')) return;
  const context = getEditingTextContext();
  const caret = context?.item.id === item.id ? getTextCaretLocation(context.editable) : { lineIndex: 0, column: 0 };
  if (context?.item.id === item.id) syncTextItemFromDom(context.root, item, context.editable);
  const beforeItems = snapshotItems();
  const lineCount = Math.max(1, String(item.text || '').split('\n').length);
  const styles = normalizeTextLineStyles(item, lineCount);
  const lineIndex = clamp(caret.lineIndex, 0, lineCount - 1);
  styles[lineIndex] = styles[lineIndex] === mode ? 'none' : mode;
  item.lineStyles = styles;
  item.listMode = 'none';
  if (styles[lineIndex] !== 'todo' && Array.isArray(item.completedLines)) {
    item.completedLines = item.completedLines.filter((index) => index !== lineIndex);
  }
  state.items.set(item.id, item);
  renderItem(item);
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
  if (state.editingId === item.id) {
    const editable = document.querySelector(
      `.board-item[data-item-id="${cssEscape(item.id)}"] .text-card, .board-item[data-item-id="${cssEscape(item.id)}"] .note-card`
    );
    requestAnimationFrame(() => {
      editable?.focus({ preventScroll: true });
      if (editable) {
        restoreTextCaretLocation(editable, caret);
        updateTextListControls(item, caret);
      }
    });
  } else {
    updateContextPanel();
  }
}

function getTextCaretLocation(editable) {
  if (!editable) return { lineIndex: 0, column: 0 };
  const itemId = editable.dataset.itemId || state.editingId;
  const selection = window.getSelection();
  let range = selectionBelongsToEditable(selection, editable) ? selection.getRangeAt(0) : null;
  if (!range && state.textSelection?.itemId === state.editingId) {
    try {
      range = state.textSelection.range.cloneRange();
    } catch {}
  }
  if (!range || !editable.contains(range.startContainer)) {
    return state.activeTextLine?.itemId === itemId
      ? {
          lineIndex: state.activeTextLine.lineIndex,
          column: state.activeTextLine.column || 0
        }
      : { lineIndex: 0, column: 0 };
  }
  const selectionElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const line = selectionElement?.closest?.('.text-list-line');
  if (line) {
    const content = line.querySelector('.text-list-content');
    const offsetRange = document.createRange();
    offsetRange.selectNodeContents(content);
    if (content.contains(range.startContainer)) offsetRange.setEnd(range.startContainer, range.startOffset);
    const caret = {
      lineIndex: Number(line.dataset.lineIndex) || 0,
      column: offsetRange.toString().replace(/\u200b/g, '').length
    };
    state.activeTextLine = { itemId, ...caret };
    return caret;
  }
  const offsetRange = document.createRange();
  offsetRange.selectNodeContents(editable);
  offsetRange.setEnd(range.startContainer, range.startOffset);
  const before = offsetRange
    .toString()
    .replace(/\r\n?/g, '\n')
    .replace(/\u200b/g, '');
  const parts = before.split('\n');
  const caret = {
    lineIndex: parts.length - 1,
    column: parts[parts.length - 1].length
  };
  state.activeTextLine = { itemId, ...caret };
  return caret;
}

function restoreTextCaretLocation(editable, caret) {
  const lines = editable.querySelectorAll('.text-list-line');
  if (!lines.length) return placeCursorAtEnd(editable);
  const line = lines[clamp(caret.lineIndex, 0, lines.length - 1)];
  const content = line.querySelector('.text-list-content');
  const range = placeCaretInTextListContent(content, caret.column);
  saveTextSelection(state.editingId, range);
  state.activeTextLine = {
    itemId: state.editingId,
    lineIndex: Number(line.dataset.lineIndex) || 0,
    column: caret.column
  };
}

function getActiveTextLineStyle(item) {
  const context = getEditingTextContext();
  const caret = context?.item.id === item.id ? getTextCaretLocation(context.editable) : { lineIndex: 0 };
  return getTextLineStyleAt(item, caret.lineIndex);
}

function updateTextListControls(item, caret = null) {
  const listSection = els.contextPanel?.querySelector('#contextListSection');
  if (!item) return;
  const lineIndex =
    state.activeTextLine?.itemId === item.id
      ? state.activeTextLine.lineIndex
      : (caret?.lineIndex ?? getTextCaretLocation(getEditingTextContext()?.editable).lineIndex);
  const activeLineStyle = getTextLineStyleAt(item, lineIndex);
  for (const root of [listSection && !listSection.hidden ? listSection : null, els.floatingFormatBar]) {
    root?.querySelectorAll('[data-list-mode]').forEach((button) => {
      const active = button.dataset.listMode === activeLineStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
}
export {
  toggleTextListMode,
  getTextCaretLocation,
  restoreTextCaretLocation,
  getActiveTextLineStyle,
  updateTextListControls
};
