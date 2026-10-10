import { snapshotItems } from './history-controller-model.js';
import { onTextPointerDown, onTextPointerUp } from './editing.js';
import { saveTextSelection } from './floating-toolbar-position-model.js';
import { normalizeFontFamily, normalizeTextLineStyles } from './format-actions-model.js';
import { normalizeNoteFill } from './format-panel-model.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';
import { markDirty } from './save-status.js';
import { state } from './state.js';
import {
  autosizeTextItem,
  onTextBeforeInput,
  onTextKeyDown,
  onTextPaste,
  recordTextEditorHistory,
  restoreTextSelection
} from './text-input.js';
import { getEditingTextContext, selectionBelongsToEditable } from './text-input-model.js';
import { clamp, placeCursorAtEnd } from './utilities.js';
import {
  applyTextCardAppearance,
  splitRichTextRunsByLine,
  setTextListLineValue,
  getVisibleNumberForLine,
  createInlineTextFormatWrapper,
  clearOverriddenInlineStyles,
  applyStructuredInlineTextFormat,
  serializeRichTextRuns,
  defaultRichTextRun,
  appendRichTextRun,
  renderRichTextRuns
} from './text-rendering-model.js';

function renderTextCard(item) {
  const card = document.createElement('div');
  card.className = item.type === 'note' ? 'note-card' : 'text-card';
  card.contentEditable = state.editingId === item.id ? 'true' : 'false';
  card.spellcheck = false;
  card.dataset.itemId = item.id;
  card.dataset.itemType = item.type;
  card.dataset.placeholder = item.type === 'note' ? '便签' : '文本';
  card.style.color = item.color || '#111111';
  card.style.fontSize = `${item.fontSize || 18}px`;
  card.style.fontFamily = normalizeFontFamily(item.fontFamily);
  card.style.fontWeight = item.bold ? '700' : '400';
  card.style.fontStyle = item.italic ? 'italic' : 'normal';
  card.style.textDecoration = item.underline ? 'underline' : 'none';
  card.style.textAlign = item.align || 'left';
  if (item.type === 'text') applyTextCardAppearance(card, item);
  if (item.type === 'note') {
    card.style.setProperty('--note-fill', normalizeNoteFill(item.noteFill));
    card.style.opacity = String(clamp(Number.isFinite(Number(item.noteOpacity)) ? Number(item.noteOpacity) : 1, 0, 1));
    card.dataset.noteBorder = item.noteBorder === 'solid' ? 'solid' : 'none';
    card.dataset.noteShadow = String(item.noteShadow !== false);
  }
  const lineStyles = normalizeTextLineStyles(item);
  card.dataset.structuredLines = 'true';
  renderTextListContent(card, item, lineStyles);
  card.addEventListener('pointerdown', onTextPointerDown);
  card.addEventListener('pointerup', onTextPointerUp);
  card.addEventListener('keydown', onTextKeyDown);
  card.addEventListener('beforeinput', onTextBeforeInput);
  card.addEventListener('paste', onTextPaste);
  return card;
}

function renderTextListContent(card, item, lineStyles = normalizeTextLineStyles(item)) {
  const lines = String(item.text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const richTextLines = splitRichTextRunsByLine(item, lines.length);
  lines.forEach((line, index) =>
    card.appendChild(createTextListLine(item, line, index, lineStyles[index], richTextLines[index]))
  );
}

function createTextListLine(
  item,
  text,
  index,
  style = normalizeTextLineStyles(item)[index] || 'none',
  richTextRuns = null
) {
  const line = document.createElement('div');
  line.className = 'text-list-line';
  line.dataset.lineIndex = String(index);
  line.dataset.lineStyle = style;
  const marker = document.createElement(style === 'todo' ? 'button' : 'span');
  marker.className = 'text-list-marker';
  marker.contentEditable = 'false';
  marker.dataset.listMarker = '';
  if (style === 'number') marker.textContent = `${getVisibleNumberForLine(item, index)}.`;
  if (style === 'bullet') marker.textContent = '•';
  if (style === 'todo') {
    marker.type = 'button';
    const completed = Array.isArray(item.completedLines) && item.completedLines.includes(index);
    marker.classList.toggle('is-complete', completed);
    marker.setAttribute('aria-label', completed ? '标记为未完成' : '标记为已完成');
    marker.setAttribute('aria-pressed', String(completed));
    marker.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    marker.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTodoLine(item.id, index, marker);
    });
    line.classList.toggle('is-complete', completed);
  }
  const content = document.createElement('span');
  content.className = 'text-list-content';
  if (Array.isArray(richTextRuns) && richTextRuns.length) renderRichTextRuns(content, richTextRuns, item);
  else setTextListLineValue(content, text);
  line.append(marker, content);
  return line;
}

