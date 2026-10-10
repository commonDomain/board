import { snapshotItems } from './history-controller-model.js';

import {
  DEFAULT_TEXT_BORDER_COLOR,
  DEFAULT_TEXT_FILL,
  PALETTE_COLORS,
  SHAPES,
  TABLE_EDIT_MIN_ZOOM,
  TEXT_BORDER_STYLES,
  TEXT_DECORATIVE_BORDER_STYLES,
  TEXT_FONT_FAMILIES
} from './constants.js';
import { els } from './elements.js';

import { normalizeNoteFill, normalizeTextAppearanceColor, normalizeTextBorderStyle } from './format-panel-model.js';

import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';

import { state } from './state.js';
import { cssColorToHex } from './text-input-model.js';

import { applyTextCardAppearance, renderTextBorderDecoration } from './text-rendering-model.js';
import { clamp, cssEscape } from './utilities.js';
import { getBrush, normalizeFontFamily, getFormatTarget, updateFormatControls, selectedFormatItems } from './format-actions-model.js';

let updateBrushFeedback,
  setZoom,
  getSelectedOrEditingItem,
  updateContextPanel,
  updateTextAppearanceControls,
  cancelActiveGesture,
  renderItem,
  applyInlineTextFormat,
  applyMindNodeTextFormat;

function configureFormatActions(callbacks) {
  ({
    updateBrushFeedback,
    setZoom,
    getSelectedOrEditingItem,
    updateContextPanel,
    updateTextAppearanceControls,
    cancelActiveGesture,
    renderItem,
    applyInlineTextFormat,
    applyMindNodeTextFormat
  } = callbacks);
}

function ensureEditableZoom(anchor = null, item = getSelectedOrEditingItem()) {
  let minimum = TABLE_EDIT_MIN_ZOOM;
  if (item?.type === 'text') {
    minimum = clamp(16 / Math.max(8, Number(item.fontSize) || 18), TABLE_EDIT_MIN_ZOOM, 1.25);
  } else if (item?.type === 'note') {
    minimum = 0.62;
  } else if (item?.type === 'mindmap') {
    minimum = 0.72;
  }
  if (state.zoom >= minimum) return false;
  setZoom(minimum, anchor);
  return true;
}

function toggleConnectorOption(option) {
  const item = getSelectedOrEditingItem();
  if (!canMutateItem(item) || item.type !== 'connector') {
    return;
  }
  const beforeItems = snapshotItems();
  if (option === 'arrowStart') {
    item.arrowStart = !item.arrowStart;
  } else if (option === 'arrowEnd') {
    item.arrowEnd = !item.arrowEnd;
  } else if (option === 'dash') {
    item.dasharray = item.dasharray ? '' : '6 4';
  }
  state.items.set(item.id, item);
  renderItem(item);
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
  updateContextPanel();
}

function buildColorPalette(container) {
  if (!container) {
    return;
  }
  container.textContent = '';
  PALETTE_COLORS.forEach((color) => {
    const button = document.createElement('button');
    button.className = 'color-swatch';
    button.type = 'button';
    button.dataset.color = color;
    button.title = color;
    button.setAttribute('aria-label',`选择颜色 ${color.toUpperCase()}`);
    button.style.backgroundColor = color;
    button.addEventListener('click', () => setColor(color));
    container.appendChild(button);
  });
}

function setBrush(brushId) {
  const brush = getBrush(brushId);
  if (brush.id !== state.brushType) {
    cancelActiveGesture();
  }
  state.brushType = brush.id;
  if (els.brushLabel) {
    els.brushLabel.textContent = brush.name;
  }
  document.querySelectorAll('[data-brush]').forEach((button) => {
    button.classList.toggle('active', button.dataset.brush === brush.id);
  });
}

