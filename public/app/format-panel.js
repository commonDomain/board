import { snapshotItems } from './history-controller-model.js';
import {
  DEFAULT_TEXT_BORDER_COLOR,
  DEFAULT_TEXT_FILL,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  TEXT_FONT_FAMILIES
} from './constants.js';
import { els } from './elements.js';
import {
  floatingToolbarUsesTarget,
  isFloatingToolbarTarget,
  isFormattingEditorActive
} from './floating-toolbar-menu-model.js';

import {buildColorPalette,patchRenderedFormattingItem} from './format-actions.js';

import { normalizeFontFamily, updateFormatControls, selectedFormatItems } from './format-actions-model.js';
import { setControlAvailability } from './ui-feedback.js';
import {
  makeContextButton,
  makeCustomColorControl,
  makeFormatGroup,
  makeTextAppearanceSection
} from './format-controls-model.js';
import { refreshIcons } from './interface-model.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';
import { getMindNodeAtPath } from './mindmap-editing-model.js';

import { getSelectedIds } from './selection-model.js';
import { state } from './state.js';
import { getTableColumnCount, getTableRowCount } from './table-rendering-model.js';
import { clamp } from './utilities.js';
import { normalizeNoteFill, normalizeTextBorderStyle, normalizeTextAppearanceColor } from './format-panel-model.js';

let getEditingMindNodeContext,
  updateFloatingFormatBar,
  updateTextListControls,
  renderItem;

function configureFormatPanel(callbacks) {
  ({
    getEditingMindNodeContext,
    updateFloatingFormatBar,
    updateTextListControls,
    renderItem
  } = callbacks);
}

