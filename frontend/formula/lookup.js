'use strict';

const { asMatrix } = require('./criteria');
const { ERRORS, isError } = require('./references');
const { compareValues, flatten, isBlank, toNumber, unwrap } = require('./values');

function exactPosition(values, lookup) {
  const wanted = unwrap(lookup);
  for (let index = 0; index < values.length; index += 1) {
    const candidate = unwrap(values[index]);
    if (isBlank(candidate)) continue;
    if (typeof candidate === 'number' && typeof wanted === 'number') {
      if (candidate === wanted) return index + 1;
      continue;
    }
    if (typeof candidate === 'boolean' || typeof wanted === 'boolean') {
      if (candidate === wanted) return index + 1;
      continue;
    }
    if (String(candidate).toUpperCase() === String(wanted).toUpperCase()) return index + 1;
  }
  return ERRORS['#N/A'];
}

function matchValue(lookup, vector, matchType) {
  const values = Array.isArray(vector) ? vector : [vector];
  if (isError(lookup)) return lookup;
  if (matchType === 0) return exactPosition(values, lookup);
  let best = -1;
  for (let index = 0; index < values.length; index += 1) {
    const comparison = compareValues(values[index], lookup);
    if (isError(comparison)) continue;
    if (matchType > 0 ? comparison <= 0 : comparison >= 0) best = index;
    else break;
  }
  return best < 0 ? ERRORS['#N/A'] : best + 1;
}

function vlookup(lookup, table, columnIndex, approximate) {
  const matrix = asMatrix(table);
  if (isError(lookup)) return lookup;
  if (isError(columnIndex)) return columnIndex;
  if (columnIndex < 1) return ERRORS['#VALUE!'];
  const column = matrix.map((row) => row[0]);
  const position = matchValue(lookup, column, approximate === false ? 0 : 1);
  if (isError(position)) return position;
  const row = matrix[position - 1];
  if (!row || columnIndex > row.length) return ERRORS['#REF!'];
  return row[columnIndex - 1];
}

function hlookup(lookup, table, rowIndex, approximate) {
  const matrix = asMatrix(table);
  if (isError(lookup)) return lookup;
  if (isError(rowIndex)) return rowIndex;
  if (rowIndex < 1) return ERRORS['#VALUE!'];
  const header = matrix[0] || [];
  const position = matchValue(lookup, header, approximate === false ? 0 : 1);
  if (isError(position)) return position;
  const row = matrix[rowIndex - 1];
  if (!row) return ERRORS['#REF!'];
  return row[position - 1];
}

function lookupLegacy(lookup, searchRange, resultRange) {
  const search = flatten([searchRange]);
  const result = resultRange === undefined ? search : flatten([resultRange]);
  const position = matchValue(lookup, search, 1);
  if (isError(position)) return position;
  const value = result[position - 1];
  return value === undefined ? ERRORS['#N/A'] : value;
}

function xlookup(args) {
  const lookup = unwrap(args[0]);
  const search = flatten([args[1]]);
  const result = flatten([args[2]]);
  if (!search.length || search.length !== result.length) return ERRORS['#VALUE!'];
  const notFound = args.length > 3 ? args[3] : ERRORS['#N/A'];
  const matchMode = args.length > 4 ? Math.trunc(toNumber(args[4])) : 0;
  const searchMode = args.length > 5 ? Math.trunc(toNumber(args[5])) : 1;
  if (isError(matchMode)) return matchMode;
  if (isError(searchMode)) return searchMode;
  const indexes = Array.from({ length: search.length }, (_, index) => index);
  if (searchMode === -1) indexes.reverse();
  let wildcard = null;
  if (matchMode === 2) {
    const escaped = String(lookup)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    wildcard = new RegExp(`^${escaped}$`, 'i');
  }
  for (const index of indexes) {
    if (wildcard ? wildcard.test(String(unwrap(search[index]))) : compareValues(search[index], lookup) === 0)
      return result[index];
  }
  if (matchMode === -1 || matchMode === 1) {
    let best = -1;
    for (const index of indexes) {
      const comparison = compareValues(search[index], lookup);
      if (isError(comparison)) continue;
      if (matchMode === -1 ? comparison <= 0 : comparison >= 0) {
        if (
          best < 0 ||
          (matchMode === -1
            ? compareValues(search[index], search[best]) > 0
            : compareValues(search[index], search[best]) < 0)
        )
          best = index;
      }
    }
    if (best >= 0) return result[best];
  }
  return notFound;
}

const MS_PER_DAY = 86400000;

module.exports = { exactPosition, matchValue, vlookup, hlookup, lookupLegacy, xlookup, MS_PER_DAY };
