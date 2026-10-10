import { TEXT_FONT_FAMILIES } from './constants.js';
import { saveTextSelection } from './floating-toolbar-position-model.js';
import { state } from './state.js';
import { clamp, cssEscape, placeCursorAtEnd } from './utilities.js';

function getEditingTextContext() {
  const item = state.editingId ? state.items.get(state.editingId) : null;
  if (!item || (item.type !== 'text' && item.type !== 'note')) {
    return null;
  }
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  const editable = root?.querySelector('.text-card[contenteditable="true"], .note-card[contenteditable="true"]');
  return root && editable ? { item, root, editable } : null;
}

function selectionBelongsToEditable(selection, editable) {
  if (!selection?.rangeCount || !editable) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return editable.contains(range.startContainer) && editable.contains(range.endContainer);
}

function matchFontFamily(value) {
  const candidate = String(value || '').toLowerCase();
  const match = TEXT_FONT_FAMILIES.find(({ value: family }) => {
    const primary = family.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    return candidate.includes(primary);
  });
  return match?.value || TEXT_FONT_FAMILIES[0].value;
}

function cssColorToHex(value) {
  const hex = String(value || '').match(/^#([a-f0-9]{6})$/i);
  if (hex) {
    return `#${hex[1].toLowerCase()}`;
  }
  const rgb = String(value || '').match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (!rgb) {
    return null;
  }
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => clamp(Number(part), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function insertPlainTextAtSelection(editable, text) {
  const selection = window.getSelection();
  if (!selectionBelongsToEditable(selection, editable)) {
    placeCursorAtEnd(editable);
  }
  const activeSelection = window.getSelection();
  const range = activeSelection.getRangeAt(0);
  range.deleteContents();
  const value = String(text || '').replace(/\r\n?/g, '\n');
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  if (value) startElement?.closest?.('.text-list-content')?.querySelector('br[data-empty-line]')?.remove();
  const textNode = document.createTextNode(value);
  range.insertNode(textNode);
  range.setStart(textNode, textNode.length);
  range.collapse(true);
  activeSelection.removeAllRanges();
  activeSelection.addRange(range);
  saveTextSelection(state.editingId, range, activeSelection);
}

function dispatchEditableInput(editable) {
  editable.dispatchEvent(new Event('input', { bubbles: true }));
}
export {
  getEditingTextContext,
  selectionBelongsToEditable,
  matchFontFamily,
  cssColorToHex,
  insertPlainTextAtSelection,
  dispatchEditableInput
};
