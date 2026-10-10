'use strict';

const { isError } = require('./references');
const { compareValues, flatten, toNumber, unwrap } = require('./values');

function referencePosition(value) {
  return value && typeof value === 'object' && value.__ref ? value.__ref : null;
}

function makeCriteria(rawValue) {
  const raw = unwrap(rawValue);
  if (raw === null || raw === undefined || raw === '') return () => true;
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return (value) => compareValues(value, raw) === 0;
  }
  const text = String(raw);
  const match = /^(<=|>=|<>|=|<|>)?\s*(.*)$/.exec(text);
  const operator = match[1] || '=';
  const operand = match[2];
  const wildcard = /[*?]/.test(operand);
  const asNumber = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/.test(operand.trim())
    ? Number(operand.replace('%', '')) / (operand.includes('%') ? 100 : 1)
    : null;
  const pattern = wildcard
    ? new RegExp(
        `^${operand
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        'i'
      )
    : null;
  return (value) => {
    if (wildcard && typeof value === 'string') {
      const hit = pattern.test(value);
      return operator === '<>' ? !hit : hit;
    }
    const target = asNumber !== null && operator !== '=' && operator !== '<>' ? asNumber : operand;
    const comparison = compareValues(value, asNumber !== null ? asNumber : target);
    if (isError(comparison)) return false;
    switch (operator) {
      case '=':
        return comparison === 0;
      case '<>':
        return comparison !== 0;
      case '<':
        return comparison < 0;
      case '<=':
        return comparison <= 0;
      case '>':
        return comparison > 0;
      case '>=':
        return comparison >= 0;
      default:
        return false;
    }
  };
}

function asMatrix(value) {
  const inner = unwrap(value);
  if (Array.isArray(inner)) return Array.isArray(inner[0]) ? inner : inner.map((entry) => [entry]);
  return [[inner]];
}

function countIf(range, criteria) {
  const test = makeCriteria(criteria);
  return flatten([range]).filter((value) => test(value)).length;
}

function countIfs(args) {
  const pairs = [];
  for (let index = 0; index + 1 < args.length; index += 2) {
    pairs.push([asMatrix(args[index]), makeCriteria(args[index + 1])]);
  }
  const length = pairs.reduce((best, [matrix]) => Math.max(best, flatten([matrix]).length), 0);
  let count = 0;
  for (let position = 0; position < length; position += 1) {
    const matched = pairs.every(([matrix, test]) => {
      const flat = flatten([matrix]);
      return test(flat[position]);
    });
    if (matched) count += 1;
  }
  return count;
}

function sumIf(criteriaRange, criteria, sumRange) {
  const test = makeCriteria(criteria);
  const criteriaValues = flatten([criteriaRange]);
  const sumValues = sumRange === undefined ? criteriaValues : flatten([sumRange]);
  let total = 0;
  for (let index = 0; index < criteriaValues.length; index += 1) {
    if (!test(criteriaValues[index])) continue;
    const numeric = toNumber(sumValues[index]);
    if (isError(numeric)) return numeric;
    total += numeric;
  }
  return total;
}

function sumIfs(args) {
  const sumValues = flatten([args[0]]);
  const pairs = [];
  for (let index = 1; index + 1 < args.length; index += 2) {
    pairs.push(makeCriteria(args[index + 1]));
    pairs[pairs.length - 1].values = flatten([args[index]]);
  }
  let total = 0;
  for (let position = 0; position < sumValues.length; position += 1) {
    const matched = pairs.every((test) => test(test.values[position]));
    if (!matched) continue;
    const numeric = toNumber(sumValues[position]);
    if (isError(numeric)) return numeric;
    total += numeric;
  }
  return total;
}

module.exports = { referencePosition, makeCriteria, asMatrix, countIf, countIfs, sumIf, sumIfs };