function setShape(shapeId) {
  const shape = SHAPES.find((item) => item.id === shapeId) || SHAPES[0];
  if (shape.id !== state.shapeType) {
    cancelActiveGesture();
  }
  state.shapeType = shape.id;
  if (els.shapeLabel) {
    els.shapeLabel.textContent = '图形';
  }
  document.querySelectorAll('[data-shape]').forEach((button) => {
    button.classList.toggle('active', button.dataset.shape === shape.id);
  });
}

function comparableColor(value) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  if (!candidate || candidate === 'default') return '';
  return cssColorToHex(candidate)?.toLowerCase() || candidate;
}

function textFillConflictsWithColor(item, color) {
  if (!item || item.type !== 'text') return false;
  const fill = comparableColor(item.textFill);
  return Boolean(fill && fill === comparableColor(color));
}

function textFillConflictsWithItem(item, fill) {
  const normalizedFill = comparableColor(fill);
  if (!normalizedFill || !item) return false;
  const colors = new Set(
    [item.color, ...(item.richText || []).map((run) => run?.color)].map(comparableColor).filter(Boolean)
  );
  return colors.has(normalizedFill);
}

function setColor(color, options = {}) {
  if (typeof color !== 'string' || !window.CSS?.supports?.('color', color)) {
    return false;
  }
  const formatTarget = options.applyToSelection === false ? null : getFormatTarget();
  if (options.applyToSelection !== false && textFillConflictsWithColor(formatTarget, color)) {
    showToast('文字颜色不能与文本框底色相同');
    updateContextPanel();
    return false;
  }
  state.color = color;
  state.customColorSelected = Boolean(options.custom);
  document.querySelectorAll('input[data-color-picker]').forEach((picker) => {
    if (picker.value.toLowerCase() !== color.toLowerCase()) {
      picker.value = color;
    }
  });
  document.querySelectorAll('[data-color]').forEach((button) => {
    button.classList.toggle('active', button.dataset.color.toLowerCase() === color.toLowerCase());
  });
  updateBrushFeedback();
  if (options.applyToSelection !== false) {
    if (!applyMindNodeTextFormat({ color })) applyColorToActiveItem(color);
  }
  return true;
}

function patchRenderedFormattingItem(item) {
  if (!item) return false;
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  if (!root) return false;
  if (item.type === 'text' || item.type === 'note') {
    const card = root.querySelector(item.type === 'note' ? '.note-card' : '.text-card');
    if (!card) return false;
    card.style.color = item.color || '#111111';
    card.style.fontSize = `${item.fontSize || 18}px`;
    card.style.fontFamily = normalizeFontFamily(item.fontFamily);
    card.style.fontWeight = item.bold ? '700' : '400';
    card.style.fontStyle = item.italic ? 'italic' : 'normal';
    card.style.textDecoration = item.underline ? 'underline' : 'none';
    card.style.textAlign = item.align || 'left';
    card.querySelectorAll('.text-list-content > span').forEach((span) => {
      span.style.color = item.color || '#111111';
      span.style.fontSize = `${item.fontSize || 18}px`;
      span.style.fontFamily = normalizeFontFamily(item.fontFamily);
      span.style.fontWeight = item.bold ? '700' : '400';
    });
    if (item.type === 'text') applyTextCardAppearance(card, item);
    if (item.type === 'note') {
      card.style.setProperty('--note-fill', normalizeNoteFill(item.noteFill));
      card.style.opacity = String(
        clamp(Number.isFinite(Number(item.noteOpacity)) ? Number(item.noteOpacity) : 1, 0, 1)
      );
      card.dataset.noteBorder = item.noteBorder === 'solid' ? 'solid' : 'none';
      card.dataset.noteShadow = String(item.noteShadow !== false);
    }
    return true;
  }
  if (item.type === 'table') {
    const table = root.querySelector('.board-table');
    if (!table) return false;
    table.style.fontSize = `${item.fontSize || 15}px`;
    table.style.fontFamily = normalizeFontFamily(item.fontFamily);
    table.style.fontWeight = item.bold ? '700' : '400';
    table.querySelectorAll('td, th').forEach((cell) => {
      cell.style.color = item.color || '#111111';
      cell.style.textAlign = item.align || 'left';
    });
    return true;
  }
  return false;
}