function toggleTodoLine(itemId, index, marker) {
  const item = state.items.get(itemId);
  if (!canMutateItem(item) || normalizeTextLineStyles(item)[index] !== 'todo') return;
  const beforeItems = snapshotItems();
  const completed = new Set(Array.isArray(item.completedLines) ? item.completedLines : []);
  if (completed.has(index)) completed.delete(index);
  else completed.add(index);
  item.completedLines = Array.from(completed).sort((a, b) => a - b);
  state.items.set(item.id, item);
  marker.classList.toggle('is-complete', completed.has(index));
  marker.closest('.text-list-line')?.classList.toggle('is-complete', completed.has(index));
  marker.setAttribute('aria-pressed', String(completed.has(index)));
  marker.setAttribute('aria-label', completed.has(index) ? '标记为未完成' : '标记为已完成');
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
}

function applyInlineTextFormat(patch) {
  const context = getEditingTextContext();
  if (!context || !canMutateItem(context.item)) {
    return false;
  }
  context.editable.focus({ preventScroll: true });
  if (!restoreTextSelection(context.editable)) {
    placeCursorAtEnd(context.editable);
  }
  const selection = window.getSelection();
  if (!selectionBelongsToEditable(selection, context.editable)) {
    return false;
  }
  recordTextEditorHistory(context.editable);
  let range = selection.getRangeAt(0);
  if (context.editable.dataset.structuredLines === 'true' && !range.collapsed) {
    range = applyStructuredInlineTextFormat(context.editable, range, patch);
  } else {
    const wrapper = createInlineTextFormatWrapper(patch);
    if (range.collapsed) {
      const marker = document.createTextNode('\u200b');
      wrapper.appendChild(marker);
      range.insertNode(wrapper);
      range.setStart(marker, marker.length);
      range.collapse(true);
    } else {
      const fragment = range.extractContents();
      clearOverriddenInlineStyles(fragment, patch);
      wrapper.appendChild(fragment);
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
    }
  }
  selection.removeAllRanges();
  selection.addRange(range);
  Object.assign(context.item, patch);
  syncTextItemFromDom(context.root, context.item, context.editable);
  state.items.set(context.item.id, context.item);
  autosizeTextItem(context.root, context.item, context.editable);
  upsertItem(context.item, { rerender: false, history: false });
  saveTextSelection(context.item.id, range, selection);
  markDirty(true);
  return true;
}

function syncTextItemFromDom(itemElement, item, editable, { autosize = true } = {}) {
  if (editable.dataset.structuredLines === 'true') {
    const lineElements = Array.from(editable.querySelectorAll('.text-list-line'));
    const lineRuns = lineElements.map((line) => serializeRichTextRuns(line.querySelector('.text-list-content'), item));
    const lineTexts = lineRuns.map((runs) => runs.map((run) => run.text).join(''));
    item.lineStyles = lineElements.map((line) => line.dataset.lineStyle || 'none');
    item.listMode = 'none';
    item.completedLines = Array.isArray(item.completedLines)
      ? item.completedLines.filter((index) => item.lineStyles[index] === 'todo')
      : [];
    item.text = lineTexts.join('\n');
    item.richText = [];
    lineRuns.forEach((runs, lineIndex) => {
      runs.forEach((run) => appendRichTextRun(item.richText, run));
      if (lineIndex < lineRuns.length - 1) {
        const styleSource = runs[runs.length - 1] || lineRuns[lineIndex + 1]?.[0] || defaultRichTextRun(item);
        appendRichTextRun(item.richText, { ...styleSource, text: '\n' });
      }
    });
    if (autosize) autosizeTextItem(itemElement, item, editable);
    return;
  }
  const runs = serializeRichTextRuns(editable, item);
  item.richText = runs;
  item.text = runs.map((run) => run.text).join('');
  if (autosize) autosizeTextItem(itemElement, item, editable);
}
export {
  renderTextCard,
  renderTextListContent,
  createTextListLine,
  toggleTodoLine,
  applyInlineTextFormat,
  syncTextItemFromDom
};
