import { button } from './state.js';

const lineTypes = [
  ['smart', '智能'],
  ['straight', '直线'],
  ['orthogonal', '圆角折线'],
  ['curve', '曲线']
];

const markerTypes = [
  ['none', '无标记'],
  ['arrow', '箭头'],
  ['open', '空心箭头'],
  ['dot', '圆点'],
  ['diamond', '菱形'],
  ['square', '方块']
];

const lineWidths = [
  ['1', '细'],
  ['2', '标准'],
  ['3', '粗'],
  ['5', '加粗']
];

const lineDashes = [
  ['solid', '实线'],
  ['dash', '虚线'],
  ['dot', '点线']
];

function selectControl(parent, label, values, value, action, description = '', inMenu = false, disabled = false) {
  const field = inMenu ? document.createElement('label') : null;
  if (field) {
    field.className = 'connection-menu-field';
    const caption = document.createElement('span');
    caption.textContent = label;
    field.append(caption);
    if (description) {
      const note = document.createElement('small');
      note.textContent = description;
      field.append(note);
    }
  }
  const select = document.createElement('select');
  select.title = description ? `${label}：${description}` : label;
  select.setAttribute('aria-label', label);
  for (const [optionValue, text] of values) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = text;
    select.append(option);
  }
  if (!values.some(([optionValue]) => String(optionValue) === String(value))) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `当前：${value}`;
    select.append(option);
  }
  select.value = String(value);
  select.disabled = disabled;
  select.onchange = () => action(select.value);
  if (field) {
    field.append(select);
    parent.append(field);
  } else parent.append(select);
  return select;
}

function colorControl(parent, color, action, disabled = false) {
  const input = document.createElement('input');
  input.type = 'color';
  input.title = '连接颜色：修改线条和标记颜色';
  input.setAttribute('aria-label', '连接颜色');
  input.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#475569';
  input.disabled = disabled;
  input.onchange = () => action(input.value);
  parent.append(input);
}

function menuSection(menu, title) {
  const index = menu.querySelector('.connection-menu-index'),
    entry = document.createElement('button'),
    section = document.createElement('div'),
    header = document.createElement('div'),
    back = document.createElement('button'),
    content = document.createElement('div');
  entry.type = 'button';
  entry.className = 'connection-menu-entry';
  entry.textContent = title;
  entry.setAttribute('aria-label', `打开${title}设置`);
  entry.addEventListener('pointerdown', (event) => event.stopPropagation());
  entry.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.dataset.page = title;
    for (const panel of menu.querySelectorAll('.connection-menu-side')) panel.hidden = panel.dataset.title !== title;
  });
  index.append(entry);
  section.className = 'connection-menu-side';
  section.dataset.title = title;
  section.hidden = true;
  header.className = 'connection-menu-heading';
  back.type = 'button';
  back.className = 'connection-menu-back';
  back.textContent = '← 返回';
  back.setAttribute('aria-label', '返回更多菜单');
  back.addEventListener('pointerdown', (event) => event.stopPropagation());
  back.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.dataset.page = '';
    section.hidden = true;
    entry.focus();
  });
  header.append(back, document.createTextNode(title));
  content.className = 'connection-menu-section-content';
  section.append(header, content);
  menu.append(section);
  return content;
}

function menuAction(parent, label, description, action, disabled = false) {
  const control = button(
    label,
    () => {
      parent.closest('.connection-more')?.parentElement?.removeAttribute('open');
      action();
    },
    parent,
    `${label}：${description}`
  );
  const note = document.createElement('small');
  note.textContent = description;
  control.append(note);
  control.disabled = disabled;
  return control;
}
export { selectControl, colorControl, menuSection, menuAction, lineTypes, lineWidths, lineDashes, markerTypes };
