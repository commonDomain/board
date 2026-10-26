'use strict';

const { serialFromDate } = require('./dates');
const { formatValue } = require('./format');
const { FUNCTIONS, firstError } = require('./functions');
const { guardNumber } = require('./math');
const { parseFormula } = require('./parser');
const { ERRORS, isError } = require('./references');
const { BLANK, compareValues, toNumber, toText } = require('./values');

function createEvaluator(workbook) {
  const cache = new Map(); // "sheetIndex:row:column" -> value
  const dependencies = new Map(); // formula key -> directly referenced cell keys
  const dependents = new Map(); // referenced cell key -> formula keys
  const rangeDependencies = new Map(); // formula key -> compact rectangular dependencies
  const rangeDependents = new Map(); // sheet index -> formula key -> rectangles
  const evaluationOwners = [];
  let epoch = 0;
  const resolver = (workbook && workbook.resolver) || defaultResolver;

  function defaultResolver() {
    return null;
  }

  function bumpEpoch() {
    epoch += 1;
    cache.clear();
    dependencies.clear();
    dependents.clear();
    rangeDependencies.clear();
    rangeDependents.clear();
  }

  function clearDependencies(ownerKey) {
    const previous = dependencies.get(ownerKey);
    if (previous) {
      for (const sourceKey of previous) {
        const owners = dependents.get(sourceKey);
        if (!owners) continue;
        owners.delete(ownerKey);
        if (!owners.size) dependents.delete(sourceKey);
      }
      dependencies.delete(ownerKey);
    }
    const previousRanges = rangeDependencies.get(ownerKey);
    if (previousRanges) {
      for (const range of previousRanges) {
        const owners = rangeDependents.get(range.sheetIndex);
        owners?.delete(ownerKey);
        if (owners && !owners.size) rangeDependents.delete(range.sheetIndex);
      }
      rangeDependencies.delete(ownerKey);
    }
  }

  function trackDependency(sourceKey) {
    const ownerKey = evaluationOwners[evaluationOwners.length - 1];
    if (!ownerKey || ownerKey === sourceKey) return;
    let sources = dependencies.get(ownerKey);
    if (!sources) {
      sources = new Set();
      dependencies.set(ownerKey, sources);
    }
    if (sources.has(sourceKey)) return;
    sources.add(sourceKey);
    let owners = dependents.get(sourceKey);
    if (!owners) {
      owners = new Set();
      dependents.set(sourceKey, owners);
    }
    owners.add(ownerKey);
  }

  function trackRangeDependency(range) {
    const ownerKey = evaluationOwners[evaluationOwners.length - 1];
    if (!ownerKey) return;
    let owned = rangeDependencies.get(ownerKey);
    if (!owned) {
      owned = [];
      rangeDependencies.set(ownerKey, owned);
    }
    if (
      !owned.some(
        (entry) =>
          entry.sheetIndex === range.sheetIndex &&
          entry.startRow === range.startRow &&
          entry.endRow === range.endRow &&
          entry.startColumn === range.startColumn &&
          entry.endColumn === range.endColumn
      )
    ) {
      owned.push(range);
    }
    let owners = rangeDependents.get(range.sheetIndex);
    if (!owners) {
      owners = new Map();
      rangeDependents.set(range.sheetIndex, owners);
    }
    owners.set(ownerKey, owned);
  }

  function downstreamForKey(key) {
    const downstream = new Set(dependents.get(key) || []);
    const parts = key.split(':').map(Number);
    if (parts.length === 3 && parts.every(Number.isInteger)) {
      const [sheetIndex, row, column] = parts;
      for (const [ownerKey, ranges] of rangeDependents.get(sheetIndex) || []) {
        if (
          ranges.some(
            (range) =>
              row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn
          )
        ) {
          downstream.add(ownerKey);
        }
      }
    }
    return Array.from(downstream);
  }

  function invalidateKey(key, visited = new Set()) {
    if (visited.has(key)) return;
    visited.add(key);
    const downstream = downstreamForKey(key);
    cache.delete(key);
    clearDependencies(key);
    dependents.delete(key);
    for (const dependentKey of downstream) invalidateKey(dependentKey, visited);
  }

  function invalidateCell(sheetIndex, row, column) {
    epoch += 1;
    invalidateKey(`${sheetIndex}:${row}:${column}`);
  }

  function sheetIndexByName(name) {
    if (!name) return null;
    const wanted = String(name).toUpperCase();
    for (let index = 0; index < workbook.sheets.length; index += 1) {
      if (String(workbook.sheets[index].name || '').toUpperCase() === wanted) return index;
    }
    return null;
  }

  function rawCell(sheetIndex, row, column) {
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) return null;
    const cell = sheet.cells && sheet.cells[`${row}:${column}`];
    return cell || null;
  }

  function resolveRef(sheetIndex, row, column) {
    return { sheetIndex, row, column };
  }

  function currentSheetIndex() {
    return workbook.__evaluatingSheet ?? 0;
  }

  function evaluateCell(sheetIndex, row, column, stack) {
    const key = `${sheetIndex}:${row}:${column}`;
    if (cache.has(key)) return cache.get(key);
    const cell = rawCell(sheetIndex, row, column);
    if (!cell) {
      // Empty range members are intentionally not interned as string keys.
      // Large sparse formulas therefore keep memory proportional to actual
      // data plus one compact range dependency, not to the rectangle area.
      return null;
    }
    if (cell.f) {
      if (stack.has(key)) {
        cache.set(key, ERRORS['#CIRC!']);
        return ERRORS['#CIRC!'];
      }
      const parsed = parseFormula(cell.f);
      if (parsed.error) {
        cache.set(key, parsed.error);
        return parsed.error;
      }
      clearDependencies(key);
      const nextStack = new Set(stack);
      nextStack.add(key);
      const previousSheet = workbook.__evaluatingSheet;
      const previousCell = workbook.__evaluatingCell;
      workbook.__evaluatingSheet = sheetIndex;
      workbook.__evaluatingCell = { sheetIndex, row, column };
      evaluationOwners.push(key);
      let value;
      try {
        value = evaluateNode(parsed.ast, nextStack);
      } finally {
        evaluationOwners.pop();
        workbook.__evaluatingSheet = previousSheet;
        workbook.__evaluatingCell = previousCell;
      }
      if (Array.isArray(value)) value = Array.isArray(value[0]) ? value[0][0] : value[0];
      cache.set(key, value);
      return value;
    }
    const value = cell.v === undefined ? null : cell.v;
    cache.set(key, value);
    return value;
  }

  function evaluateNode(node, stack) {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'string':
        return node.value;
      case 'bool':
        return node.value;
      case 'error':
        return node.value;
      case 'percent': {
        const operand = toNumber(evaluateNode(node.operand, stack));
        return isError(operand) ? operand : operand / 100;
      }
      case 'unary': {
        const operand = toNumber(evaluateNode(node.operand, stack));
        if (isError(operand)) return operand;
        return node.operator === '-' ? -operand : operand;
      }
      case 'name':
        return resolver(node.name, workbook);
      case 'ref': {
        const sheetIndex = node.sheet ? sheetIndexByName(node.sheet) : currentSheetIndex();
        if (sheetIndex === null || sheetIndex === undefined) return ERRORS['#REF!'];
        trackDependency(`${sheetIndex}:${node.row}:${node.column}`);
        const value = evaluateCell(sheetIndex, node.row, node.column, stack);
        return value === null ? BLANK : value;
      }
      case 'range': {
        const sheetIndex = node.sheet ? sheetIndexByName(node.sheet) : currentSheetIndex();
        if (sheetIndex === null || sheetIndex === undefined) return ERRORS['#REF!'];
        const startRow = Math.min(node.start.row, node.end.row);
        const endRow = Math.max(node.start.row, node.end.row);
        const startColumn = Math.min(node.start.column, node.end.column);
        const endColumn = Math.max(node.start.column, node.end.column);
        const span = (endRow - startRow + 1) * (endColumn - startColumn + 1);
        // Keep a single recalculation inside the interactive 50k-cell budget.
        // Larger imported sheets are sharded before they reach the evaluator.
        if (span > 50000) return ERRORS['#NUM!'];
        trackRangeDependency({ sheetIndex, startRow, endRow, startColumn, endColumn });
        const matrix = [];
        for (let row = startRow; row <= endRow; row += 1) {
          const line = [];
          for (let column = startColumn; column <= endColumn; column += 1) {
            const value = evaluateCell(sheetIndex, row, column, stack);
            line.push(value === null ? BLANK : value);
          }
          matrix.push(line);
        }
        return matrix;
      }
      case 'binary': {
        const left = evaluateNode(node.left, stack);
        const right = evaluateNode(node.right, stack);
        return applyBinary(node.operator, left, right);
      }
      case 'call': {
        const implementation = FUNCTIONS[node.name];
        if (!implementation) {
          // A name followed by parentheses may still be an unknown function.
          return ERRORS['#NAME?'];
        }
        const args = node.args.map((argument) => {
          const value = evaluateNode(argument, stack);
          // A bare cell reference also carries its coordinates so ROW(),
          // COLUMN() and the reference family can report position.
          if (argument.type === 'ref' && !isError(value)) {
            const sheetIndex = argument.sheet ? sheetIndexByName(argument.sheet) : currentSheetIndex();
            return { __ref: { sheetIndex, row: argument.row, column: argument.column }, value };
          }
          return value;
        });
        // Error handlers must see the error itself, so they bypass the
        // scalar-error short-circuit that every other function gets.
        const tolerant = node.name === 'IFERROR' || node.name === 'IFNA';
        if (!tolerant) {
          const error = firstError(args);
          if (error) return error;
        }
        const context = {
          now: () => new Date(),
          serialFromDate,
          formatValue,
          currentCell: workbook.__evaluatingCell || { sheetIndex: currentSheetIndex(), row: 0, column: 0 }
        };
        try {
          return implementation(args, context);
        } catch (thrown) {
          return ERRORS['#VALUE!'];
        }
      }
      default:
        return ERRORS['#VALUE!'];
    }
  }

  function applyBinary(operator, left, right) {
    if (isError(left)) return left;
    if (isError(right)) return right;
    if (operator === '&') {
      const leftText = toText(left);
      const rightText = toText(right);
      if (isError(leftText)) return leftText;
      if (isError(rightText)) return rightText;
      return leftText + rightText;
    }
    if (['=', '<>', '<', '<=', '>', '>='].includes(operator)) {
      const comparison = compareValues(left, right);
      if (isError(comparison)) return comparison;
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
        default:
          return comparison >= 0;
      }
    }
    const leftNumber = toNumber(left);
    const rightNumber = toNumber(right);
    if (isError(leftNumber)) return leftNumber;
    if (isError(rightNumber)) return rightNumber;
    switch (operator) {
      case '+':
        return guardNumber(leftNumber + rightNumber);
      case '-':
        return guardNumber(leftNumber - rightNumber);
      case '*':
        return guardNumber(leftNumber * rightNumber);
      case '/':
        if (rightNumber === 0) return ERRORS['#DIV/0!'];
        return guardNumber(leftNumber / rightNumber);
      case '^': {
        const result = leftNumber ** rightNumber;
        return Number.isFinite(result) ? result : ERRORS['#NUM!'];
      }
      default:
        return ERRORS['#VALUE!'];
    }
  }

  return {
    /** Evaluates one cell and returns its display-ready value. */
    getValue(sheetIndex, row, column) {
      const value = evaluateCell(sheetIndex, row, column, new Set());
      return value === null || value === BLANK ? null : value;
    },
    /** Evaluates a rectangular range into a 2D matrix of values. */
    getMatrix(sheetIndex, startRow, startColumn, endRow, endColumn) {
      const span = Math.max(0, endRow - startRow + 1) * Math.max(0, endColumn - startColumn + 1);
      if (span > 50000) return [[ERRORS['#NUM!']]];
      const matrix = [];
      for (let row = startRow; row <= endRow; row += 1) {
        const line = [];
        for (let column = startColumn; column <= endColumn; column += 1) {
          line.push(this.getValue(sheetIndex, row, column));
        }
        matrix.push(line);
      }
      return matrix;
    },
    bumpEpoch,
    invalidateCell,
    get epoch() {
      return epoch;
    },
    get dependencyStats() {
      let direct = 0;
      for (const sources of dependencies.values()) direct += sources.size;
      let ranges = 0;
      for (const entries of rangeDependencies.values()) ranges += entries.length;
      return { direct, ranges, cacheEntries: cache.size };
    },
    sheetIndexByName,
    resolveRef
  };
}

module.exports = { createEvaluator };