function applyTextBoxAppearance(patch) {
  const item = getFormatTarget();
  if (!canMutateItem(item) || item.type !== 'text') return false;
  const beforeItems = snapshotItems();
  Object.assign(item, patch);
  state.items.set(item.id, item);
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  if (root && patchRenderedFormattingItem(item)) {
    const card = root.querySelector('.text-card');
    root.querySelector('.text-border-decoration')?.remove();
    if (TEXT_DECORATIVE_BORDER_STYLES.has(normalizeTextBorderStyle(item.textBorderStyle))) {
      root.appendChild(renderTextBorderDecoration(item));
    }
  } else {
    renderItem(item);
  }
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
  updateContextPanel();
  return true;
}

function setTextBoxFill(color) {
  const item = getFormatTarget();
  const normalized = normalizeTextAppearanceColor(color, '');
  if (!normalized || normalized === 'default' || !item || item.type !== 'text') return false;
  if (textFillConflictsWithItem(item, normalized)) {
    showToast('底色不能与文字颜色相同');
    updateTextAppearanceControls(item);
    return false;
  }
  return applyTextBoxAppearance({ textFill: normalized });
}

function setTextBoxBorderColor(color) {
  const normalized = normalizeTextAppearanceColor(color, '');
  if (!normalized || normalized === 'default') return false;
  return applyTextBoxAppearance({ textBorderColor: normalized });
}

function setTextBoxBorderStyle(style) {
  if (!TEXT_BORDER_STYLES.has(style)) return false;
  return applyTextBoxAppearance({ textBorderStyle: style });
}

function resetTextBoxAppearance(kind) {
  if (kind === 'fill') return applyTextBoxAppearance({ textFill: DEFAULT_TEXT_FILL });
  if (kind === 'border') {
    return applyTextBoxAppearance({
      textBorderColor: DEFAULT_TEXT_BORDER_COLOR,
      textBorderStyle: 'solid'
    });
  }
  return false;
}

function applyColorToActiveItem(color) {
  const activeId = state.editingId || state.selectedId;
  if (!activeId) {
    return;
  }
  const item = state.items.get(activeId);
  if (!canMutateItem(item)) {
    return;
  }
  if (!['text', 'note', 'table', 'sticker', 'shape', 'connector'].includes(item.type)) {
    return;
  }
  if (state.editingId === item.id && (item.type === 'text' || item.type === 'note')) {
    applyInlineTextFormat({ color });
    return;
  }
  const beforeItems = snapshotItems();
  if (item.type === 'shape' || item.type === 'connector') {
    item.stroke = color;
    if (item.type === 'connector' && item.style) item.style.color = color;
  } else {
    item.color = color;
    if ((item.type === 'text' || item.type === 'note') && Array.isArray(item.richText)) {
      item.richText = item.richText.map((run) => ({ ...run, color }));
    }
  }
  state.items.set(item.id, item);
  if (!patchRenderedFormattingItem(item)) {
    renderItem(item);
    if (state.selectedId === item.id) {
      const selectedRoot = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
      if (selectedRoot) {
        selectedRoot.classList.add('selected');
      }
    }
  }
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
}

function applyTextFormatToItem(item, patch) {
  if (!item || (state.editingId && !canMutateItem(item))) {
    return;
  }
  const beforeItems = snapshotItems();
  const items = state.editingId ? [item] : selectedFormatItems().filter(canMutateItem);
  for (const [index,current] of (items.length ? items : canMutateItem(item) ? [item] : []).entries()) {
  item = current;
  Object.assign(item, patch);
  if ((item.type === 'text' || item.type === 'note') && Array.isArray(item.richText)) {
    const inlinePatch = {};
    for (const key of ['color', 'fontSize', 'fontFamily', 'bold']) {
      if (Object.hasOwn(patch, key)) {
        inlinePatch[key] = patch[key];
      }
    }
    if (Object.keys(inlinePatch).length) {
      item.richText = item.richText.map((run) => ({ ...run, ...inlinePatch }));
    }
  }
  state.items.set(item.id, item);
  if (!patchRenderedFormattingItem(item)) {
    renderItem(item);
  }
  upsertItem(item, { rerender: false, history:index===0, historySnapshot: beforeItems });
  }
  updateFormatControls();
}