function buildContextPanel() {
  if (!els.contextPanel) {
    return;
  }
  els.contextPanel.textContent = '';
  const title = document.createElement('div');
  title.className = 'context-title';
  const titleText = document.createElement('span');
  titleText.className = 'context-title-text';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'context-panel-close';
  closeButton.dataset.contextPanelClose = '';
  closeButton.title = '关闭属性面板';
  closeButton.setAttribute('aria-label', '关闭属性面板');
  closeButton.textContent = '×';
  const titleActions = document.createElement('div');
  titleActions.className = 'context-title-actions';
  const floatingModeButton = document.createElement('button');
  floatingModeButton.type = 'button';
  floatingModeButton.className = 'context-layout-switch';
  floatingModeButton.dataset.textToolbarMode = 'floating';
  floatingModeButton.title = '切换为浮动工具栏';
  floatingModeButton.setAttribute('aria-label', '切换为浮动工具栏');
  floatingModeButton.innerHTML = '<i data-lucide="panel-top-open" aria-hidden="true"></i><span>浮动</span>';
  floatingModeButton.classList.add('context-layout-switch-row');
  floatingModeButton.querySelector('span').textContent = '切换为浮动工具栏';
  titleActions.append(closeButton);
  title.append(titleText, titleActions);
  els.contextPanel.appendChild(title);

  const noteStyleSection = document.createElement('div');
  noteStyleSection.className = 'context-section note-style-section';
  noteStyleSection.id = 'contextNoteStyleSection';
  noteStyleSection.innerHTML = `
    <div class="context-section-heading"><strong>样式</strong><span aria-hidden="true">⌃</span></div>
    <label class="note-control-row">
      <span><i class="note-control-dot fill-dot" aria-hidden="true"></i>填充</span>
      <span class="note-color-control"><input type="color" data-note-fill aria-label="便签填充颜色"><output data-note-fill-value>#FFF4B2</output></span>
    </label>
    <label class="note-control-row">
      <span><i class="note-control-dot border-dot" aria-hidden="true"></i>边框</span>
      <select data-note-border aria-label="便签边框"><option value="none">无</option><option value="solid">实线</option></select>
    </label>
    <div class="note-control-row">
      <span><i data-lucide="align-left" aria-hidden="true"></i>阴影</span>
      <button class="switch-control note-shadow-toggle" type="button" role="switch" data-note-shadow aria-checked="true" aria-label="便签阴影"><span class="switch-track" aria-hidden="true"></span></button>
    </div>
    <label class="note-control-row note-opacity-row">
      <span>不透明度</span>
      <input type="range" min="0" max="100" step="1" value="100" data-note-opacity aria-label="便签不透明度">
      <output data-note-opacity-value>100%</output>
    </label>
    <button class="floating-reset-row note-appearance-reset" type="button" data-note-appearance-reset title="恢复便签默认外观" aria-label="恢复便签默认外观"><i data-lucide="rotate-ccw" aria-hidden="true"></i><span>重置便签外观</span></button>`;

  const noteTextSection = document.createElement('div');
  noteTextSection.className = 'context-section note-text-section';
  noteTextSection.id = 'contextNoteTextSection';
  noteTextSection.innerHTML = `
    <div class="context-section-heading"><strong>文字样式</strong><span aria-hidden="true">⌃</span></div>
    <div class="note-font-row">
      <select class="note-font-family" data-format="family" aria-label="字体"></select>
      <select class="note-font-size" data-format="size" aria-label="字号">
        <option>12</option><option>14</option><option selected>16</option><option>18</option><option>20</option><option>24</option><option>32</option>
      </select>
    </div>
    <div class="note-format-row">
      <div class="note-format-group">
        <button type="button" data-format="bold" title="加粗" aria-label="加粗"><strong>B</strong></button>
        <button type="button" data-note-format="italic" title="斜体" aria-label="斜体"><em>I</em></button>
        <button type="button" data-note-format="underline" title="下划线" aria-label="下划线"><u>U</u></button>
      </div>
      <div class="note-format-group note-align-group">
        <button type="button" data-format="align" data-value="left" title="左对齐" aria-label="左对齐"><i data-lucide="align-left"></i></button>
        <button type="button" data-format="align" data-value="center" title="居中" aria-label="居中"><i data-lucide="align-center"></i></button>
        <button type="button" data-format="align" data-value="right" title="右对齐" aria-label="右对齐"><i data-lucide="align-right"></i></button>
      </div>
    </div>
    <label class="note-text-color-row">
      <input type="color" data-color-picker aria-label="文字颜色">
      <output data-note-text-color-value>#111111</output>
    </label>`;
  const noteFontFamily = noteTextSection.querySelector('[data-format="family"]');
  TEXT_FONT_FAMILIES.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    noteFontFamily.appendChild(option);
  });

  const colorSection = document.createElement('div');
  colorSection.className = 'context-section';
  colorSection.id = 'contextColorSection';
  const colorLabel = document.createElement('div');
  colorLabel.className = 'context-label';
  colorLabel.textContent = '颜色';
  const palette = document.createElement('div');
  palette.className = 'color-palette';
  buildColorPalette(palette);
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = state.color;
  picker.dataset.colorPicker = '';
  picker.title = '自定义颜色';
  colorSection.append(colorLabel, palette, makeCustomColorControl(picker));

  const formatSection = document.createElement('div');
  formatSection.className = 'context-section';
  formatSection.id = 'contextFormatSection';
  const formatLabel = document.createElement('div');
  formatLabel.className = 'context-label';
  formatLabel.textContent = '文本格式';
  formatSection.append(formatLabel, makeFormatGroup());

  const textAppearanceSection = makeTextAppearanceSection();

  const listSection = document.createElement('div');
  listSection.className = 'context-section';
  listSection.id = 'contextListSection';
  const listLabel = document.createElement('div');
  listLabel.className = 'context-label';
  listLabel.textContent = '段落样式';
  const listRow = document.createElement('div');
  listRow.className = 'context-btn-row text-list-controls';
  listRow.append(
    makeContextButton('number', '编号', 'listMode'),
    makeContextButton('bullet', '项目符号', 'listMode'),
    makeContextButton('todo', '待办', 'listMode')
  );
  listSection.append(listLabel, listRow);

  const connectorSection = document.createElement('div');
  connectorSection.className = 'context-section';
  connectorSection.id = 'contextConnectorSection';
  const connectorLabel = document.createElement('div');
  connectorLabel.className = 'context-label';
  connectorLabel.textContent = '连接线';
  const connectorRow = document.createElement('div');
  connectorRow.className = 'context-btn-row';
  connectorRow.append(
    makeContextButton('arrowStart', '起点箭头', 'connectorAction'),
    makeContextButton('arrowEnd', '终点箭头', 'connectorAction'),
    makeContextButton('dash', '虚线', 'connectorAction')
  );
  connectorSection.append(connectorLabel, connectorRow);

  const tableSection = document.createElement('div');
  tableSection.className = 'context-section';
  tableSection.id = 'contextTableSection';
  const tableLabel = document.createElement('div');
  tableLabel.className = 'context-label';
  tableLabel.textContent = '表格结构';
  const tableSummary = document.createElement('div');
  tableSummary.className = 'table-structure-summary';
  tableSummary.id = 'contextTableSummary';
  const tableCurrent = document.createElement('div');
  tableCurrent.className = 'table-structure-current';
  tableCurrent.id = 'contextTableCurrent';
  const tableRow = document.createElement('div');
  tableRow.className = 'table-structure-actions';
  tableRow.append(
    makeContextButton('row', '＋ 添加行', 'tableAction'),
    makeContextButton('column', '＋ 添加列', 'tableAction')
  );
  const tableDeleteRow = document.createElement('div');
  tableDeleteRow.className = 'table-structure-actions table-structure-delete-actions';
  const deleteRowButton = makeContextButton('delete-row', '删除当前行', 'tableAction');
  const deleteColumnButton = makeContextButton('delete-column', '删除当前列', 'tableAction');
  deleteRowButton.classList.add('danger');
  deleteColumnButton.classList.add('danger');
  tableDeleteRow.append(deleteRowButton, deleteColumnButton);
  const tableHelp = document.createElement('p');
  tableHelp.className = 'context-help';
  tableHelp.textContent = '双击单元格可定位行列；删除操作支持撤销。';
  tableSection.append(tableLabel, tableSummary, tableCurrent, tableRow, tableDeleteRow, tableHelp);

  const mindmapSection = document.createElement('div');
  mindmapSection.className = 'context-section';
  mindmapSection.id = 'contextMindmapSection';
  const mindmapLabel = document.createElement('div');
  mindmapLabel.className = 'context-label';
  mindmapLabel.textContent = '分支连线';
  const mindmapRow = document.createElement('div');
  mindmapRow.className = 'context-btn-row';
  mindmapRow.append(
    makeContextButton('smart', '智能', 'mindmapBranchStyle'),
    makeContextButton('curve', '曲线', 'mindmapBranchStyle'),
    makeContextButton('elbow', '直角', 'mindmapBranchStyle')
  );
  const mindmapHelp = document.createElement('p');
  mindmapHelp.className = 'context-help';
  mindmapHelp.textContent = '智能会让单分支保持水平，密集分叉自动改用直角线。';
  const mindNodeLabel = document.createElement('div');
  mindNodeLabel.className = 'context-label';
  mindNodeLabel.textContent = '选中节点样式';
  const mindNodeColors = document.createElement('div');
  mindNodeColors.className = 'mind-node-style-controls';
  const makeMindNodeColor = (labelText, name) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.mindNodeColor = name;
    input.setAttribute('aria-label', labelText);
    label.appendChild(input);
    return label;
  };
  mindNodeColors.append(
    makeMindNodeColor('填充', 'fill'),
    makeMindNodeColor('文字', 'color'),
    makeMindNodeColor('分支线', 'lineColor')
  );
  const mindNodeRow = document.createElement('div');
  mindNodeRow.className = 'context-btn-row';
  mindNodeRow.append(
    makeContextButton('bold', '加粗', 'mindNodeStyle'),
    makeContextButton('italic', '斜体', 'mindNodeStyle'),
    makeContextButton('reset', '重置', 'mindNodeStyle')
  );
  const mindNodeHelp = document.createElement('p');
  mindNodeHelp.className = 'context-help';
  mindNodeHelp.textContent = '先点选脑图节点，再调整填充、文字和分支线颜色。';
  mindmapSection.append(
    mindmapLabel,
    mindmapRow,
    mindmapHelp,
    mindNodeLabel,
    mindNodeColors,
    mindNodeRow,
    mindNodeHelp
  );

  const layerSection = document.createElement('div');
  layerSection.className = 'context-section';
  layerSection.id = 'contextLayerSection';
  const layerLabel = document.createElement('div');
  layerLabel.className = 'context-label';
  layerLabel.textContent = '图层';
  const layerRow = document.createElement('div');
  layerRow.className = 'context-btn-row';
  layerRow.append(
    makeContextButton('up', '上移', 'layerAction'),
    makeContextButton('down', '下移', 'layerAction'),
    makeContextButton('top', '置顶', 'layerAction'),
    makeContextButton('bottom', '置底', 'layerAction')
  );
  layerSection.append(layerLabel, layerRow);

  const noteLayerSection = document.createElement('div');
  noteLayerSection.className = 'context-section note-layer-section';
  noteLayerSection.id = 'contextNoteLayerSection';
  noteLayerSection.innerHTML = `
    <div class="context-section-heading"><strong>图层</strong><span aria-hidden="true">⌃</span></div>
    <button type="button" class="note-layer-action" data-layer-action="top"><span><i data-lucide="layers-3"></i>置于顶层</span><kbd>]</kbd></button>
    <button type="button" class="note-layer-action" data-layer-action="bottom"><span><i data-lucide="layers-2"></i>置于底层</span><kbd>[</kbd></button>
    <button type="button" class="note-layer-action" data-layer-action="up"><span><i data-lucide="bring-to-front"></i>上移一层</span></button>
    <button type="button" class="note-layer-action" data-layer-action="down"><span><i data-lucide="send-to-back"></i>下移一层</span></button>`;

  const noteLockSection = document.createElement('div');
  noteLockSection.className = 'context-section note-lock-section';
  noteLockSection.id = 'contextNoteLockSection';
  noteLockSection.innerHTML = `
    <div class="context-section-heading"><strong>锁定</strong><span aria-hidden="true">⌃</span></div>
    <button type="button" class="note-lock-row" data-note-lock role="switch" aria-checked="false">
      <span><i data-lucide="lock" aria-hidden="true"></i><span data-note-lock-label>锁定</span></span>
      <span class="switch-control" aria-hidden="true"><span class="switch-track"></span></span>
    </button>`;

  const noteDeleteButton = document.createElement('button');
  noteDeleteButton.type = 'button';
  noteDeleteButton.className = 'note-panel-delete';
  noteDeleteButton.dataset.noteDelete = '';
  noteDeleteButton.textContent = '删除便签';

  const groups = [
    ['内容',[noteTextSection,formatSection,listSection,tableSection]],
    ['外观',[noteStyleSection,colorSection,textAppearanceSection,connectorSection,mindmapSection]],
    ['排列',[layerSection,noteLayerSection]],
    ['更多操作',[floatingModeButton,noteLockSection,noteDeleteButton]]
  ];
  for(const [label,sections] of groups){
    const group=document.createElement(label==='更多操作'?'details':'section');group.className='context-property-group';group.dataset.propertyGroup=label;
    const heading=document.createElement(label==='更多操作'?'summary':'h3');heading.textContent=label;group.append(heading,...sections);els.contextPanel.append(group);
  }
  const help=document.createElement('p');help.className='control-help';help.dataset.panelHelp='';help.hidden=true;els.contextPanel.append(help);
  refreshIcons(els.contextPanel);
}

