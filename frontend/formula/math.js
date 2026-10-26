'use strict';

const { ERRORS, isError } = require('./references');
const { numbersOf, toNumber, toText } = require('./values');

function guardNumber(value) {
  if (isError(value)) return value;
  return Number.isFinite(value) ? value : ERRORS['#NUM!'];
}

function roundLike(args, operation) {
  const value = toNumber(args[0]);
  const digits = args.length > 1 ? Math.trunc(toNumber(args[1])) : 0;
  if (isError(value)) return value;
  if (isError(digits)) return digits;
  return guardNumber(operation(value, digits));
}

function ceilingLike(args, operation) {
  const value = toNumber(args[0]);
  const significance = args.length > 1 ? toNumber(args[1]) : 1;
  if (isError(value)) return value;
  if (isError(significance)) return significance;
  if (significance === 0) return 0;
  return guardNumber(operation(value / significance) * significance);
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function extremum(args, operation) {
  const numbers = numbersOf(args);
  if (isError(numbers)) return numbers;
  if (!numbers.length) return 0;
  return numbers.reduce((best, value) => operation(best, value));
}

function variance(args, wantStandardDeviation, sample) {
  const numbers = numbersOf(args);
  if (isError(numbers)) return numbers;
  const divisor = sample ? numbers.length - 1 : numbers.length;
  if (numbers.length === 0 || divisor <= 0) return ERRORS['#DIV/0!'];
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const sumSquares = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const result = sumSquares / divisor;
  return wantStandardDeviation ? Math.sqrt(result) : result;
}

function sliceText(args, side) {
  const text = toText(args[0]);
  if (isError(text)) return text;
  const count = args.length > 1 ? Math.trunc(toNumber(args[1])) : 1;
  if (isError(count)) return count;
  if (count < 0) return ERRORS['#VALUE!'];
  return side === 'left' ? text.slice(0, count) : text.slice(Math.max(0, text.length - count));
}

function upperLower(args, transform) {
  const text = toText(args[0]);
  return isError(text) ? text : transform(text);
}

function findText(args, caseSensitive) {
  const needle = toText(args[0]);
  const haystack = toText(args[1]);
  const start = args.length > 2 ? Math.trunc(toNumber(args[2])) : 1;
  if (isError(needle)) return needle;
  if (isError(haystack)) return haystack;
  if (isError(start)) return start;
  if (start < 1 || start > haystack.length + 1) return ERRORS['#VALUE!'];
  const index = caseSensitive
    ? haystack.indexOf(needle, start - 1)
    : haystack.toLowerCase().indexOf(needle.toLowerCase(), start - 1);
  return index < 0 ? ERRORS['#VALUE!'] : index + 1;
}

module.exports = { guardNumber, roundLike, ceilingLike, gcd, extremum, variance, sliceText, upperLower, findText };