function setFontSize(value) {
  state.fontSize = clamp(Number(value) || 18, 10, 96);
  updateFormatControls();
  if (applyMindNodeTextFormat({ fontSize: state.fontSize })) return;
  const item = getFormatTarget();
  if (item) {
    if (state.editingId === item.id && (item.type === 'text' || item.type === 'note')) {
      applyInlineTextFormat({ fontSize: state.fontSize });
    } else {
      applyTextFormatToItem(item, { fontSize: state.fontSize });
    }
  }
}

function setFontFamily(value) {
  state.fontFamily = normalizeFontFamily(value);
  updateFormatControls();
  if (applyMindNodeTextFormat({ fontFamily: state.fontFamily })) return;
  const item = getFormatTarget();
  if (item) {
    if (state.editingId === item.id && (item.type === 'text' || item.type === 'note')) {
      applyInlineTextFormat({ fontFamily: state.fontFamily });
    } else {
      applyTextFormatToItem(item, { fontFamily: state.fontFamily });
    }
  }
}

function toggleBold() {
  const items=selectedFormatItems();
  state.bold = !state.editingId && items.length>1 ? !items.every(item=>item.bold) : !state.bold;
  updateFormatControls();
  if (applyMindNodeTextFormat({ fontWeight: state.bold ? 'bold' : null })) return;
  const item = getFormatTarget();
  if (item) {
    if (state.editingId === item.id && (item.type === 'text' || item.type === 'note')) {
      applyInlineTextFormat({ bold: state.bold });
    } else {
      applyTextFormatToItem(item, { bold: state.bold });
    }
  }
}

function setTextAlign(align) {
  if (!['left', 'center', 'right'].includes(align)) {
    return;
  }
  state.align = align;
  updateFormatControls();
  if (applyMindNodeTextFormat({ textAlign: align })) return;
  const item = getFormatTarget();
  if (item) {
    applyTextFormatToItem(item, { align });
  }
}

function resetTextFormatting() {
  const defaults = {
    color: '#111111',
    fontSize: 18,
    fontFamily: TEXT_FONT_FAMILIES[0].value,
    bold: false,
    align: 'left'
  };
  state.fontSize = defaults.fontSize;
  state.fontFamily = defaults.fontFamily;
  state.bold = defaults.bold;
  state.align = defaults.align;
  setColor(defaults.color, { applyToSelection: false });
  updateFormatControls();
  if (applyMindNodeTextFormat({}, { reset: true })) return;
  const item = getFormatTarget();
  if (canMutateItem(item)) {
    const patch =
      item.type === 'text' && textFillConflictsWithColor(item, defaults.color)
        ? { ...defaults, textFill: DEFAULT_TEXT_FILL }
        : defaults;
    applyTextFormatToItem(item, patch);
  }
}
export {
  ensureEditableZoom,
  toggleConnectorOption,
  buildColorPalette,
  setBrush,
  setShape,
  comparableColor,
  textFillConflictsWithColor,
  textFillConflictsWithItem,
  setColor,
  patchRenderedFormattingItem,
  applyTextBoxAppearance,
  setTextBoxFill,
  setTextBoxBorderColor,
  setTextBoxBorderStyle,
  resetTextBoxAppearance,
  applyColorToActiveItem,
  applyTextFormatToItem,
  setFontSize,
  setFontFamily,
  toggleBold,
  setTextAlign,
  resetTextFormatting
};

export { configureFormatActions };
