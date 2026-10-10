'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const {
  FILL_SWATCHES,
  FONT_FAMILIES,
  FONT_SIZES,
  NUMBER_FORMATS,
  TEXT_SWATCHES,
  element,
  formatIdFromPattern,
  textButton
} = require('./controls');

function createToolbarLayout({ toolbar, withAction, labeledTool, selectMenu, swatchPicker, borderPicker, actionMenu }) {
  function buildToolbar() {
    toolbar.textContent = '';
    const addRow = (name) => {
      const row = element('div', `sheet-toolbar-row sheet-toolbar-row-${name}`);
      toolbar.appendChild(row);
      return row;
    };
    const addGroup = (row, name) => {
      const group = element('div', 'sheet-tool-group');
      if (name) group.dataset.group = name;
      row.appendChild(group);
      return group;
    };

    const primaryRow = addRow('primary');
    const history = addGroup(primaryRow, 'editing');
    history.append(
      withAction(labeledTool('undo-2', '撤销'), 'undo'),
      withAction(labeledTool('redo-2', '重做'), 'redo'),
      withAction(labeledTool('search', '查找替换'), 'find'),
      withAction(labeledTool('circle-help', '快捷键'), 'shortcut-help')
    );

    const format = addGroup(primaryRow, 'text-format');
    const fontSelect = element('select', 'sheet-select sheet-font-select');
    fontSelect.dataset.action = 'font-family';
    fontSelect.title = '字体';
    fontSelect.setAttribute('aria-label', '字体');
    for (const [value, label] of FONT_FAMILIES) {
      const option = element('option', null, label);
      option.value = value;
      fontSelect.appendChild(option);
    }
    const sizeSelect = element('select', 'sheet-select sheet-size-select');
    sizeSelect.dataset.action = 'font-size';
    sizeSelect.title = '字号';
    sizeSelect.setAttribute('aria-label', '字号');
    for (const value of FONT_SIZES) {
      const option = element('option', null, String(value));
      option.value = String(value);
      sizeSelect.appendChild(option);
    }
    const bold = labeledTool('bold', '加粗');
    bold.classList.add('sheet-tool-bold');
    bold.title = '加粗（Ctrl+B）';
    const italic = labeledTool('italic', '倾斜');
    italic.classList.add('sheet-tool-italic');
    italic.title = '倾斜（Ctrl+I）';
    const underline = labeledTool('underline', '下划线');
    underline.classList.add('sheet-tool-underline');
    underline.title = '下划线（Ctrl+U）';
    const strike = labeledTool('strikethrough', '删除线');
    strike.classList.add('sheet-tool-strike');
    strike.title = '删除线';
    format.append(
      selectMenu(fontSelect),
      selectMenu(sizeSelect),
      withAction(bold, 'bold'),
      withAction(italic, 'italic'),
      withAction(underline, 'underline'),
      withAction(strike, 'strike'),
      withAction(labeledTool('paintbrush', '格式刷'), 'format-painter')
    );

    const appearanceRow = addRow('appearance');
    const alignment = addGroup(appearanceRow, 'alignment');
    alignment.append(
      withAction(labeledTool('align-left', '左对齐'), 'align-left'),
      withAction(labeledTool('align-center', '水平居中'), 'align-center'),
      withAction(labeledTool('align-right', '右对齐'), 'align-right'),
      withAction(labeledTool('chevrons-up', '顶部对齐'), 'valign-top'),
      withAction(labeledTool('minus', '垂直居中'), 'valign-middle'),
      withAction(labeledTool('chevrons-down', '底部对齐'), 'valign-bottom'),
      withAction(labeledTool('wrap-text', '自动换行'), 'wrap'),
      withAction(labeledTool('crosshair', '行列高亮'), 'row-column-highlight')
    );

    const formats = addGroup(appearanceRow, 'number-format');
    const formatSelect = element('select', 'sheet-select');
    formatSelect.dataset.action = 'format';
    formatSelect.title = '数字格式';
    for (const entry of NUMBER_FORMATS) {
      const option = element('option', null, entry.label);
      option.value = entry.id;
      formatSelect.appendChild(option);
    }
    formats.appendChild(selectMenu(formatSelect));

    const colors = addGroup(appearanceRow, 'appearance');
    colors.append(
      // Both pickers take their glyph from the icon set; the colour itself is
      // shown by the bar under the glyph, so no icon is duplicated by accident.
      swatchPicker('sheet-text-color', 'type', 'text-color', TEXT_SWATCHES, '字体颜色'),
      swatchPicker('sheet-fill-color', 'palette', 'fill-color', FILL_SWATCHES, '填充颜色'),
      borderPicker()
    );

    const dataRow = addRow('data');
    const calculation = addGroup(dataRow, 'calculation');
    calculation.append(
      actionMenu('sheet:formula', '求和', 'formula-menu', [
        ['quick-sum', 'sum', '求和'],
        ['quick-average', 'activity', '平均值'],
        ['quick-count', 'list-ordered', '计数'],
        ['quick-max', 'arrow-up-to-line', '最大值'],
        ['quick-min', 'arrow-down-to-line', '最小值']
      ]),
      withAction(labeledTool('merge', '合并单元格'), 'merge'),
      withAction(labeledTool('split', '取消合并'), 'unmerge')
    );

    const axes = addGroup(dataRow, 'axes');
    axes.append(
      withAction(labeledTool('between-horizontal-start', '插入行'), 'insert-row'),
      withAction(labeledTool('between-vertical-start', '插入列'), 'insert-column'),
      withAction(labeledTool('trash-2', '删除行'), 'delete-row')
    );

    const organize = addGroup(dataRow, 'organize');
    organize.append(
      actionMenu('sheet:freeze', '冻结', 'freeze-menu', [
        ['freeze-none', 'panel-top-close', '取消冻结窗格'],
        null,
        ['freeze-panes', 'panels-top-left', '冻结至当前行列'],
        ['freeze-through-row', 'rows-3', '冻结至当前行'],
        ['freeze-through-column', 'columns-3', '冻结至当前列'],
        ['freeze-header', 'panel-top', '冻结表头'],
        ['freeze-first-row', 'rows-2', '冻结首行'],
        ['freeze-first-column', 'columns-2', '冻结首列']
      ]),
      actionMenu('sheet:sort', '排序', 'sort-menu', [
        ['sort-asc', 'arrow-up-narrow-wide', '升序'],
        ['sort-desc', 'arrow-down-wide-narrow', '降序']
      ]),
      withAction(labeledTool('sheet:filter', '筛选', true), 'filter'),
      withAction(labeledTool('eraser', '清空内容'), 'clear-content')
    );

    const data = addGroup(dataRow, 'file');
    data.append(
      withAction(labeledTool('download', '导入 xlsx'), 'import-xlsx'),
      withAction(labeledTool('upload', '导出 xlsx'), 'export-xlsx'),
      withAction(labeledTool('upload', '导出 CSV'), 'export-csv')
    );
  }
  return { buildToolbar };
}
module.exports = { createToolbarLayout };
