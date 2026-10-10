'use strict';

const { ERRORS, isError } = require('./references');

const BLANK = { blank: true };

function unwrap(value) {
  return value && typeof value === 'object' && value.__ref ? value.value : value;
}

function isBlank(value) {
  const inner = unwrap(value);
  return inner === null || inner === undefined || inner === BLANK || inner === '';
}

function toNumber(value) {
  const inner = unwrap(value);
  if (inner === BLANK || inner === null || inner === undefined) return 0;
  if (typeof inner === 'number') return Number.isFinite(inner) ? inner : ERRORS['#NUM!'];
  if (typeof inner === 'boolean') return inner ? 1 : 0;
  if (isError(inner)) return inner;
  const text = String(inner).trim();
  if (!text) return 0;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/.test(text)) {
    const percent = text.endsWith('%');
    const numeric = Number(percent ? text.slice(0, -1) : text);
    if (!Number.isFinite(numeric)) return ERRORS['#NUM!'];
    return percent ? numeric / 100 : numeric;
  }
  return ERRORS['#VALUE!'];
}

function toText(value) {
  const inner = unwrap(value);
  if (inner === BLANK || inner === null || inner === undefined) return '';
  if (typeof inner === 'string') return inner;
  if (typeof inner === 'boolean') return inner ? 'TRUE' : 'FALSE';
  if (typeof inner === 'number') {
    if (!Number.isFinite(inner)) return ERRORS['#NUM!'];
    return String(inner);
  }
  return String(inner);
}

function toBoolean(value) {
  const inner = unwrap(value);
  if (inner === BLANK || inner === null || inner === undefined) return false;
  if (typeof inner === 'boolean') return inner;
  if (typeof inner === 'number') return inner !== 0;
  if (isError(inner)) return inner;
  const text = String(inner).trim().toUpperCase();
  if (text === 'TRUE') return true;
  if (text === 'FALSE') return false;
  return ERRORS['#VALUE!'];
}

function compareValues(rawLeft, rawRight) {
  const left = unwrap(rawLeft);
  const right = unwrap(rawRight);
  if (isError(left)) return left;
  if (isError(right)) return right;
  const leftBlank = isBlank(left);
  const rightBlank = isBlank(right);
  if (leftBlank && rightBlank) return 0;
  if (
    typeof left === 'number' ||
    typeof right === 'number' ||
    typeof left === 'boolean' ||
    typeof right === 'boolean'
  ) {
    const leftNumber = leftBlank ? 0 : toNumber(left);
    const rightNumber = rightBlank ? 0 : toNumber(right);
    if (isError(leftNumber)) return leftNumber;
    if (isError(rightNumber)) return rightNumber;
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  const leftText = leftBlank ? '' : String(left).toUpperCase();
  const rightText = rightBlank ? '' : String(right).toUpperCase();
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

function flatten(args) {
  const output = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    output.push(unwrap(value));
  };
  for (const argument of args) visit(argument);
  return output;
}

function numbersOf(args) {
  const output = [];
  for (const value of flatten(args)) {
    if (isBlank(value)) continue;
    if (isError(value)) return value;
    // Excel's aggregate functions ignore text and logicals inside ranges
    // rather than failing, which is why =SUM(A1:A3) tolerates a label row.
    if (typeof value === 'boolean') continue;
    if (typeof value !== 'number') {
      const text = String(value).trim();
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/.test(text)) continue;
    }
    const numeric = toNumber(value);
    if (isError(numeric)) return numeric;
    output.push(numeric);
  }
  return output;
}

function roundHalfAway(value, digits) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  return rounded / factor;
}

module.exports = {
  BLANK,
  unwrap,
  isBlank,
  toNumber,
  toText,
  toBoolean,
  compareValues,
  flatten,
  numbersOf,
  roundHalfAway
};
