import { DEFAULT_TEXT_BORDER_COLOR, DEFAULT_TEXT_FILL } from './constants.js';
import { normalizeFontFamily, normalizeTextLineStyles } from './format-actions-model.js';
import { normalizeTextAppearanceColor, normalizeTextBorderStyle } from './format-panel-model.js';
import { cssColorToHex, matchFontFamily } from './text-input-model.js';
import { clamp } from './utilities.js';

function applyTextCardAppearance(card, item) {
  const fill = normalizeTextAppearanceColor(item.textFill, DEFAULT_TEXT_FILL);
  const borderColor = normalizeTextAppearanceColor(item.textBorderColor, DEFAULT_TEXT_BORDER_COLOR);
  card.dataset.borderStyle = normalizeTextBorderStyle(item.textBorderStyle);
  card.dataset.customFill = String(fill !== DEFAULT_TEXT_FILL);
  card.dataset.customBorderColor = String(borderColor !== DEFAULT_TEXT_BORDER_COLOR);
  if (fill === DEFAULT_TEXT_FILL) card.style.removeProperty('--text-box-fill');
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
    else range.setStart(content, 0);
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
  return wrapper;
}

function clearOverriddenInlineStyles(fragment, patch) {
  fragment.querySelectorAll?.('[style]').forEach((element) => {
    if (patch.color) element.style.removeProperty('color');
    if (patch.fontSize) element.style.removeProperty('font-size');
    if (patch.fontFamily) element.style.removeProperty('font-family');
    if (typeof patch.bold === 'boolean') element.style.removeProperty('font-weight');
    if (!element.getAttribute('style')) element.removeAttribute('style');
  });
}

function applyStructuredInlineTextFormat(editable, sourceRange, patch) {
  const segments = [];
  editable.querySelectorAll('.text-list-content').forEach((content) => {
    let intersects = false;
    try {
      intersects = sourceRange.intersectsNode(content);
    } catch {}
    if (!intersects) return;
    const range = document.createRange();
    if (content.contains(sourceRange.startContainer)) {
      range.setStart(sourceRange.startContainer, sourceRange.startOffset);
    } else {
      range.setStart(content, 0);
    }
    if (content.contains(sourceRange.endContainer)) {
      range.setEnd(sourceRange.endContainer, sourceRange.endOffset);
    } else {
      range.setEnd(content, content.childNodes.length);
    }
    if (!range.collapsed && range.toString()) segments.push({ range, wrapper: createInlineTextFormatWrapper(patch) });
  });
  if (!segments.length) return sourceRange;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const { range, wrapper } = segments[index];
    const fragment = range.extractContents();
    clearOverriddenInlineStyles(fragment, patch);
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);
  }
  const selectionRange = document.createRange();
  selectionRange.setStart(segments[0].wrapper, 0);
  const lastWrapper = segments[segments.length - 1].wrapper;
  selectionRange.setEnd(lastWrapper, lastWrapper.childNodes.length);
  return selectionRange;
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
    const computed = getComputedStyle(element || editable);
    const run = {
      text,
      color: cssColorToHex(computed.color) || item.color || '#111111',
      fontSize: clamp(Math.round(parseFloat(computed.fontSize)) || item.fontSize || 18, 8, 256),
      fontFamily: matchFontFamily(computed.fontFamily || item.fontFamily),
      bold: Number.parseInt(computed.fontWeight, 10) >= 600 || computed.fontWeight === 'bold'
    };
    const previous = runs[runs.length - 1];
    if (
      previous &&
      previous.color === run.color &&
      previous.fontSize === run.fontSize &&
      previous.fontFamily === run.fontFamily &&
      previous.bold === run.bold
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
      append('\n', node.parentElement || editable);
      return;
    }
    const block = /^(DIV|P|LI)$/.test(node.tagName);
    if (block && runs.length && !runs[runs.length - 1].text.endsWith('\n')) {
      append('\n', node);
    }
    Array.from(node.childNodes).forEach(visit);
    if (block && runs.length && !runs[runs.length - 1].text.endsWith('\n')) {
      append('\n', node);
    }
  };
  Array.from(editable.childNodes).forEach(visit);
  if (runs.length && runs[runs.length - 1].text.endsWith('\n') && editable.lastElementChild) {
    runs[runs.length - 1].text = runs[runs.length - 1].text.slice(0, -1);
    if (!runs[runs.length - 1].text) runs.pop();
  }
  return runs;
}

function defaultRichTextRun(item) {
  return {
    text: '',
    color: item.color || '#111111',
    fontSize: clamp(Number(item.fontSize) || 18, 8, 256),
    fontFamily: normalizeFontFamily(item.fontFamily),
    bold: Boolean(item.bold)
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
    bold: Boolean(run.bold)
  };
  const previous = target[target.length - 1];
  if (
    previous &&
    previous.color === normalized.color &&
    previous.fontSize === normalized.fontSize &&
    previous.fontFamily === normalized.fontFamily &&
    previous.bold === normalized.bold
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
  serializeRichTextRuns,
  defaultRichTextRun,
  appendRichTextRun,
  renderRichTextRuns
};