function applyNotePanelPatch(patch) {
  const item = getSelectedOrEditingItem();
  if (!canMutateItem(item) || item.type !== 'note') return false;
  const beforeItems = snapshotItems();
  Object.assign(item, patch);
  state.items.set(item.id, item);
  if (!patchRenderedFormattingItem(item)) renderItem(item);
  upsertItem(item, { rerender: false, historySnapshot: beforeItems });
  updateContextPanel();
  return true;
}

function getSelectedOrEditingItem() {
  if (state.editingId) {
    return state.items.get(state.editingId) || null;
  }
  const ids = getSelectedIds();
  if (!ids.length) {
    return null;
  }
  const primary = state.selectedId && state.selectedIds.has(state.selectedId) ? state.selectedId : ids[0];
  return state.items.get(primary) || state.items.get(ids[0]) || null;
}

function updateTextAppearanceControls(item) {
  const section = els.contextPanel?.querySelector('#contextTextAppearanceSection');
  if (!section || !item || item.type !== 'text') return;
  const fill = normalizeTextAppearanceColor(item.textFill, DEFAULT_TEXT_FILL);
  const borderColor = normalizeTextAppearanceColor(item.textBorderColor, DEFAULT_TEXT_BORDER_COLOR);
  const borderStyle = normalizeTextBorderStyle(item.textBorderStyle);
  const fillPicker = section.querySelector('[data-text-fill-color]');
  const borderPicker = section.querySelector('[data-text-border-color]');
  if (fillPicker) fillPicker.value = fill === 'default' ? '#ffffff' : fill;
  if (borderPicker) borderPicker.value = borderColor === 'default' ? '#313846' : borderColor;
  section.querySelector('[data-text-fill-value]').textContent = fill === 'default' ? '默认柔白' : fill.toUpperCase();
  section.querySelector('[data-text-border-value]').textContent =
    borderColor === 'default' ? '默认深灰' : borderColor.toUpperCase();
  section.querySelectorAll('[data-text-border-style]').forEach((button) => {
    const active = button.dataset.textBorderStyle === borderStyle;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateContextPanel() {
  if (!els.contextPanel) {
    return;
  }
  const target = getSelectedOrEditingItem();
  const multiple = !state.editingId && getSelectedIds().length>1;
  const useFloatingToolbar = floatingToolbarUsesTarget(target);
  const textSelectedWithoutEditing =
    !multiple && (target?.type === 'text' || target?.type === 'note') && !isFormattingEditorActive(target);
  els.contextPanel.hidden = !target || useFloatingToolbar || textSelectedWithoutEditing || !multiple && target.type === 'planning';
  els.contextPanel.querySelectorAll('button,input,select').forEach(control=>{control.disabled=false;});
  updateFloatingFormatBar(target);
  if (!target) {
    return;
  }
  const typeNames = {
    text: '文本',
    note: '便签',
    table: '表格',
    connector: '连接线',
    sticker: '贴纸',
    shape: '形状',
    image: '图片',
    ink: '笔迹',
    mindmap: '脑图'
  };
  const isNote = target.type === 'note' && !multiple;
  const mindTextContext = target.type === 'mindmap' ? getEditingMindNodeContext() : null;
  const panelLayoutSwitch = els.contextPanel.querySelector('[data-text-toolbar-mode="floating"]');
  if (panelLayoutSwitch)
    panelLayoutSwitch.hidden = !isFloatingToolbarTarget(target) || !isFormattingEditorActive(target);
  els.contextPanel.classList.toggle('note-context-panel', isNote);
  els.contextPanel.querySelector('.context-title-text').textContent = multiple ? `${getSelectedIds().length} 个对象` : typeNames[target.type] || '元素';
  const noteStyleSection = els.contextPanel.querySelector('#contextNoteStyleSection');
  const noteTextSection = els.contextPanel.querySelector('#contextNoteTextSection');
  const colorSection = els.contextPanel.querySelector('#contextColorSection');
  const formatSection = els.contextPanel.querySelector('#contextFormatSection');
  const textAppearanceSection = els.contextPanel.querySelector('#contextTextAppearanceSection');
  const listSection = els.contextPanel.querySelector('#contextListSection');
  const tableSection = els.contextPanel.querySelector('#contextTableSection');
  const connectorSection = els.contextPanel.querySelector('#contextConnectorSection');
  const mindmapSection = els.contextPanel.querySelector('#contextMindmapSection');
  const layerSection = els.contextPanel.querySelector('#contextLayerSection');
  const noteLayerSection = els.contextPanel.querySelector('#contextNoteLayerSection');
  const noteLockSection = els.contextPanel.querySelector('#contextNoteLockSection');
  const noteDeleteButton = els.contextPanel.querySelector('[data-note-delete]');
  noteStyleSection.hidden = !isNote;
  noteTextSection.hidden = !isNote && !mindTextContext;
  noteLayerSection.hidden = !isNote;
  noteLockSection.hidden = !isNote;
  noteDeleteButton.hidden = !isNote;
  const colorable = ['text', 'note', 'table', 'sticker', 'shape', 'connector'].includes(target.type);
  colorSection.hidden = !colorable || isNote;
  formatSection.hidden = !(target.type === 'text' || target.type === 'note' || target.type === 'table') || isNote;
  textAppearanceSection.hidden = target.type !== 'text';
  listSection.hidden = !(target.type === 'text' || target.type === 'note') || isNote;
  tableSection.hidden = target.type !== 'table';
  connectorSection.hidden = target.type !== 'connector';
  mindmapSection.hidden = target.type !== 'mindmap';
  layerSection.hidden = isNote;
  if(multiple){
    noteTextSection.hidden=true;colorSection.hidden=true;textAppearanceSection.hidden=true;listSection.hidden=true;tableSection.hidden=true;connectorSection.hidden=true;mindmapSection.hidden=true;layerSection.hidden=true;
    formatSection.hidden=!selectedFormatItems().length;
  }
  for(const group of els.contextPanel.querySelectorAll('[data-property-group]')) group.hidden=[...group.children].slice(1).every(section=>section.hidden);
  colorSection.querySelector('.context-label').textContent = '颜色';
  if (isNote) {
    const fill = normalizeNoteFill(target.noteFill);
    const opacity = clamp(Number.isFinite(Number(target.noteOpacity)) ? Number(target.noteOpacity) : 1, 0, 1);
    state.fontSize = target.fontSize || 16;
    state.fontFamily = normalizeFontFamily(target.fontFamily);
    state.bold = Boolean(target.bold);
    state.align = target.align || 'left';
    noteStyleSection.querySelector('[data-note-fill]').value = fill;
    noteStyleSection.querySelector('[data-note-fill-value]').textContent = fill.toUpperCase();
    noteStyleSection.querySelector('[data-note-border]').value = target.noteBorder === 'solid' ? 'solid' : 'none';
    const shadowToggle = noteStyleSection.querySelector('[data-note-shadow]');
    shadowToggle.setAttribute('aria-checked', String(target.noteShadow !== false));
    noteStyleSection.querySelector('[data-note-opacity]').value = String(Math.round(opacity * 100));
    noteStyleSection.querySelector('[data-note-opacity-value]').textContent = `${Math.round(opacity * 100)}%`;
    noteTextSection.querySelector('[data-format="family"]').value = normalizeFontFamily(target.fontFamily);
    noteTextSection.querySelector('[data-format="size"]').value = String(target.fontSize || 16);
    noteTextSection.querySelector('[data-format="bold"]').classList.toggle('active', Boolean(target.bold));
    noteTextSection.querySelector('[data-note-format="italic"]').classList.toggle('active', Boolean(target.italic));
    noteTextSection
      .querySelector('[data-note-format="underline"]')
      .classList.toggle('active', Boolean(target.underline));
    noteTextSection.querySelectorAll('[data-format="align"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.value === (target.align || 'left'));
    });
    const noteTextColor = target.color || '#111111';
    noteTextSection.querySelector('[data-color-picker]').value = noteTextColor;
    noteTextSection.querySelector('[data-note-text-color-value]').textContent = noteTextColor.toUpperCase();
    const noteLockButton = noteLockSection.querySelector('[data-note-lock]');
    noteLockButton.setAttribute('aria-checked', String(Boolean(target.locked)));
    noteLockButton.querySelector('[data-note-lock-label]').textContent = target.locked ? '解锁' : '锁定';
  } else if (mindTextContext) {
    const style = mindTextContext.node.style || {};
    const fontSize = clamp(Number(style.fontSize) || 12, 8, 96);
    const fontFamily = normalizeFontFamily(style.fontFamily);
    const bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
    const align = ['left', 'center', 'right'].includes(style.textAlign) ? style.textAlign : 'center';
    const textColor = /^#[0-9a-f]{6}$/i.test(String(style.color || style.textColor || ''))
      ? style.color || style.textColor
      : '#111111';
    state.fontSize = fontSize;
    state.fontFamily = fontFamily;
    state.bold = bold;
    state.align = align;
    noteTextSection.querySelector('[data-format="family"]').value = fontFamily;
    noteTextSection.querySelector('[data-format="size"]').value = String(fontSize);
    noteTextSection.querySelector('[data-format="bold"]').classList.toggle('active', bold);
    noteTextSection
      .querySelector('[data-note-format="italic"]')
      .classList.toggle('active', style.fontStyle === 'italic');
    noteTextSection
      .querySelector('[data-note-format="underline"]')
      .classList.toggle('active', style.textDecoration === 'underline');
    noteTextSection.querySelectorAll('[data-format="align"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.value === align);
    });
    noteTextSection.querySelector('[data-color-picker]').value = textColor;
    noteTextSection.querySelector('[data-note-text-color-value]').textContent = textColor.toUpperCase();
  }
  if (colorable) {
    const itemColor = target.type === 'shape' || target.type === 'connector' ? target.stroke : target.color;
    if (itemColor) {
      state.color = itemColor;
      colorSection.querySelectorAll('input[data-color-picker]').forEach((picker) => {
        picker.value = itemColor;
      });
      document.querySelectorAll('[data-color]').forEach((button) => {
        button.classList.toggle('active', button.dataset.color.toLowerCase() === itemColor.toLowerCase());
      });
    }
  }
  if (!formatSection.hidden) {
    const formatTarget=multiple ? selectedFormatItems()[0] : target;
    state.fontSize = formatTarget.fontSize || 18;
    state.fontFamily = normalizeFontFamily(formatTarget.fontFamily);
    state.bold = Boolean(formatTarget.bold);
    state.align = formatTarget.align || 'left';
    formatSection.querySelectorAll('select[data-format="size"]').forEach((select) => {
      select.value = String(state.fontSize);
    });
    formatSection.querySelectorAll('select[data-format="family"]').forEach((select) => {
      select.value = state.fontFamily;
    });
    formatSection.querySelectorAll('[data-format="bold"]').forEach((button) => {
      button.classList.toggle('active', Boolean(target.bold));
    });
    formatSection.querySelectorAll('[data-format="align"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.value === (target.align || 'left'));
    });
  }
  if (!textAppearanceSection.hidden) updateTextAppearanceControls(target);
  if (!listSection.hidden) {
    updateTextListControls(target);
  }
  if (target.type === 'connector') {
    connectorSection
      .querySelector('[data-connector-action="arrowStart"]')
      .classList.toggle('active', Boolean(target.arrowStart));
    connectorSection
      .querySelector('[data-connector-action="arrowEnd"]')
      .classList.toggle('active', Boolean(target.arrowEnd));
    connectorSection
      .querySelector('[data-connector-action="dash"]')
      .classList.toggle('active', Boolean(target.dasharray));
  }
  if (target.type === 'table') {
    const rows = getTableRowCount(target);
    const columns = getTableColumnCount(target);
    const focus =
      state.tableFocus?.itemId === target.id
        ? {
            row: clamp(state.tableFocus.row, 0, rows - 1),
            column: clamp(state.tableFocus.column, 0, columns - 1)
          }
        : null;
    tableSection.querySelector('#contextTableSummary').textContent = `${rows} 行 × ${columns} 列`;
    tableSection.querySelector('#contextTableCurrent').textContent = focus
      ? `当前：第 ${focus.row + 1} 行 · 第 ${focus.column + 1} 列`
      : '双击单元格以选择行列';
    tableSection.querySelector('[data-table-action="row"]').disabled = rows >= MAX_TABLE_ROWS;
    tableSection.querySelector('[data-table-action="column"]').disabled = columns >= MAX_TABLE_COLUMNS;
    tableSection.querySelector('[data-table-action="delete-row"]').disabled = !focus || rows <= 1;
    tableSection.querySelector('[data-table-action="delete-column"]').disabled = !focus || columns <= 1;
  }
  if (target.type === 'mindmap') {
    const branchStyle = window.MindMapLayout.normalizeStyle(target.branchStyle);
    mindmapSection.querySelectorAll('[data-mindmap-branch-style]').forEach((button) => {
      const active = button.dataset.mindmapBranchStyle === branchStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const selection = state.mindmapSelection?.itemId === target.id ? state.mindmapSelection : null;
    const node = selection ? getMindNodeAtPath(target.tree, selection.path) : null;
    mindmapSection.querySelectorAll('[data-mind-node-color], [data-mind-node-style]').forEach((control) => {
      control.disabled = !node;
    });
    if (node) {
      const style = node.style || {};
      const pickerColor = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback);
      const colors = {
        fill: pickerColor(style.fill || style.background, '#ffffff'),
        color: pickerColor(style.color || style.textColor, '#111111'),
        lineColor: pickerColor(style.lineColor || style.branchColor, '#334155')
      };
      mindmapSection.querySelectorAll('[data-mind-node-color]').forEach((input) => {
        input.value = colors[input.dataset.mindNodeColor];
      });
      mindmapSection
        .querySelector('[data-mind-node-style="bold"]')
        ?.classList.toggle('active', style.fontWeight === 'bold' || Number(style.fontWeight) >= 600);
      mindmapSection
        .querySelector('[data-mind-node-style="italic"]')
        ?.classList.toggle('active', style.fontStyle === 'italic');
    }
  }
  if (isNote || mindTextContext || !formatSection.hidden) updateFormatControls();
  noteTextSection.querySelectorAll('[data-note-format]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
  const help=els.contextPanel.querySelector('[data-panel-help]');
  help.textContent=multiple ? `格式设置仅应用于 ${selectedFormatItems().length} 个文字、便签或表格对象；其他对象保持原样。` : !canMutateItem(target)?'当前对象或所在图层已锁定，无法修改。':target.type==='mindmap'&&!state.mindmapSelection?'先选中脑图节点，再调整节点样式。':'';
  help.hidden=!help.textContent;
  for(const control of els.contextPanel.querySelectorAll('button:not([data-context-panel-close]),input,select')) {
    const unavailable = !canMutateItem(target) && !control.matches('[data-text-toolbar-mode],[data-note-lock]');
    if(unavailable)control.disabled=true;
    const reason=unavailable?'当前对象或所在图层已锁定':target.type==='mindmap'?'先选中脑图节点':target.type==='table'?'先定位单元格，并至少保留一行一列':'当前操作不适用';
    setControlAvailability(control,control.disabled,reason);
  }
  if(multiple && selectedFormatItems().length)updateFormatControls();
}
export {
  buildContextPanel,
  applyNotePanelPatch,
  getSelectedOrEditingItem,
  updateTextAppearanceControls,
  updateContextPanel
};

export { configureFormatPanel };
