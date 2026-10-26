import { state } from './state.js';
import { clamp } from './utilities.js';

function applyMindNodeVisualStyle(element, style) {
  if (!element) return;
  for (const property of [
    'background',
    'color',
    'border-color',
    'border-width',
    'border-radius',
    'font-size',
    'font-family',
    'font-weight',
    'font-style',
    'text-decoration',
    'text-align',
    'justify-content',
    'box-shadow'
  ]) {
    element.style.removeProperty(property);
  }
  if (!style || typeof style !== 'object') return;
  const fill = style.fill || style.background || style.backgroundColor;
  const color = style.color || style.textColor;
  if (fill === 'transparent' || /^#[0-9a-f]{3,8}$/i.test(fill || '')) element.style.background = fill;
  if (/^#[0-9a-f]{3,8}$/i.test(color || '')) element.style.color = color;
  if (/^#[0-9a-f]{3,8}$/i.test(style.borderColor || '')) element.style.borderColor = style.borderColor;
  if (Number.isFinite(Number(style.borderWidth)))
    element.style.borderWidth = `${clamp(Number(style.borderWidth), 0, 8)}px`;
  if (Number.isFinite(Number(style.borderRadius)))
    element.style.borderRadius = `${clamp(Number(style.borderRadius), 0, 60)}px`;
  if (Number.isFinite(Number(style.fontSize))) element.style.fontSize = `${clamp(Number(style.fontSize), 8, 96)}px`;
  if (typeof style.fontFamily === 'string' && style.fontFamily.length <= 128)
    element.style.fontFamily = style.fontFamily;
  if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) element.style.fontWeight = '700';
  if (style.fontStyle === 'italic') element.style.fontStyle = 'italic';
  if (style.textDecoration === 'underline') element.style.textDecoration = 'underline';
  if (['left', 'center', 'right'].includes(style.textAlign)) {
    element.style.textAlign = style.textAlign;
    element.style.justifyContent =
      style.textAlign === 'left' ? 'flex-start' : style.textAlign === 'right' ? 'flex-end' : 'center';
  }
  const shape = String(style.shape || '').toLowerCase();
  if (/ellipse|oval|circle/.test(shape)) element.style.borderRadius = '999px';
  else if (/rounded/.test(shape) && !Number.isFinite(Number(style.borderRadius))) element.style.borderRadius = '10px';
  else if (/none|underline|line/.test(shape)) {
    element.style.borderColor = 'transparent';
    element.style.boxShadow = 'none';
  }
}

function makeMindActionButton(name, title, iconName, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `mind-action ${name}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  const labels = {
    'add-child': '添加子节点',
    'add-sibling': '添加同级',
    status: '切换状态',
    note: '编辑备注',
    collapse: '折叠/展开',
    delete: '删除'
  };
  button.textContent = labels[name] || title;
  button.addEventListener('pointerdown', (event) => {
    if (state.tool === 'select' || state.tool === 'mindmap' || state.tool === 'pan') {
      event.stopPropagation();
    }
  });
  button.addEventListener('click', (event) => {
    if (state.tool !== 'select' && state.tool !== 'mindmap' && state.tool !== 'pan') {
      return;
    }
    event.stopPropagation();
    onClick();
  });
  return button;
}
export { applyMindNodeVisualStyle, makeMindActionButton };
