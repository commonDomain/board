import { DEFAULT_TEXT_BORDER_COLOR, DEFAULT_TEXT_FILL } from './constants.js';
import { normalizeFontFamily, normalizeTextLineStyles } from './format-actions-model.js';
import {
  noteFillTone,
  normalizeTextAppearanceColor,
  normalizeTextBorderStyle,
  normalizeTextFill,
  normalizeTextOpacity
} from './format-panel-model.js';
import { cssColorToHex, matchFontFamily, getTextElementEmphasis } from './text-input-model.js';
import { clamp } from './utilities.js';

// Dark custom fills switch the box's default border and ornaments to light tones.
function textBoxTone(fill) {
  return fill.startsWith('#') ? noteFillTone(fill) : 'light';
}

function applyTextCardAppearance(card, item) {
  const fill = normalizeTextFill(item.textFill);
  const borderColor = normalizeTextAppearanceColor(item.textBorderColor, DEFAULT_TEXT_BORDER_COLOR);
  card.dataset.borderStyle = normalizeTextBorderStyle(item.textBorderStyle);
  card.dataset.fill = fill === 'none' ? 'none' : fill === DEFAULT_TEXT_FILL ? 'default' : 'custom';
  card.dataset.customFill = String(card.dataset.fill === 'custom');
  card.dataset.customBorderColor = String(borderColor !== DEFAULT_TEXT_BORDER_COLOR);
  card.dataset.tone = textBoxTone(fill);
  card.dataset.textShadow = String(item.textShadow !== false);
  card.style.opacity = String(normalizeTextOpacity(item.textOpacity));
  if (card.dataset.fill !== 'custom') card.style.removeProperty('--text-box-fill');
  else card.style.setProperty('--text-box-fill', fill);
  if (borderColor === DEFAULT_TEXT_BORDER_COLOR) card.style.removeProperty('--text-box-border-color');
  else card.style.setProperty('--text-box-border-color', borderColor);
}

function renderTextBorderDecoration(item) {
  const decoration = document.createElement('span');
  decoration.className = 'text-border-decoration';
  decoration.dataset.borderStyle = normalizeTextBorderStyle(item.textBorderStyle);
  decoration.contentEditable = 'false';
  decoration.setAttribute('aria-hidden', 'true');
  decoration.dataset.tone = textBoxTone(normalizeTextFill(item.textFill));
  decoration.style.opacity = String(normalizeTextOpacity(item.textOpacity));
  const borderColor = normalizeTextAppearanceColor(item.textBorderColor, DEFAULT_TEXT_BORDER_COLOR);
  if (borderColor !== DEFAULT_TEXT_BORDER_COLOR) decoration.style.setProperty('--text-box-border-color', borderColor);
  ['top', 'right', 'bottom', 'left'].forEach((side) => {
    const edge = document.createElement('i');
    edge.className = `text-border-edge ${side}`;
    decoration.appendChild(edge);
  });
  ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
    const ornament = document.createElement('i');
    ornament.className = `text-border-corner ${corner}`;
    decoration.appendChild(ornament);
  });
  return decoration;
}

