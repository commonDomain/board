import { TEXT_BORDER_SWATCHES, TEXT_FILL_SWATCHES, TEXT_FONT_FAMILIES } from './constants.js';
import { state } from './state.js';

function makeFormatGroup() {
  const group = document.createElement('div');
  group.className = 'format-group';
  const selectRow = document.createElement('div');
  selectRow.className = 'format-row format-select-row';
  const family = document.createElement('select');
  family.className = 'format-select format-family';
  family.dataset.format = 'family';
  family.title = '字体';
  family.setAttribute('aria-label', '字体');
  TEXT_FONT_FAMILIES.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    family.appendChild(option);
  });
  family.value = state.fontFamily;
  const select = document.createElement('select');
  select.className = 'format-select';
  select.dataset.format = 'size';
  select.title = '字号';
  [12, 14, 16, 18, 20, 24, 32].forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    if (value === 18) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  const bold = document.createElement('button');
  bold.type = 'button';
  bold.className = 'context-btn';
  bold.dataset.format = 'bold';
  bold.textContent = '加粗';
  const alignButton = (value, label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-btn';
    button.dataset.format = 'align';
    button.dataset.value = value;
    button.textContent = label;
    return button;
  };
  selectRow.append(family, select);
  const actionRow = document.createElement('div');
  actionRow.className = 'format-row format-action-row';
  actionRow.append(bold, alignButton('left', '左'), alignButton('center', '中'), alignButton('right', '右'));
  const resetRow = document.createElement('div');
  resetRow.className = 'format-row format-reset-row';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'context-btn format-reset-button';
  reset.dataset.format = 'reset';
  reset.textContent = '重置';
  reset.title = '重置颜色、字体、字号、加粗和对齐';
  resetRow.appendChild(reset);
  group.append(selectRow, actionRow, resetRow);
  return group;
}

function makeContextButton(action, label, key) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'context-btn';
  button.dataset[key] = action;
  button.textContent = label;
  button.setAttribute('aria-label',label);
  return button;
}

function makeCustomColorControl(picker) {
  const label = document.createElement('label');
  label.className = 'custom-color-button';
  label.title = '自定义颜色';
  const text = document.createElement('span');
  text.textContent = '自定义';
  const swatch = document.createElement('span');
  swatch.className = 'custom-color-sample';
  const value = document.createElement('span');
  value.className = 'custom-color-value';
  value.textContent = state.color.toUpperCase();
  label.style.setProperty('--selected-color', state.color);
  picker.setAttribute('aria-label', '自定义颜色');
  label.append(swatch, text, value, picker);
  return label;
}

// A row of colour quick picks for a text box fill or border, ending in a "更多" button that opens the
// full picker (the hidden colour input beside it).
function makeTextSwatchRow(kind) {
  const fill = kind === 'fill';
  const row = document.createElement('div');
  row.className = 'text-swatch-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', fill ? '常用底色' : '常用边框颜色');
  const options = fill
    ? [['none', '无底色（纯文字）'], ['default', '默认柔白'], ...TEXT_FILL_SWATCHES.map((color) => [color, color.toUpperCase()])]
    : [['default', '默认颜色'], ...TEXT_BORDER_SWATCHES.map((color) => [color, color.toUpperCase()])];
  options.forEach(([value, name]) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'text-swatch';
    swatch.dataset.textSwatch = kind;
    swatch.dataset.value = value;
    swatch.title = name;
    swatch.setAttribute('aria-label', name);
    swatch.setAttribute('aria-pressed', 'false');
    if (value.startsWith('#')) swatch.style.setProperty('--swatch', value);
    row.appendChild(swatch);
  });
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'text-swatch-more';
  more.dataset.textColorMore = kind;
  more.title = '更多颜色';
  more.innerHTML = '<span class="text-swatch-more-dot" aria-hidden="true"></span><span>更多</span>';
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'text-color-more-input';
  input.tabIndex = -1;
  input.value = fill ? '#ffffff' : '#313846';
  if (fill) input.dataset.textFillColor = '';
  else input.dataset.textBorderColor = '';
  input.setAttribute('aria-label', fill ? '自定义底色' : '自定义边框颜色');
  row.append(more, input);
  return row;
}

function makeTextAppearanceLabel(text) {
  const label = document.createElement('div');
  label.className = 'text-appearance-label';
  label.textContent = text;
  return label;
}

