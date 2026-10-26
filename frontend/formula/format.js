'use strict';

const { serialToParts } = require('./dates');
const { isError } = require('./references');
const { roundHalfAway, toText } = require('./values');

const BUILT_IN_FORMATS = {
  general: 'General',
  number: '#,##0.00',
  integer: '#,##0',
  currency: '¥#,##0.00',
  accounting: '¥#,##0.00;[Red]-¥#,##0.00',
  percent: '0.00%',
  percentInteger: '0%',
  scientific: '0.00E+00',
  date: 'yyyy-mm-dd',
  dateTime: 'yyyy-mm-dd hh:mm',
  time: 'hh:mm:ss',
  text: '@'
};

function pad(value, length = 2) {
  return String(Math.abs(Math.trunc(value))).padStart(length, '0');
}

function formatValue(value, pattern) {
  if (isError(value)) return value;
  if (value === null || value === undefined || value === '') return '';
  const spec = BUILT_IN_FORMATS[pattern] || String(pattern ?? 'General');
  if (spec === 'General' || spec === '@') return toText(value);
  if (spec === '@') return String(value);
  if (typeof value !== 'number') {
    if (spec === 'General') return String(value);
    return String(value);
  }
  // Sections: positive;negative;zero;text
  const sections = spec.split(';');
  const section = value > 0 ? sections[0] : value < 0 ? sections[1] || sections[0] : sections[2] || sections[0];
  let working = section;
  let color = null;
  const colorMatch = /^\[(Red|Blue|Green|Black|White|Yellow|Magenta|Cyan)\]/i.exec(working);
  if (colorMatch) {
    color = colorMatch[1].toLowerCase();
    working = working.slice(colorMatch[0].length);
  }
  const numeric = Math.abs(value);
  const percentCount = (working.match(/%/g) || []).length;
  let scaled = numeric * 100 ** percentCount;
  const decimalsMatch = /\.(0+)/.exec(working);
  const decimals = decimalsMatch ? decimalsMatch[1].length : 0;
  if (/[#0]/.test(working)) scaled = decimals ? roundHalfAway(scaled, decimals) : roundHalfAway(scaled, 0);
  let text = formatNumeric(scaled, working, decimals, spec);
  if (value < 0 && sections.length < 2) text = `-${text}`;
  if (value < 0 && sections.length >= 2) text = text; // negative section already carries its sign
  return text;
}

function formatNumeric(value, section, decimals, spec) {
  // Order matters: "0.00E+00" contains an "E" that a loose date test would
  // mistake for a date token, so scientific notation is checked first.
  if (/[eE][+-]?0+/.test(section)) {
    const exponentDigits = (/[eE][+-]?(0+)/.exec(section) || [null, '00'])[1].length;
    const match = /\.(0+)/.exec(section);
    const mantissaDigits = match ? match[1].length : 0;
    return value
      .toExponential(mantissaDigits)
      .replace(/e([+-])(\d+)/, (all, sign, digits) => `E${sign}${digits.padStart(exponentDigits, '0')}`);
  }
  const dateLike = /[ymdhs]/i.test(section);
  if (dateLike) {
    const parts = serialToParts(value);
    if (isError(parts)) return parts;
    return formatDatePattern(parts, section);
  }
  const useGrouping = section.includes(',') && section.indexOf(',') < section.replace(/[^#0.,]/g, '').length;
  let text = decimals ? value.toFixed(decimals) : String(Math.round(value));
  if (useGrouping) {
    const [whole, fraction] = text.split('.');
    text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  }
  const prefix = section
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[#0,.]/g, '')
    .replace(/[eE][+-]?0+/, '')
    .replace(/.*?(?=[#0])/, '');
  const literal = [section.replace(/\[[^\]]*\]/g, '').match(/^[^#0]*/) || ['']][0];
  const suffix = (section.replace(/\[[^\]]*\]/g, '').match(/[^#0.,]*(?:%)?$/) || [''])[0].replace(/[eE].*/, '');
  void prefix;
  void spec;
  return `${literal || ''}${text}${suffix || ''}`;
}

function formatDatePattern(parts, pattern) {
  const digit = (value) => String(value).padStart(2, '0');
  const dateTokens = {
    yyyy: String(parts.year).padStart(4, '0'),
    yy: digit(parts.year % 100),
    mmmm: MONTH_NAMES[parts.month - 1],
    mmm: MONTH_NAMES[parts.month - 1],
    mm: digit(parts.month),
    m: String(parts.month),
    dd: digit(parts.day),
    d: String(parts.day)
  };
  const timeTokens = {
    hh: digit(parts.hour),
    h: String(parts.hour),
    mm: digit(parts.minute),
    m: String(parts.minute),
    ss: digit(parts.second),
    s: String(parts.second)
  };
  const split = pattern.search(/[hs]/i);
  if (split < 0) return pattern.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g, (token) => dateTokens[token] ?? token);
  const datePart = pattern.slice(0, split);
  const timePart = pattern.slice(split);
  return (
    datePart.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g, (token) => dateTokens[token] ?? token) +
    timePart.replace(/hh|h|mm|m|ss|s/g, (token) => timeTokens[token] ?? token)
  );
}

const MONTH_NAMES = [
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
];

module.exports = { BUILT_IN_FORMATS, pad, formatValue, formatNumeric, formatDatePattern, MONTH_NAMES };