function splitRichTextRunsByLine(item, lineCount) {
  const lines = Array.from({ length: Math.max(1, lineCount) }, () => []);
  const runs = Array.isArray(item.richText) ? item.richText : [];
  const text = String(item.text || '').replace(/\r\n?/g, '\n');
  if (
    !runs.length ||
    runs
      .map((run) => String(run?.text || ''))
      .join('')
      .replace(/\r\n?/g, '\n') !== text
  ) {
    return lines;
  }
  let lineIndex = 0;
  for (const run of runs) {
    const parts = String(run?.text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    parts.forEach((part, partIndex) => {
      if (part && lineIndex < lines.length) lines[lineIndex].push({ ...run, text: part });
      if (partIndex < parts.length - 1) lineIndex += 1;
    });
  }
  return lines;
}

function renderRichTextRuns(container, runs, item) {
  container.replaceChildren();
  for (const run of runs) {
    const text = String(run?.text || '');
    if (!text) continue;
    const span = document.createElement('span');
    span.textContent = text;
    span.style.color = run.color || item.color || '#111111';
    span.style.fontSize = `${clamp(Number(run.fontSize) || item.fontSize || 18, 8, 256)}px`;
    span.style.fontFamily = normalizeFontFamily(run.fontFamily || item.fontFamily);
    span.style.fontWeight = run.bold ? '700' : '400';
    span.style.fontStyle = (run.italic ?? item.italic) ? 'italic' : 'normal';
    span.style.textDecoration = (run.underline ?? item.underline) ? 'underline' : 'none';
    container.appendChild(span);
  }
  if (!container.textContent) setTextListLineValue(container, '');
}

function getTextListLineValue(content) {
  return String(content?.textContent || '').replace(/\u200b/g, '');
}

function setTextListLineValue(content, value) {
  if (!content) return;
  content.replaceChildren();
  const text = String(value || '');
  if (text) {
    content.appendChild(document.createTextNode(text));
    return;
  }
  const placeholder = document.createElement('br');
  placeholder.dataset.emptyLine = '';
  content.appendChild(placeholder);
}

function placeCaretInTextListContent(content, column = 0) {
  const range = document.createRange();
  const walker = content ? document.createTreeWalker(content, NodeFilter.SHOW_TEXT) : null;
  let textNode = walker?.nextNode() || null;
  let remaining = Math.max(0, Number(column) || 0);
  let lastTextNode = null;
  while (textNode) {
    lastTextNode = textNode;
    const length = textNode.nodeValue.length;
    if (remaining <= length) {
      range.setStart(textNode, remaining);
      break;
    }
    remaining -= length;
    textNode = walker.nextNode();
  }
  if (!textNode) {
    if (lastTextNode) range.setStart(lastTextNode, lastTextNode.nodeValue.length);
    else range.setStart(content.querySelector('br[data-empty-line]')?.parentElement || content, 0);
  }
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function getVisibleNumberForLine(item, index) {
  const styles = normalizeTextLineStyles(item, Math.max(index + 1, item?.lineStyles?.length || 0));
  let number = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    if (styles[cursor] === 'number') number += 1;
    else if (cursor < index) number = 0;
  }
  return Math.max(1, number);
}

function createInlineTextFormatWrapper(patch) {
  const wrapper = document.createElement('span');
  if (patch.color) wrapper.style.color = patch.color;
  if (patch.fontSize) wrapper.style.fontSize = `${clamp(Number(patch.fontSize), 8, 256)}px`;
  if (patch.fontFamily) wrapper.style.fontFamily = normalizeFontFamily(patch.fontFamily);
  if (typeof patch.bold === 'boolean') wrapper.style.fontWeight = patch.bold ? '700' : '400';
  if (typeof patch.italic === 'boolean') wrapper.style.fontStyle = patch.italic ? 'italic' : 'normal';
  if (typeof patch.underline === 'boolean') wrapper.style.textDecoration = patch.underline ? 'underline' : 'none';
  return wrapper;
}

function clearOverriddenInlineStyles(fragment, patch) {
  fragment.querySelectorAll?.('[style]').forEach((element) => {
    if (patch.color) element.style.removeProperty('color');
    if (patch.fontSize) element.style.removeProperty('font-size');
    if (patch.fontFamily) element.style.removeProperty('font-family');
    if (typeof patch.bold === 'boolean') element.style.removeProperty('font-weight');
    if (typeof patch.italic === 'boolean') element.style.removeProperty('font-style');
    if (typeof patch.underline === 'boolean') element.style.removeProperty('text-decoration');
    if (!element.getAttribute('style')) element.removeAttribute('style');
  });
}

function applyStructuredInlineTextFormat(editable, sourceRange, patch) {
  const lines = [];
  // Rebuild affected lines as flat runs. In particular, text-decoration:none
  // cannot cancel an underline painted by an ancestor span.
  for (const content of editable.matches('.rich-text-editor') ? [editable] : editable.querySelectorAll('.text-list-content')) {
    const runs = [], walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node, column = 0, start = null, end = null;
    while ((node = walker.nextNode())) {
      const text = node.data.replace(/\u200b/g, '');
      const style = readRichTextStyle(node.parentElement);
      const from = node === sourceRange.startContainer ? sourceRange.startOffset : 0;
      const to = node === sourceRange.endContainer ? sourceRange.endOffset : node.length;
      if (sourceRange.intersectsNode(node) && to > from) {
        const head = node.data.slice(0, from).replace(/\u200b/g, '');
        const selected = node.data.slice(from, to).replace(/\u200b/g, '');
        const tail = node.data.slice(to).replace(/\u200b/g, '');
        appendRichTextRun(runs, { ...style, text: head });
        appendRichTextRun(runs, { ...style, ...patch, text: selected });
        appendRichTextRun(runs, { ...style, text: tail });
        if (selected) { start ??= column + head.length; end = column + head.length + selected.length; }
      } else appendRichTextRun(runs, { ...style, text });
      column += text.length;
    }
    if (start !== null) lines.push({ content, runs, start, end });
  }
  if (!lines.length) return sourceRange;
  for (const { content, runs } of lines) renderRichTextRuns(content, runs, {});
  const first = lines[0], last = lines.at(-1);
  const startRange = placeCaretInTextListContent(first.content, first.start).cloneRange();
  const endRange = placeCaretInTextListContent(last.content, last.end);
  const selectionRange = document.createRange();
  selectionRange.setStart(startRange.startContainer, startRange.startOffset);
  selectionRange.setEnd(endRange.startContainer, endRange.startOffset);
  return selectionRange;
}

function readRichTextStyle(element, item = {}) {
  const computed = getComputedStyle(element);
  return {
    color: cssColorToHex(computed.color) || item.color || '#111111',
    fontSize: clamp(Math.round(parseFloat(computed.fontSize)) || item.fontSize || 18, 8, 256),
    fontFamily: matchFontFamily(computed.fontFamily || item.fontFamily),
    bold: Number.parseInt(computed.fontWeight, 10) >= 600 || computed.fontWeight === 'bold',
    ...getTextElementEmphasis(element)
  };
}

function applyCollapsedInlineTextFormat(editable, range, patch) {
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const content = element.closest('.text-list-content, .rich-text-editor');
  if (!content) return range;
  const head = document.createRange();
  head.selectNodeContents(content);
  head.setEnd(range.startContainer, range.startOffset);
  const column = head.toString().replace(/\u200b/g, '').length;
  const before = [], after = [], style = readRichTextStyle(element);
  let offset = 0;
  for (const run of serializeRichTextRuns(content, {})) {
    const split = clamp(column - offset, 0, run.text.length);
    appendRichTextRun(before, { ...run, text: run.text.slice(0, split) });
    appendRichTextRun(after, { ...run, text: run.text.slice(split) });
    offset += run.text.length;
  }
  const prefix = document.createElement('span'), suffix = document.createElement('span');
  renderRichTextRuns(prefix, before, {});
  renderRichTextRuns(suffix, after, {});
  const wrapper = createInlineTextFormatWrapper({ ...style, ...patch });
  const marker = document.createTextNode('\u200b');
  wrapper.appendChild(marker);
  content.replaceChildren(...(before.length ? prefix.childNodes : []), wrapper, ...(after.length ? suffix.childNodes : []));
  range.setStart(marker, marker.length);
  range.collapse(true);
  return range;
}

function serializeRichTextRuns(editable, item) {
  const runs = [];
  const append = (rawText, element) => {
    const text = String(rawText || '')
      .replace(/\u200b/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n');
    if (!text) {
      return;
    }
    const run = { text, ...readRichTextStyle(element || editable, item) };
    const previous = runs[runs.length - 1];
    if (
      previous &&
      previous.color === run.color &&
      previous.fontSize === run.fontSize &&
      previous.fontFamily === run.fontFamily &&
      previous.bold === run.bold && previous.italic === run.italic && previous.underline === run.underline
    ) {
      previous.text += run.text;
    } else {
      runs.push(run);
    }
  };
  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.nodeValue, node.parentElement || editable);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    if (node.tagName === 'BR') {
      if (node.hasAttribute('data-empty-line')) return;
      if (node.parentElement !== editable && node.parentElement.childNodes.length === 1 && /^(DIV|P|LI)$/.test(node.parentElement.tagName)) return;
      append('\n', node.parentElement || editable);
      return;
    }
    const block = /^(DIV|P|LI)$/.test(node.tagName);
    if (block && node.previousSibling && node.previousSibling.nodeName !== 'BR') {
      append('\n', node);
    }
    Array.from(node.childNodes).forEach(visit);
    if (block && node.nextSibling && !/^(DIV|P|LI)$/.test(node.nextSibling.nodeName)) {
      append('\n', node);
    }
  };
  Array.from(editable.childNodes).forEach(visit);
  return runs;
}

