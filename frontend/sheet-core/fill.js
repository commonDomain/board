'use strict';

const { MAX_DISPLAY_ROWS, key, shiftFormula } = require('./model');

function createFill({ activeSheet, mutate, readRange }) {
  function seriesValueAt(seedValues, index) {
    const seeds = seedValues.map((entry) => unwrapCellValue(entry));
    if (index >= 0 && index < seeds.length) return seeds[index];
    const continuous = seeds.every((value) => value === null || typeof value === 'number' || typeof value === 'string');
    if (!continuous) return null;
    const kind = detectSeriesKind(seeds);
    if (!kind) return null;
    if (kind === 'number') {
      const numbers = seeds.map(toFiniteNumber);
      if (numbers.some((value) => value === null)) return null;
      const first = numbers[0];
      const step = seeds.length >= 2 ? (numbers[numbers.length - 1] - first) / (seeds.length - 1) : 1;
      if (!Number.isFinite(step)) return null;
      const value = first + step * index;
      // Whole-number seeds must not drift into floats through repeated adds.
      return seeds.every((seed) => Number.isInteger(seed)) ? Math.round(value) : value;
    }
    if (kind === 'date' || kind === 'time') {
      const values = seeds.map(toFiniteNumber);
      if (values.some((value) => value === null)) return null;
      const step = values.length >= 2 ? values[1] - values[0] : kind === 'time' ? 1 / 24 : 1;
      if (step === 0) return null;
      return values[0] + step * index;
    }
    if (kind === 'text-number') {
      const parsed = seeds.map((value) => parseTextNumber(value));
      if (parsed.some((entry) => !entry)) return null;
      return formatTextNumber(parsed[0], index);
    }
    if (kind === 'month' || kind === 'month-cn' || kind === 'weekday' || kind === 'weekday-cn') {
      const table = SERIES_WORDS[kind];
      const start = table.indexOf(String(seeds[0]));
      if (start < 0) return null;
      return table[(start + index) % table.length];
    }
    return null;
  }

  function nextSeriesValue(seedValues, offset) {
    const seeds = seedValues.map((entry) => unwrapCellValue(entry));
    return seriesValueAt(seedValues, seeds.length + (offset || 0));
  }

  const SERIES_WORDS = {
    month: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ],
    'month-cn': ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
    weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    'weekday-cn': ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
  };

  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function detectSeriesKind(seeds) {
    if (!seeds.length) return null;
    const raw = seeds[0];
    if (raw && typeof raw === 'object' && raw.f) {
      // Formulas simply repeat relative to the target (handled by the caller).
      return null;
    }
    if (typeof raw === 'number') {
      const asDate = serialLooksLikeDate(seeds);
      return asDate;
    }
    const text = String(raw ?? '');
    if (!text) return null;
    for (const key of Object.keys(SERIES_WORDS)) {
      if (SERIES_WORDS[key].includes(text)) return key;
    }
    const lower = text.toLowerCase();
    const shortMonth = MONTH_SHORT.findIndex((name) => name.toLowerCase() === lower);
    if (shortMonth >= 0) return 'month';
    const shortDay = WEEKDAY_SHORT.findIndex((name) => name.toLowerCase() === lower);
    if (shortDay >= 0) return 'weekday';
    if (parseTextNumber(text)) return 'text-number';
    return null;
  }

  function serialLooksLikeDate(seeds) {
    const values = seeds.map(toFiniteNumber);
    if (values.some((value) => value === null)) return 'number';
    // Excel's own ambiguity: a bare number is a number, but a run of values in
    // the date serial range is far more likely to be dates.
    const allIntegers = values.every((value) => Number.isInteger(value));
    if (!allIntegers) {
      const looksLikeFractionalDay = values.every(
        (value) => value >= 0 && value < 1 && Math.abs(value * 24 - Math.round(value * 24)) < 1e-6
      );
      if (looksLikeFractionalDay) return 'time';
      return 'number';
    }
    const inDateRange = values.every((value) => value >= 20000 && value <= 80000);
    return inDateRange ? 'date' : 'number';
  }

  function parseTextNumber(text) {
    const match = /^(.*?)(\d+)(\D*)$/.exec(String(text ?? ''));
    if (!match) return null;
    return { prefix: match[1], digits: match[2], suffix: match[3] };
  }

  function formatTextNumber(parsed, offset) {
    const next = String(Number(parsed.digits) + offset);
    const width = parsed.digits.startsWith('0') ? Math.max(parsed.digits.length, next.length) : next.length;
    return `${parsed.prefix}${next.padStart(width, '0')}${parsed.suffix}`;
  }

  function unwrapCellValue(entry) {
    if (entry && typeof entry === 'object') {
      if (entry.f !== undefined) return entry;
      return entry.v === undefined ? null : entry.v;
    }
    return entry === undefined ? null : entry;
  }

  function toFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' && value.trim() !== '') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
    return null;
  }

  function fillRange(source, target) {
    return mutate('fill', () => {
      const sheet = activeSheet();
      const sourceMatrix = readRange(source).cells;
      const vertical = target.endRow - target.startRow > target.endColumn - target.startColumn;
      const seeds = (vertical ? sourceMatrix.map((line) => line[0]) : sourceMatrix[0] || [])
        .filter((cell) => cell && cell.f === undefined)
        .map((cell) => (cell.v === undefined ? null : cell.v));
      const seedCount = vertical ? source.endRow - source.startRow + 1 : source.endColumn - source.startColumn + 1;
      const downward = vertical ? target.endRow > source.endRow : target.endColumn > source.endColumn;

      // Enumerate cells strictly outside the seed block, nearest first.
      const targets = [];
      const span = vertical
        ? {
            outerStart: target.startRow,
            outerEnd: target.endRow,
            innerStart: target.startColumn,
            innerEnd: target.endColumn
          }
        : {
            outerStart: target.startColumn,
            outerEnd: target.endColumn,
            innerStart: target.startRow,
            innerEnd: target.endRow
          };
      const sourceOuterStart = vertical ? source.startRow : source.startColumn;
      const sourceOuterEnd = vertical ? source.endRow : source.endColumn;
      const outside = [];
      for (let outer = span.outerStart; outer <= span.outerEnd; outer += 1) {
        const insideSeed = outer >= sourceOuterStart && outer <= sourceOuterEnd;
        if (!insideSeed) outside.push(outer);
      }
      outside.sort((a, b) => (downward ? a - b : b - a));
      for (const outer of outside) {
        for (let inner = span.innerStart; inner <= span.innerEnd; inner += 1) {
          const candidate = vertical ? { row: outer, column: inner } : { row: inner, column: outer };
          const insideSeed =
            candidate.row >= source.startRow &&
            candidate.row <= source.endRow &&
            candidate.column >= source.startColumn &&
            candidate.column <= source.endColumn;
          if (insideSeed) continue;
          targets.push(candidate);
        }
      }

      let written = 0;
      // A filled cell feeds the next one: a single "1" drags into 1, 2, 3, 4.
      // The ordinal is the distance from the seed block's near edge, which is
      // the seed length for the first filled cell and keeps growing away from
      // the block, so upward/leftward drags continue the series in order.
      const ordinal = new Map();
      const seedBlockMin = vertical ? source.startRow : source.startColumn;
      const seedBlockMax = vertical ? source.endRow : source.endColumn;
      const seedEdge = downward ? seedBlockMax : seedBlockMin;
      targets.forEach(({ row, column }) => {
        const line = vertical ? column : row;
        const along = vertical ? row : column;
        // Targets inside the seed block already hold their values.
        if (along >= seedBlockMin && along <= seedBlockMax) return;
        const position = ordinal.get(line) || { value: seeds.length, seed: 0 };
        const sourcePosition = seedPositionFor(position.seed % seedCount, seedCount, vertical, source);
        const seed = seedCellAt(sourceMatrix, sourcePosition, vertical, source, downward);
        position.seed += 1;
        if (!seed) {
          ordinal.set(line, position);
          return;
        }
        const distance = Math.abs(along - seedEdge);
        const cellKey = key(row, column);
        const next = {};
        if (seed.f) {
          next.f = shiftFormula(seed.f, row - sourcePosition.row, column - sourcePosition.column);
        } else if (seed.v !== undefined) {
          // Take whichever is further along: the value consumed from the seed
          // block, or the distance travelled. A 2, 4 seed therefore continues
          // at 6 while a single 1 continues at 2.
          const signedDistance = downward ? distance : -distance;
          const valueIndex = Math.abs(signedDistance) >= Math.abs(position.value) ? signedDistance : position.value;
          const value = seriesValueAt(seeds, valueIndex);
          next.v = value === null || value === undefined ? seed.v : value;
          position.value = valueIndex + (downward ? 1 : -1);
        }
        if (seed.s) next.s = seed.s;
        if (next.f === undefined && next.v === undefined) delete sheet.cells[cellKey];
        else sheet.cells[cellKey] = next;
        ordinal.set(line, position);
        written += 1;
      });
      return written;
    });
  }

  function seedPositionFor(index, seedCount, vertical, source) {
    if (index < seedCount) {
      return vertical
        ? { row: source.startRow + index, column: source.startColumn }
        : { row: source.startRow, column: source.startColumn + index };
    }
    // Past the seed, keep cycling so formulas repeat their relative step.
    const cycleIndex = index % seedCount;
    return vertical
      ? { row: source.startRow + cycleIndex, column: source.startColumn }
      : { row: source.startRow, column: source.startColumn + cycleIndex };
  }

  function seedCellAt(sourceMatrix, position, vertical, source, downward) {
    if (!sourceMatrix.length) return null;
    if (vertical) {
      const spanIndex = position.row - source.startRow;
      // Filling upwards reads the seed bottom-up so the series keeps its order.
      const rowIndex = downward ? spanIndex : source.endRow - source.startRow - spanIndex;
      const cell = sourceMatrix[rowIndex]?.[0];
      return cell ? { ...cell, row: source.startRow + rowIndex, column: source.startColumn } : null;
    }
    const spanIndex = position.column - source.startColumn;
    const columnIndex = downward ? spanIndex : source.endColumn - source.startColumn - spanIndex;
    const cell = sourceMatrix[0]?.[columnIndex];
    return cell ? { ...cell, row: source.startRow, column: source.startColumn + columnIndex } : null;
  }

  function fillDownRange(range) {
    const sheet = activeSheet();
    const probeColumn = range.endColumn + 1;
    let lastRow = range.endRow;
    const limit = Math.min(MAX_DISPLAY_ROWS, range.endRow + 5000);
    for (let row = range.endRow + 1; row < limit; row += 1) {
      const probe = sheet.cells[key(row, probeColumn)];
      if (!probe) break;
      lastRow = row;
    }
    if (lastRow <= range.endRow) return 0;
    return fillRange(range, {
      startRow: range.startRow,
      startColumn: range.startColumn,
      endRow: lastRow,
      endColumn: range.endColumn
    });
  }

  return {
    seriesValueAt,
    nextSeriesValue,
    detectSeriesKind,
    serialLooksLikeDate,
    parseTextNumber,
    formatTextNumber,
    unwrapCellValue,
    toFiniteNumber,
    fillRange,
    seedPositionFor,
    seedCellAt,
    fillDownRange
  };
}

module.exports = { createFill };
