import { recordTableEditorHistory } from './table-edit-history.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';
import { state } from './state.js';
import { getEditingTableTextContext } from './text-input-model.js';
import { saveTextSelection } from './floating-toolbar-position-model.js';
import { getNormalizedTableCellSelection, syncTableFromDom, tableCellRichKey } from './table-rendering-model.js';
import { applyRichTextRangeFormat } from './text-rendering-model.js';
import { restoreRichTextRange } from './rich-text-input.js';

function applyTableTextFormat(patch) {
  const context = getEditingTableTextContext();
  if (!context || !canMutateItem(context.item)) return false;
  const { item, root, editable } = context;
  syncTableFromDom(root, item);
  recordTableEditorHistory(item);
  const cells = getNormalizedTableCellSelection();
  const rememberCellStyle = cell => {
    const key=tableCellRichKey(item,Number(cell.dataset.row),Number(cell.dataset.column));
    item.cellStyles ||= {};
    item.cellStyles[key]={...(item.cellStyles[key]||{}),...patch};
    if(patch.align)cell.style.textAlign=patch.align;
  };
  let range;
  if (cells?.itemId === item.id) {
    for (const cell of root.querySelectorAll('td,th')) {
      const row = Number(cell.dataset.row), column = Number(cell.dataset.column);
      if (row < cells.startRow || row > cells.endRow || column < cells.startColumn || column > cells.endColumn) continue;
      rememberCellStyle(cell);
      const all = document.createRange();all.selectNodeContents(cell);
      if(!cell.textContent.replace(/\u200b/g,''))all.collapse(true);
      range = applyRichTextRangeFormat(cell, all, patch);
    }
  } else {
    range = restoreRichTextRange(editable, state.textSelection?.itemId === item.id ? state.textSelection.range : null);
    if (!range) { range = document.createRange();range.selectNodeContents(editable); }
    if(patch.align || !editable.textContent.replace(/\u200b/g,''))rememberCellStyle(editable);
    range = applyRichTextRangeFormat(editable, range, patch);
    window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    saveTextSelection(item.id, range);
  }
  syncTableFromDom(root, item);
  upsertItem(item, { rerender:false, history:false });
  return true;
}

export { applyTableTextFormat };
