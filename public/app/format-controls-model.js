import { TEXT_FONT_FAMILIES } from './constants.js';
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
  const fillPicker = document.createElement('input');
  fillPicker.type = 'color';
  fillPicker.value = '#ffffff';
  fillPicker.dataset.textFillColor = '';
  fillPicker.setAttribute('aria-label', '文本框底色');
  const fillReset = makeContextButton('fill', '恢复默认底色', 'textAppearanceReset');
  fillReset.classList.add('text-appearance-reset');
  const fillValue = document.createElement('span');
  fillValue.className = 'text-appearance-value';
  fillValue.dataset.textFillValue = '';
  fillPanel.append(fillPicker, fillValue, fillReset);

  const borderPanel = document.createElement('div');
  borderPanel.className = 'text-appearance-panel';
  borderPanel.dataset.textAppearancePanel = 'border';
  borderPanel.hidden = true;
  const borderColorRow = document.createElement('div');
  borderColorRow.className = 'text-border-color-row';
  const borderPicker = document.createElement('input');
  borderPicker.type = 'color';
  borderPicker.value = '#313846';
  borderPicker.dataset.textBorderColor = '';
  borderPicker.setAttribute('aria-label', '文本框边框颜色');
  const borderValue = document.createElement('span');
  borderValue.className = 'text-appearance-value';
  borderValue.dataset.textBorderValue = '';
  const borderReset = makeContextButton('border', '恢复默认边框', 'textAppearanceReset');
  borderReset.classList.add('text-appearance-reset');
  borderColorRow.append(borderPicker, borderValue, borderReset);
  borderPanel.appendChild(borderColorRow);

  const groups = [
    [
      '线条',
      [
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
        ['vine', '藤蔓'],
        ['paws', '足迹']
      ]
    ],
    [
      '写实图案',
      [
        ['realistic-ivy', '常春藤'],
        ['realistic-wildflower', '压花'],
        ['realistic-shells', '珍珠贝'],
        ['realistic-woodland', '林间动物']
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

  const help = document.createElement('p');
  help.className = 'context-help text-appearance-help';
  help.textContent = '为保证文字清晰，底色与文字颜色相同时不会应用。';
  section.append(label, tabs, fillPanel, borderPanel, help);
  return section;
}
export { makeFormatGroup, makeContextButton, makeCustomColorControl, makeTextAppearanceSection };
