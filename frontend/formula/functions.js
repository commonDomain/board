'use strict';

const { countIf, countIfs, referencePosition, sumIf, sumIfs } = require('./criteria');
const {
  addMonths,
  datePart,
  dateSerial,
  dateSerialFromMs,
  networkdays,
  serialToParts,
  timeSerial,
  workday
} = require('./dates');
const { hlookup, lookupLegacy, matchValue, vlookup, xlookup } = require('./lookup');
const {
  ceilingLike,
  extremum,
  findText,
  gcd,
  guardNumber,
  roundLike,
  sliceText,
  upperLower,
  variance
} = require('./math');
const { ERRORS, isError } = require('./references');
const {
  compareValues,
  flatten,
  isBlank,
  numbersOf,
  roundHalfAway,
  toBoolean,
  toNumber,
  toText,
  unwrap
} = require('./values');

const FUNCTIONS = {};

function defineFunctions(definitions) {
  for (const [name, implementation] of Object.entries(definitions)) FUNCTIONS[name] = implementation;
}

function firstError(args) {
  for (const value of args) {
    // Ranges keep their errors inside the matrix: aggregation functions decide
    // themselves whether a cell error cancels the result, so only a bare
    // scalar error argument short-circuits the call here.
    if (isError(value)) return value;
  }
  return null;
}