function applyRichTextRangeFormat(editable, range, patch) {
  return range.collapsed ? applyCollapsedInlineTextFormat(editable, range, patch) : applyStructuredInlineTextFormat(editable, range, patch);
}

function matchingRichText(runs, text) {
  return Array.isArray(runs) && runs.map(run => run.text || '').join('') === String(text || '') ? runs : [];
}

function defaultRichTextRun(item) {
  return {
    text: '',
    color: item.color || '#111111',
    fontSize: clamp(Number(item.fontSize) || 18, 8, 256),
    fontFamily: normalizeFontFamily(item.fontFamily),
    bold: Boolean(item.bold), italic: Boolean(item.italic), underline: Boolean(item.underline)
  };
}

function appendRichTextRun(target, run) {
  const text = String(run?.text || '');
  if (!text) return;
  const normalized = {
    text,
    color: run.color || '#111111',
    fontSize: clamp(Number(run.fontSize) || 18, 8, 256),
    fontFamily: normalizeFontFamily(run.fontFamily),
    bold: Boolean(run.bold), italic: Boolean(run.italic), underline: Boolean(run.underline)
  };
  const previous = target[target.length - 1];
  if (
    previous &&
    previous.color === normalized.color &&
    previous.fontSize === normalized.fontSize &&
    previous.fontFamily === normalized.fontFamily &&
    previous.bold === normalized.bold && previous.italic === normalized.italic && previous.underline === normalized.underline
  )
    previous.text += normalized.text;
  else target.push(normalized);
}
export {
  applyTextCardAppearance,
  renderTextBorderDecoration,
  splitRichTextRunsByLine,
  getTextListLineValue,
  setTextListLineValue,
  placeCaretInTextListContent,
  getVisibleNumberForLine,
  createInlineTextFormatWrapper,
  clearOverriddenInlineStyles,
  applyStructuredInlineTextFormat,
  applyCollapsedInlineTextFormat,
  serializeRichTextRuns,
  defaultRichTextRun,
  appendRichTextRun,
  renderRichTextRuns,
  applyRichTextRangeFormat,
  matchingRichText
};