// Shadow and opacity rows shared by the side panel and the floating menu.
const TEXT_EFFECT_ROWS_HTML =
  '<label class="text-effect-row"><span>阴影</span><button type="button" class="switch-control" role="switch" data-text-shadow aria-checked="true" aria-label="文本框阴影"><span class="switch-track" aria-hidden="true"></span></button></label>' +
  '<label class="text-effect-row"><span>不透明度</span><input type="range" min="0" max="100" step="1" value="100" data-text-opacity aria-label="文本框不透明度"><output data-text-opacity-value>100%</output></label>';

function makeTextAppearanceSection() {
  const section = document.createElement('div');
  section.className = 'context-section text-appearance-section';
  section.id = 'contextTextAppearanceSection';

  const label = document.createElement('div');
  label.className = 'context-label';
  label.textContent = '文本框外观';

  const tabs = document.createElement('div');
  tabs.className = 'text-appearance-tabs';
  const makeTab = (id, text) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-btn text-appearance-tab';
    button.dataset.textAppearanceTab = id;
    button.textContent = text;
    button.setAttribute('aria-pressed', String(id === 'fill'));
    if (id === 'fill') button.classList.add('active');
    return button;
  };
  tabs.append(makeTab('fill', '底色'), makeTab('border', '边框'));

  const fillPanel = document.createElement('div');
  fillPanel.className = 'text-appearance-panel';
  fillPanel.dataset.textAppearancePanel = 'fill';
  const fillReset = makeContextButton('fill', '恢复默认底色与效果', 'textAppearanceReset');
  fillReset.classList.add('text-appearance-reset');
  const effects = document.createElement('div');
  effects.className = 'text-effect-rows';
  effects.innerHTML = TEXT_EFFECT_ROWS_HTML;
  fillPanel.append(makeTextAppearanceLabel('底色'), makeTextSwatchRow('fill'), effects, fillReset);

  const borderPanel = document.createElement('div');
  borderPanel.className = 'text-appearance-panel';
  borderPanel.dataset.textAppearancePanel = 'border';
  borderPanel.hidden = true;
  const borderReset = makeContextButton('border', '恢复默认边框', 'textAppearanceReset');
  borderReset.classList.add('text-appearance-reset');
  borderPanel.append(makeTextAppearanceLabel('颜色'), makeTextSwatchRow('border'), makeTextAppearanceLabel('样式'));

  const groups = [
    [
      '线条',
      [
        ['none', '无'],
        ['solid', '实线'],
        ['dashed', '虚线'],
        ['dotted', '点线'],
        ['double', '双线'],
        ['wave', '波浪'],
        ['stars', '星号']
      ]
    ],
    [
      '图案',
      [
        ['paws', '足迹']
      ]
    ],
    [
      '写实图案',
      [
        ['realistic-ivy', '常春藤'],
        ['realistic-wildflower', '压花'],
        ['realistic-shells', '珍珠贝'],
        ['realistic-woodland', '林间动物'],
        ['realistic-eucalyptus', '尤加利叶'],
        ['realistic-lavender', '薰衣草'],
        ['realistic-sakura', '樱花枝']
      ]
    ]
  ];
  groups.forEach(([groupLabel, styles]) => {
    const heading = document.createElement('div');
    heading.className = 'text-border-group-label';
    heading.textContent = groupLabel;
    const grid = document.createElement('div');
    grid.className = 'text-border-style-grid';
    styles.forEach(([id, text]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-border-style-button';
      button.dataset.textBorderStyle = id;
      button.dataset.previewStyle = id;
      button.innerHTML = `<span class="text-border-style-preview" aria-hidden="true"></span><span>${text}</span>`;
      grid.appendChild(button);
    });
    borderPanel.append(heading, grid);
  });
  borderPanel.appendChild(borderReset);

  const help = document.createElement('p');
  help.className = 'context-help text-appearance-help';
  help.textContent = '为保证文字清晰，底色与文字颜色相同时不会应用。';
  section.append(label, tabs, fillPanel, borderPanel, help);
  return section;
}
export {
  makeFormatGroup,
  makeContextButton,
  makeCustomColorControl,
  makeTextAppearanceSection,
  makeTextSwatchRow,
  TEXT_EFFECT_ROWS_HTML
};