defineFunctions({
  // --- math and aggregation ------------------------------------------------
  SUM: (args) => {
    const numbers = numbersOf(args);
    if (isError(numbers)) return numbers;
    return numbers.reduce((sum, value) => sum + value, 0);
  },
  PRODUCT: (args) => {
    const numbers = numbersOf(args);
    if (isError(numbers)) return numbers;
    return numbers.reduce((product, value) => product * value, 1);
  },
  SUMSQ: (args) => {
    const numbers = numbersOf(args);
    if (isError(numbers)) return numbers;
    return numbers.reduce((sum, value) => sum + value * value, 0);
  },
  ABS: (args) => {
    const value = toNumber(args[0]);
    return isError(value) ? value : Math.abs(value);
  },
  SIGN: (args) => {
    const value = toNumber(args[0]);
    return isError(value) ? value : Math.sign(value);
  },
  SQRT: (args) => {
    const value = toNumber(args[0]);
    if (isError(value)) return value;
    return value < 0 ? ERRORS['#NUM!'] : Math.sqrt(value);
  },
  POWER: (args) => {
    const base = toNumber(args[0]);
    const exponent = toNumber(args[1]);
    if (isError(base)) return base;
    if (isError(exponent)) return exponent;
    const result = base ** exponent;
    return Number.isFinite(result) ? result : ERRORS['#NUM!'];
  },
  EXP: (args) => guardNumber(Math.exp(toNumber(args[0]))),
  LN: (args) => {
    const value = toNumber(args[0]);
    if (isError(value)) return value;
    return value <= 0 ? ERRORS['#NUM!'] : Math.log(value);
  },
  LOG: (args) => {
    const value = toNumber(args[0]);
    const base = args.length > 1 ? toNumber(args[1]) : 10;
    if (isError(value)) return value;
    if (isError(base)) return base;
    if (value <= 0 || base <= 0 || base === 1) return ERRORS['#NUM!'];
    return Math.log(value) / Math.log(base);
  },
  LOG10: (args) => {
    const value = toNumber(args[0]);
    if (isError(value)) return value;
    return value <= 0 ? ERRORS['#NUM!'] : Math.log10(value);
  },
  MOD: (args) => {
    const dividend = toNumber(args[0]);
    const divisor = toNumber(args[1]);
    if (isError(dividend)) return dividend;
    if (isError(divisor)) return divisor;
    if (divisor === 0) return ERRORS['#DIV/0!'];
    return dividend - divisor * Math.floor(dividend / divisor);
  },
  INT: (args) => guardNumber(Math.floor(toNumber(args[0]))),
  TRUNC: (args) => {
    const value = toNumber(args[0]);
    if (isError(value)) return value;
    const digits = args.length > 1 ? Math.trunc(toNumber(args[1])) : 0;
    if (isError(digits)) return digits;
    const factor = 10 ** digits;
    return Math.trunc(value * factor) / factor;
  },
  ROUND: (args) => roundLike(args, (value, digits) => roundHalfAway(value, digits)),
  ROUNDUP: (args) =>
    roundLike(args, (value, digits) => {
      const factor = 10 ** digits;
      const scaled = value * factor;
      return (scaled < 0 ? -Math.ceil(Math.abs(scaled)) : Math.ceil(scaled)) / factor;
    }),
  ROUNDDOWN: (args) =>
    roundLike(args, (value, digits) => {
      const factor = 10 ** digits;
      const scaled = value * factor;
      return (scaled < 0 ? -Math.floor(Math.abs(scaled)) : Math.floor(scaled)) / factor;
    }),
  CEILING: (args) => ceilingLike(args, Math.ceil),
  FLOOR: (args) => ceilingLike(args, Math.floor),
  MROUND: (args) => {
    const value = toNumber(args[0]);
    const multiple = toNumber(args[1]);
    if (isError(value)) return value;
    if (isError(multiple)) return multiple;
    if (multiple === 0) return 0;
    return roundHalfAway(value / multiple, 0) * multiple;
  },
  RAND: () => Math.random(),
  RANDBETWEEN: (args) => {
    const low = Math.ceil(toNumber(args[0]));
    const high = Math.floor(toNumber(args[1]));
    if (isError(low)) return low;
    if (isError(high)) return high;
    if (low > high) return ERRORS['#NUM!'];
    return low + Math.floor(Math.random() * (high - low + 1));
  },
  PI: () => Math.PI,
  SIN: (args) => guardNumber(Math.sin(toNumber(args[0]))),
  COS: (args) => guardNumber(Math.cos(toNumber(args[0]))),
  TAN: (args) => guardNumber(Math.tan(toNumber(args[0]))),
  ASIN: (args) => guardNumber(Math.asin(toNumber(args[0]))),
  ACOS: (args) => guardNumber(Math.acos(toNumber(args[0]))),
  ATAN: (args) => guardNumber(Math.atan(toNumber(args[0]))),
  ATAN2: (args) => guardNumber(Math.atan2(toNumber(args[0]), toNumber(args[1]))),
  DEGREES: (args) => guardNumber((toNumber(args[0]) * 180) / Math.PI),
  RADIANS: (args) => guardNumber((toNumber(args[0]) * Math.PI) / 180),
  GCD: (args) => {
    const numbers = numbersOf(args);
    if (isError(numbers)) return numbers;
    return numbers
      .map((value) => Math.abs(Math.trunc(value)))
      .reduce((left, right) => (right === 0 ? left : gcd(left, right)), 0);
  },
  LCM: (args) => {
    const numbers = numbersOf(args);
    if (isError(numbers)) return numbers;
    return numbers
      .map((value) => Math.abs(Math.trunc(value)))
      .reduce((left, right) => (left === 0 || right === 0 ? 0 : Math.abs(left * right) / gcd(left, right)), 1);
  },

  // --- statistics ----------------------------------------------------------
  COUNT: (args) => {
    let count = 0;
    for (const value of flatten(args)) {
      if (isBlank(value)) continue;
      if (typeof value === 'number') count += 1;
      else if (
        typeof value !== 'boolean' &&
        !isError(value) &&
        /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/.test(String(value).trim())
      )
        count += 1;
    }
    return count;
  },
  COUNTA: (args) => flatten(args).filter((value) => !isBlank(value) && !isError(value)).length,
  COUNTBLANK: (args) => flatten(args).filter((value) => isBlank(value)).length,
  AVERAGE: (args) => {
    const numbers = numbersOf(args);
    if (isError(numbers)) return numbers;
    if (!numbers.length) return ERRORS['#DIV/0!'];
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  },
  MAX: (args) => extremum(args, Math.max),
  MIN: (args) => extremum(args, Math.min),
  MEDIAN: (args) => {
    const numbers = numbersOf(args);
    if (isError(numbers)) return numbers;
    if (!numbers.length) return ERRORS['#NUM!'];
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  },
  STDEV: (args) => variance(args, true, true),
  STDEV_S: (args) => variance(args, true, true),
  STDEV_P: (args) => variance(args, true, false),
  VAR: (args) => variance(args, false, true),
  VAR_S: (args) => variance(args, false, true),
  VAR_P: (args) => variance(args, false, false),
  LARGE: (args) => {
    const numbers = numbersOf([args[0]]);
    const rank = Math.trunc(toNumber(args[1]));
    if (isError(numbers)) return numbers;
    if (isError(rank)) return rank;
    if (rank < 1 || rank > numbers.length) return ERRORS['#NUM!'];
    return [...numbers].sort((a, b) => b - a)[rank - 1];
  },
  SMALL: (args) => {
    const numbers = numbersOf([args[0]]);
    const rank = Math.trunc(toNumber(args[1]));
    if (isError(numbers)) return numbers;
    if (isError(rank)) return rank;
    if (rank < 1 || rank > numbers.length) return ERRORS['#NUM!'];
    return [...numbers].sort((a, b) => a - b)[rank - 1];
  },
  RANK: (args) => {
    const target = toNumber(args[0]);
    const numbers = numbersOf([args[1]]);
    const ascending = args.length > 2 ? toBoolean(args[2]) === true : false;
    if (isError(target)) return target;
    if (isError(numbers)) return numbers;
    const sorted = [...numbers].sort((a, b) => (ascending ? a - b : b - a));
    const index = sorted.findIndex((value) => value === target);
    return index < 0 ? ERRORS['#N/A'] : index + 1;
  },
  COUNTIF: (args) => countIf(args[0], args[1]),
  COUNTIFS: (args) => countIfs(args),
  SUMIF: (args) => sumIf(args[0], args[1], args[2]),
  SUMIFS: (args) => sumIfs(args),
  AVERAGEIF: (args) => {
    const result = sumIf(args[0], args[1], args[2]);
    if (isError(result)) return result;
    const count = countIf(args[0], args[1]);
    if (isError(count)) return count;
    return count === 0 ? ERRORS['#DIV/0!'] : result / count;
  },
  AVERAGEIFS: (args) => {
    const result = sumIfs([args[0], ...args.slice(1)]);
    if (isError(result)) return result;
    return result;
  },
  SUMPRODUCT: (args) => {
    const vectors = args.map((argument) => flatten([argument]));
    if (!vectors.length) return 0;
    const length = vectors[0].length;
    if (vectors.some((vector) => vector.length !== length)) return ERRORS['#VALUE!'];
    let total = 0;
    for (let index = 0; index < length; index += 1) {
      let product = 1;
      for (const vector of vectors) {
        const numeric = toNumber(vector[index]);
        if (isError(numeric)) return numeric;
        product *= numeric;
      }
      total += product;
    }
    return guardNumber(total);
  },
  SUBTOTAL: (args) => {
    const code = Math.trunc(toNumber(args[0]));
    if (isError(code)) return code;
    const values = args.slice(1);
    const normalized = code >= 101 ? code - 100 : code;
    if (normalized === 1) return FUNCTIONS.AVERAGE(values);
    if (normalized === 2) return FUNCTIONS.COUNT(values);
    if (normalized === 3) return FUNCTIONS.COUNTA(values);
    if (normalized === 9) return FUNCTIONS.SUM(values);
    if (normalized === 10) return FUNCTIONS.VAR(values);
    if (normalized === 11) return FUNCTIONS.STDEV(values);
    return ERRORS['#VALUE!'];
  },

  // --- logic ---------------------------------------------------------------
  IF: (args) => {
    const condition = toBoolean(args[0]);
    if (isError(condition)) return condition;
    if (condition) return args[1] !== undefined ? args[1] : true;
    return args[2] !== undefined ? args[2] : false;
  },
  IFERROR: (args) => {
    const value = unwrap(args[0]);
    return isError(value) ? args[1] : value;
  },
  IFNA: (args) => {
    const value = unwrap(args[0]);
    return value === ERRORS['#N/A'] ? args[1] : value;
  },
  IFS: (args) => {
    for (let index = 0; index + 1 < args.length; index += 2) {
      const condition = toBoolean(args[index]);
      if (isError(condition)) return condition;
      if (condition) return args[index + 1];
    }
    return ERRORS['#N/A'];
  },
  SWITCH: (args) => {
    const expression = unwrap(args[0]);
    const hasDefault = args.length % 2 === 0;
    const pairEnd = hasDefault ? args.length - 1 : args.length;
    for (let index = 1; index + 1 < pairEnd; index += 2) {
      const comparison = compareValues(expression, args[index]);
      if (!isError(comparison) && comparison === 0) return args[index + 1];
    }
    return hasDefault ? args[args.length - 1] : ERRORS['#N/A'];
  },
  AND: (args) => {
    const values = flatten(args).filter((value) => !isBlank(value));
    if (!values.length) return ERRORS['#VALUE!'];
    for (const value of values) {
      const bool = toBoolean(value);
      if (isError(bool)) return bool;
      if (!bool) return false;
    }
    return true;
  },
  OR: (args) => {
    const values = flatten(args).filter((value) => !isBlank(value));
    if (!values.length) return ERRORS['#VALUE!'];
    for (const value of values) {
      const bool = toBoolean(value);
      if (isError(bool)) return bool;
      if (bool) return true;
    }
    return false;
  },
  XOR: (args) => {
    const values = flatten(args).filter((value) => !isBlank(value));
    let count = 0;
    for (const value of values) {
      const bool = toBoolean(value);
      if (isError(bool)) return bool;
      if (bool) count += 1;
    }
    return count % 2 === 1;
  },
  NOT: (args) => {
    const bool = toBoolean(args[0]);
    return isError(bool) ? bool : !bool;
  },
  TRUE: () => true,
  FALSE: () => false,
  ISBLANK: (args) => isBlank(args[0]),
  ISNUMBER: (args) => typeof args[0] === 'number' && Number.isFinite(args[0]),
  ISTEXT: (args) => typeof args[0] === 'string' && !isError(args[0]),
  ISERROR: (args) => isError(args[0]),
  ISERR: (args) => isError(args[0]) && args[0] !== ERRORS['#N/A'],
  ISNA: (args) => args[0] === ERRORS['#N/A'],
  NA: () => ERRORS['#N/A'],

  // --- text ----------------------------------------------------------------
  CONCAT: (args) => {
    let output = '';
    for (const value of flatten(args)) {
      if (isError(value)) return value;
      output += toText(value);
    }
    return output;
  },
  CONCATENATE: (args) => FUNCTIONS.CONCAT(args),
  TEXTJOIN: (args) => {
    const delimiter = toText(args[0]);
    const ignoreEmpty = toBoolean(args[1]);
    if (isError(delimiter)) return delimiter;
    if (isError(ignoreEmpty)) return ignoreEmpty;
    const parts = [];
    for (const value of flatten(args.slice(2))) {
      if (isError(value)) return value;
      if (ignoreEmpty === true && isBlank(value)) continue;
      parts.push(toText(value));
    }
    return parts.join(delimiter);
  },
  LEN: (args) => {
    const text = toText(args[0]);
    return isError(text) ? text : text.length;
  },
  LEFT: (args) => sliceText(args, 'left'),
  RIGHT: (args) => sliceText(args, 'right'),
  MID: (args) => {
    const text = toText(args[0]);
    const start = Math.trunc(toNumber(args[1]));
    const length = Math.trunc(toNumber(args[2]));
    if (isError(text)) return text;
    if (isError(start)) return start;
    if (isError(length)) return length;
    if (start < 1 || length < 0) return ERRORS['#VALUE!'];
    return text.slice(start - 1, start - 1 + length);
  },
  UPPER: (args) => upperLower(args, (text) => text.toUpperCase()),
  LOWER: (args) => upperLower(args, (text) => text.toLowerCase()),
  PROPER: (args) =>
    upperLower(args, (text) =>
      text
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .replace(/\w+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    ),
  TRIM: (args) => {
    const text = toText(args[0]);
    return isError(text) ? text : text.trim().replace(/\s+/g, ' ');
  },
  CLEAN: (args) => {
    const text = toText(args[0]);
    return isError(text) ? text : text.replace(/[\u0000-\u001f\u007f]/g, '');
  },
  SUBSTITUTE: (args) => {
    const text = toText(args[0]);
    const search = toText(args[1]);
    const replacement = toText(args[2]);
    if (isError(text)) return text;
    if (isError(search)) return search;
    if (isError(replacement)) return replacement;
    if (search === '') return text;
    if (args[3] !== undefined) {
      const instance = Math.trunc(toNumber(args[3]));
      if (isError(instance)) return instance;
      if (instance < 1) return ERRORS['#VALUE!'];
      let seen = 0;
      let cursor = 0;
      let output = '';
      while (cursor <= text.length) {
        const found = text.indexOf(search, cursor);
        if (found < 0) break;
        seen += 1;
        if (seen === instance)
          return output + text.slice(cursor, found) + replacement + text.slice(found + search.length);
        output += text.slice(cursor, found + search.length);
        cursor = found + search.length;
      }
      return text;
    }
    return text.split(search).join(replacement);
  },
  REPLACE: (args) => {
    const text = toText(args[0]);
    const start = Math.trunc(toNumber(args[1]));
    const length = Math.trunc(toNumber(args[2]));
    const replacement = toText(args[3]);
    if (isError(text)) return text;
    if (isError(start)) return start;
    if (isError(length)) return length;
    if (isError(replacement)) return replacement;
    if (start < 1 || length < 0) return ERRORS['#VALUE!'];
    return text.slice(0, start - 1) + replacement + text.slice(start - 1 + length);
  },
  REPT: (args) => {
    const text = toText(args[0]);
    const count = Math.trunc(toNumber(args[1]));
    if (isError(text)) return text;
    if (isError(count)) return count;
    if (count < 0) return ERRORS['#VALUE!'];
    if (text.length * count > 100000) return ERRORS['#NUM!'];
    return text.repeat(count);
  },
  FIND: (args) => findText(args, true),
  SEARCH: (args) => findText(args, false),
  TEXT: (args, context) => {
    const value = unwrap(args[0]);
    const pattern = toText(args[1]);
    if (isError(value)) return value;
    if (isError(pattern)) return pattern;
    return context.formatValue(value, pattern);
  },
  VALUE: (args) => {
    const text = toText(args[0]);
    if (isError(text)) return text;
    const numeric = toNumber(text.replace(/,/g, ''));
    return numeric;
  },
  EXACT: (args) => toText(args[0]) === toText(args[1]),
  CHAR: (args) => {
    const code = Math.trunc(toNumber(args[0]));
    if (isError(code)) return code;
    if (code < 1 || code > 255) return ERRORS['#VALUE!'];
    return String.fromCharCode(code);
  },
  CODE: (args) => {
    const text = toText(args[0]);
    if (isError(text)) return text;
    return text.length ? text.charCodeAt(0) : ERRORS['#VALUE!'];
  },

  // --- lookup and reference ------------------------------------------------
  ROW: (args, context) => {
    const target = args.length ? referencePosition(args[0]) : context.currentCell;
    return target ? target.row + 1 : ERRORS['#VALUE!'];
  },
  COLUMN: (args, context) => {
    const target = args.length ? referencePosition(args[0]) : context.currentCell;
    return target ? target.column + 1 : ERRORS['#VALUE!'];
  },
  COLUMNS: (args) => (Array.isArray(args[0]) && Array.isArray(args[0][0]) ? args[0][0].length : 1),
  ROWS: (args) => (Array.isArray(args[0]) ? args[0].length : 1),
  INDEX: (args) => {
    if (!Array.isArray(args[0])) return args[0];
    const matrix = Array.isArray(args[0][0]) ? args[0] : args[0].map((value) => [value]);
    const rowIndex = Math.trunc(toNumber(args[1]));
    if (isError(rowIndex)) return rowIndex;
    const columnIndex = args.length > 2 ? Math.trunc(toNumber(args[2])) : rowIndex === 0 ? 0 : 1;
    if (isError(columnIndex)) return columnIndex;
    if (rowIndex === 0 && columnIndex === 0) return matrix;
    if (rowIndex === 0) {
      if (columnIndex < 1 || columnIndex > matrix[0].length) return ERRORS['#REF!'];
      return matrix.map((row) => row[columnIndex - 1]);
    }
    const row = matrix[rowIndex - 1];
    if (!row) return ERRORS['#REF!'];
    if (columnIndex === 0) return row;
    if (columnIndex < 1 || columnIndex > row.length) return ERRORS['#REF!'];
    return row[columnIndex - 1];
  },
  MATCH: (args) => matchValue(args[0], args[1], args.length > 2 ? Math.trunc(toNumber(args[2])) : 1),
  VLOOKUP: (args) =>
    vlookup(args[0], args[1], Math.trunc(toNumber(args[2])), args[3] === undefined ? true : toBoolean(args[3])),
  HLOOKUP: (args) =>
    hlookup(args[0], args[1], Math.trunc(toNumber(args[2])), args[3] === undefined ? true : toBoolean(args[3])),
  LOOKUP: (args) => lookupLegacy(args[0], args[1], args[2]),
  XLOOKUP: (args) => xlookup(args),

  // --- date and time -------------------------------------------------------
  TODAY: (args, context) => context.serialFromDate(context.now()),
  NOW: (args, context) => context.serialFromDate(context.now(), true),
  DATE: (args) =>
    dateSerial(Math.trunc(toNumber(args[0])), Math.trunc(toNumber(args[1])), Math.trunc(toNumber(args[2]))),
  TIME: (args) =>
    timeSerial(Math.trunc(toNumber(args[0])), Math.trunc(toNumber(args[1])), Math.trunc(toNumber(args[2]))),
  YEAR: (args) => datePart(args[0], 'year'),
  MONTH: (args) => datePart(args[0], 'month'),
  DAY: (args) => datePart(args[0], 'day'),
  HOUR: (args) => datePart(args[0], 'hour'),
  MINUTE: (args) => datePart(args[0], 'minute'),
  SECOND: (args) => datePart(args[0], 'second'),
  WEEKDAY: (args) => {
    const parts = serialToParts(toNumber(args[0]));
    if (isError(parts)) return parts;
    return parts.date.getUTCDay() + 1;
  },
  DAYS: (args) => {
    const end = toNumber(args[0]);
    const start = toNumber(args[1]);
    if (isError(end)) return end;
    if (isError(start)) return start;
    return Math.trunc(end) - Math.trunc(start);
  },
  DATEVALUE: (args) => {
    const text = toText(args[0]);
    if (isError(text)) return text;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? ERRORS['#VALUE!'] : dateSerialFromMs(parsed);
  },
  EDATE: (args) => addMonths(args[0], args[1], false),
  EOMONTH: (args) => addMonths(args[0], args[1], true),
  WORKDAY: (args) => workday(args[0], args[1], args[2]),
  NETWORKDAYS: (args) => networkdays(args[0], args[1], args[2])
});

const FUNCTION_HELP = Object.freeze({
  SUM: ['SUM(number1, [number2], …)', '对数字或区域求和', '=SUM(A1:A10)'],
  AVERAGE: ['AVERAGE(number1, [number2], …)', '计算数字的平均值', '=AVERAGE(B2:B12)'],
  IF: ['IF(condition, value_if_true, value_if_false)', '按条件返回两个结果之一', '=IF(C2>=60,"通过","未通过")'],
  IFS: [
    'IFS(condition1, value1, [condition2, value2], …)',
    '按顺序返回第一个成立条件的结果',
    '=IFS(A1>=90,"优",A1>=60,"合格",TRUE,"待改进")'
  ],
  SWITCH: [
    'SWITCH(expression, value1, result1, [default])',
    '将一个值与多个候选项匹配',
    '=SWITCH(A1,"A","甲","B","乙","其他")'
  ],
  XLOOKUP: [
    'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])',
    '在区域中查找并返回对应值',
    '=XLOOKUP(E2,A2:A20,B2:B20,"未找到")'
  ],
  SUMPRODUCT: ['SUMPRODUCT(array1, [array2], …)', '对数组逐项相乘后求和', '=SUMPRODUCT(B2:B8,C2:C8)'],
  SUBTOTAL: ['SUBTOTAL(function_num, ref1, [ref2], …)', '对区域执行分类汇总', '=SUBTOTAL(9,B2:B100)'],
  EDATE: ['EDATE(start_date, months)', '返回指定月数之前或之后的日期', '=EDATE(A1,3)'],
  EOMONTH: ['EOMONTH(start_date, months)', '返回指定月份的最后一天', '=EOMONTH(A1,0)'],
  WORKDAY: ['WORKDAY(start_date, days, [holidays])', '按工作日推算日期', '=WORKDAY(A1,10,H1:H5)'],
  NETWORKDAYS: ['NETWORKDAYS(start_date, end_date, [holidays])', '计算区间内的工作日数', '=NETWORKDAYS(A1,B1,H1:H5)'],
  VLOOKUP: [
    'VLOOKUP(lookup_value, table_array, col_index, [approximate])',
    '按首列查找并返回指定列',
    '=VLOOKUP(E2,A2:C20,3,FALSE)'
  ],
  COUNTIF: ['COUNTIF(range, criteria)', '统计符合条件的单元格', '=COUNTIF(B2:B20,">=60")']
});

const FUNCTION_METADATA = Object.freeze(
  Object.keys(FUNCTIONS)
    .sort()
    .map((name) => {
      const help = FUNCTION_HELP[name] || [`${name}(…)`, '兼容 Excel 的工作表函数', `=${name}(`];
      return Object.freeze({ name, signature: help[0], description: help[1], example: help[2], compatible: true });
    })
);

function getFunctionSuggestions(query, limit = 8) {
  const needle = String(query || '')
    .trim()
    .toUpperCase();
  const matches = FUNCTION_METADATA.filter((entry) => !needle || entry.name.startsWith(needle));
  return matches.slice(0, Math.max(1, Math.min(50, Number(limit) || 8)));
}

module.exports = { FUNCTIONS, defineFunctions, firstError, FUNCTION_HELP, FUNCTION_METADATA, getFunctionSuggestions };
