'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const FontFamilies = typeof window === 'object' ? window.MuseFontFamilies : require('../../public/font-families.js');

const NUMBER_FORMATS = [
  { id: 'general', label: '常规' },
  { id: 'number', label: '数字' },
  { id: 'integer', label: '整数' },
  { id: 'currency', label: '货币' },
  { id: 'percent', label: '百分比' },
  { id: 'scientific', label: '科学计数' },
  { id: 'date', label: '日期' },
  { id: 'dateTime', label: '日期时间' },
  { id: 'time', label: '时间' },
  { id: 'text', label: '文本' }
];

const FILL_SWATCHES = [
  '#ffffff',
  '#f3f5f9',
  '#fff3cd',
  '#ffe3e3',
  '#dff5e1',
  '#dbeafe',
  '#ede9fe',
  '#f1f5f9',
  '#fde68a',
  '#fca5a5',
  '#86efac',
  '#93c5fd',
  '#c4b5fd',
  '#94a3b8',
  '#475569',
  '#171922'
];

const TEXT_SWATCHES = ['#171922', '#4c5260', '#e6525d', '#e6a636', '#23b26d', '#21b7c7', '#6957f5', '#ffffff'];

const FONT_FAMILIES = [['', '默认字体'], ...(FontFamilies?.options || []).map(({ value, label }) => [value, label])];

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48];

const FILTER_OPERATORS = [
  { id: 'contains', label: '包含' },
  { id: 'notContains', label: '不包含' },
  { id: 'equals', label: '等于' },
  { id: 'notEquals', label: '不等于' },
  { id: 'beginsWith', label: '开头是' },
  { id: 'endsWith', label: '结尾是' },
  { id: 'greater', label: '大于' },
  { id: 'greaterOrEqual', label: '大于等于' },
  { id: 'less', label: '小于' },
  { id: 'lessOrEqual', label: '小于等于' },
  { id: 'blank', label: '空白' },
  { id: 'notBlank', label: '非空白' }
];

const FORMULA_ERROR_HELP = Object.freeze({
  '#NULL!': '引用的区域没有交集，请检查区间运算符。',
  '#DIV/0!': '除数为 0 或引用了空白除数，请检查参与除法的单元格。',
  '#VALUE!': '公式中的值类型或语法不匹配。',
  '#REF!': '公式引用了不存在或已删除的单元格。',
  '#NAME?': '函数名、名称或工作表名无法识别。',
  '#NUM!': '计算结果超出支持范围，或数字参数无效。',
  '#N/A': '当前公式找不到可用结果。',
  '#CIRC!': '公式直接或间接引用了自身。'
});

function formatIdFromPattern(pattern) {
  const text = String(pattern ?? '').trim();
  if (!text) return 'general';
  const known = NUMBER_FORMATS.find((entry) => entry.id === text.toLowerCase());
  if (known) return known.id;
  const resolved = Formula.BUILT_IN_FORMATS?.[text] || text;
  return (NUMBER_FORMATS.find((entry) => Formula.BUILT_IN_FORMATS?.[entry.id] === resolved) || NUMBER_FORMATS[0]).id;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon, label, className) {
  const button = element('button', className || 'sheet-tool');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  const glyph = element('i');
  glyph.dataset.lucide = icon;
  glyph.setAttribute('aria-hidden', 'true');
  button.appendChild(glyph);
  return button;
}

function textButton(label, className) {
  const button = element('button', className || 'sheet-tool sheet-tool-text', label);
  button.type = 'button';
  return button;
}

module.exports = {
  NUMBER_FORMATS,
  FILL_SWATCHES,
  TEXT_SWATCHES,
  FONT_FAMILIES,
  FONT_SIZES,
  FILTER_OPERATORS,
  FORMULA_ERROR_HELP,
  formatIdFromPattern,
  element,
  iconButton,
  textButton
};
