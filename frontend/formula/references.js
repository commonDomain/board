'use strict';

const ERRORS = {
  '#NULL!': '#NULL!',
  '#DIV/0!': '#DIV/0!',
  '#VALUE!': '#VALUE!',
  '#REF!': '#REF!',
  '#NAME?': '#NAME?',
  '#NUM!': '#NUM!',
  '#N/A': '#N/A',
  '#CIRC!': '#CIRC!'
};

const ERROR_SET = new Set(Object.keys(ERRORS));

const MAX_COLUMNS = 16384;

const MAX_ROWS = 1048576;

function isError(value) {
  return typeof value === 'string' && ERROR_SET.has(value);
}

function columnToName(index) {
  let remaining = Math.floor(Math.max(0, index));
  let name = '';
  while (remaining >= 0) {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return name;
}

function nameToColumn(name) {
  const text = String(name || '').toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(text)) return -1;
  let index = 0;
  for (let i = 0; i < text.length; i += 1) index = index * 26 + (text.charCodeAt(i) - 64);
  index -= 1;
  return index < MAX_COLUMNS ? index : -1;
}

function toA1(row, column) {
  return `${columnToName(column)}${Math.floor(row) + 1}`;
}

function parseA1(text) {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(text || '').trim());
  if (!match) return null;
  const column = nameToColumn(match[1]);
  const row = Number(match[2]) - 1;
  if (column < 0 || column >= MAX_COLUMNS || row < 0 || row >= MAX_ROWS) return null;
  return { row, column };
}

function quoteSheetName(name) {
  const text = String(name ?? '');
  const bare = /^[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_.\u4e00-\u9fa5]*$/.test(text);
  if (bare && !/^[A-Za-z]{1,3}\d{1,7}$/.test(text) && !/^(TRUE|FALSE)$/i.test(text)) return text;
  return `'${text.replace(/'/g, "''")}'`;
}

module.exports = {
  ERRORS,
  ERROR_SET,
  MAX_COLUMNS,
  MAX_ROWS,
  isError,
  columnToName,
  nameToColumn,
  toA1,
  parseA1,
  quoteSheetName
};
