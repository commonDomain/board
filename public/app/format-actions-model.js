import { BRUSHES, TEXT_FONT_FAMILIES, TEXT_LIST_STYLES } from './constants.js';
import { syncFloatingSelectPicker } from './floating-toolbar-menu-model.js';
import { state } from './state.js';
import { clamp } from './utilities.js';

function isEditableCanvasItem(item) {
  return Boolean(item && ['text', 'note', 'table', 'mindmap'].includes(item.type));
}

function getBrush(brushId = state.brushType) {
  return BRUSHES.find((brush) => brush.id === brushId) || BRUSHES[0];
}

function normalizeFontFamily(value) {
  const candidate = String(value || '').trim();
  return TEXT_FONT_FAMILIES.some((font) => font.value === candidate) ? candidate : TEXT_FONT_FAMILIES[0].value;
}

function selectedFormatItems() {
  const ids = state.editingId ? [state.editingId] : [...state.selectedIds];
  return ids.map(id=>state.items.get(id)).filter(item=>item && ['text','note','table'].includes(item.type));
}

function setBrushSize(value) {
  const size = clamp(Number.isFinite(value) ? value : state.size, 1, 80);
  state.size = size;
  document.querySelectorAll('input[data-size-picker]').forEach((picker) => {
    picker.value = String(clamp(size, Number(picker.min || 1), Number(picker.max || 80)));
  });
}

function getFormatTarget() {
  const id = state.editingId || state.selectedId;
  if (!id) {
    return null;
  }
  const item = state.items.get(id);
  return item && (item.type === 'text' || item.type === 'note' || item.type === 'table') ? item : selectedFormatItems()[0] || null;
}

function getTextLineStyleAt(item, index) {
  const value = Array.isArray(item?.lineStyles) ? item.lineStyles[index] : undefined;
  if (TEXT_LIST_STYLES.has(value)) return value;
  return TEXT_LIST_STYLES.has(item?.listMode) ? item.listMode : 'none';
}

function normalizeTextLineStyles(item, lineCount = Math.max(1, String(item?.text || '').split('\n').length)) {
  return Array.from({ length: lineCount }, (_, index) => getTextLineStyleAt(item, index));
}

function updateFormatControls() {
  const items = selectedFormatItems();
  const mixed = field => items.length > 1 && items.some(item => (item[field] ?? (field==='fontFamily'?TEXT_FONT_FAMILIES[0].value:field==='fontSize'?18:field==='align'?'left':false)) !== (items[0][field] ?? (field==='fontFamily'?TEXT_FONT_FAMILIES[0].value:field==='fontSize'?18:field==='align'?'left':false)));
  document.querySelectorAll('select[data-format="family"]').forEach((select) => {
    let option = select.querySelector('option[data-mixed]');
    if(mixed('fontFamily')) {if(!option){option=document.createElement('option');option.value='';option.textContent='混合';option.disabled=true;option.dataset.mixed='';select.prepend(option);}select.value='';}
    else {option?.remove();select.value = state.fontFamily;}
    syncFloatingSelectPicker(select);
  });
  document.querySelectorAll('select[data-format="size"]').forEach((select) => {
    const currentSize = String(state.fontSize);
    const customOption = select.querySelector('option[data-custom-format-size]');
    if (customOption && customOption.value !== currentSize) customOption.remove();
    if (!Array.from(select.options).some((option) => option.value === currentSize)) {
      const option = document.createElement('option');
      option.value = currentSize;
      option.textContent = currentSize;
      option.dataset.customFormatSize = '';
      select.appendChild(option);
    }
    let mixedOption=select.querySelector('option[data-mixed]');
    if(mixed('fontSize')){if(!mixedOption){mixedOption=document.createElement('option');mixedOption.value='';mixedOption.textContent='混合';mixedOption.disabled=true;mixedOption.dataset.mixed='';select.prepend(mixedOption);}select.value='';}
    else {mixedOption?.remove();select.value = currentSize;}
    syncFloatingSelectPicker(select);
  });
  document.querySelectorAll('[data-format="bold"]').forEach((button) => {
    button.classList.toggle('active', !mixed('bold') && state.bold);
    button.setAttribute('aria-pressed', mixed('bold') ? 'mixed' : String(state.bold));
  });
  document.querySelectorAll('[data-format="align"]').forEach((button) => {
    const active = !mixed('align') && button.dataset.value === state.align;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
export {
  isEditableCanvasItem,
  getBrush,
  normalizeFontFamily,
  setBrushSize,
  getFormatTarget,
  getTextLineStyleAt,
  normalizeTextLineStyles,
  updateFormatControls,
  selectedFormatItems
};
