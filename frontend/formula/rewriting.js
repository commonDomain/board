'use strict';

const { parseFormula } = require('./parser');
const { parseA1 } = require('./references');
const { OPERATORS, TOKEN, tokenize } = require('./tokenizer');

function eachReference(source, visit) {
  const body = String(source ?? '');
  const lexed = tokenize(body);
  if (lexed.error) return false;
  const tokens = lexed.tokens;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type !== TOKEN.REF) {
      index += 1;
      continue;
    }
    const sheet = token.sheet || null;
    const start = index;
    if (
      tokens[index + 1] &&
      tokens[index + 1].type === TOKEN.COLON &&
      tokens[index + 2] &&
      tokens[index + 2].type === TOKEN.REF
    ) {
      visit({
        kind: 'range',
        sheet,
        start: tokens[index].value,
        end: tokens[index + 2].value,
        startIndex: start,
        endIndex: index + 2
      });
      index += 3;
      continue;
    }
    visit({ kind: 'cell', sheet, ref: token.value, startIndex: start, endIndex: start });
    index += 1;
  }
  return true;
}

function rewriteReferences(source, mapRange, mapCell) {
  const text = String(source ?? '');
  if (parseFormula(text).error) return text;
  const body = text.replace(/^=/, '');
  const lexed = tokenize(body);
  if (lexed.error) return text;
  const tokens = lexed.tokens;
  // Splicing needs source offsets, which the token list does not carry.
  const offsets = tokenOffsets(body);
  if (!offsets) return text;
  const edits = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type !== TOKEN.REF) {
      index += 1;
      continue;
    }
    const isRange =
      tokens[index + 1] &&
      tokens[index + 1].type === TOKEN.COLON &&
      tokens[index + 2] &&
      tokens[index + 2].type === TOKEN.REF;
    if (isRange) {
      if (mapRange) {
        const replacement = mapRange({
          sheet: token.sheet || null,
          start: parseA1(tokens[index].value),
          end: parseA1(tokens[index + 2].value),
          startText: tokens[index].value,
          endText: tokens[index + 2].value
        });
        if (typeof replacement === 'string' && replacement) {
          edits.push({ from: offsets[index].start, to: offsets[index + 2].end, text: replacement });
        }
      }
      index += 3;
      continue;
    }
    if (mapCell) {
      const parsed = parseA1(token.value);
      if (parsed) {
        const replacement = mapCell({
          sheet: token.sheet || null,
          row: parsed.row,
          column: parsed.column,
          text: token.value
        });
        if (typeof replacement === 'string' && replacement) {
          edits.push({ from: offsets[index].start, to: offsets[index].end, text: replacement });
        }
      }
    }
    index += 1;
  }
  if (!edits.length) return text;
  let output = body;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    const edit = edits[i];
    output = output.slice(0, edit.from) + edit.text + output.slice(edit.to);
  }
  return text.startsWith('=') ? `=${output}` : output;
}

function tokenOffsets(text) {
  const offsets = [];
  let index = 0;
  const push = (start, end) => offsets.push({ start, end });
  while (index < text.length) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if ('(),:'.includes(char)) {
      push(index, index + 1);
      index += 1;
      continue;
    }
    if (char === '"') {
      const start = index;
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === '"') {
          if (text[cursor + 1] === '"') {
            cursor += 2;
            continue;
          }
          break;
        }
        cursor += 1;
      }
      push(start, cursor + 1);
      index = cursor + 1;
      continue;
    }
    if (char === '#') {
      const match = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CIRC!)/i.exec(text.slice(index));
      if (!match) return null;
      push(index, index + match[0].length);
      index += match[0].length;
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[index + 1] || ''))) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(index));
      push(index, index + match[0].length);
      index += match[0].length;
      continue;
    }
    if (char === "'") {
      const start = index;
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === "'") {
          if (text[cursor + 1] === "'") {
            cursor += 2;
            continue;
          }
          break;
        }
        cursor += 1;
      }
      if (text[cursor + 1] !== '!') return null;
      const refMatch = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})/.exec(text.slice(cursor + 2));
      if (!refMatch) return null;
      push(start, cursor + 2 + refMatch[1].length);
      index = cursor + 2 + refMatch[1].length;
      continue;
    }
    if (/[A-Za-z_$\u4e00-\u9fa5\\]/.test(char)) {
      const refMatch = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})(?![A-Za-z0-9_])/.exec(text.slice(index));
      if (refMatch) {
        push(index, index + refMatch[1].length);
        index += refMatch[1].length;
        continue;
      }
      const nameMatch = /^[A-Za-z_\\\u4e00-\u9fa5][A-Za-z0-9_.\\\u4e00-\u9fa5]*/.exec(text.slice(index));
      if (!nameMatch) return null;
      let end = index + nameMatch[0].length;
      if (text[end] === '!') {
        const after = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})/.exec(text.slice(end + 1));
        if (!after) return null;
        end = end + 1 + after[1].length;
      }
      push(index, end);
      index = end;
      continue;
    }
    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, index));
    if (!operator) return null;
    push(index, index + operator.length);
    index += operator.length;
  }
  return offsets;
}

module.exports = { eachReference, rewriteReferences, tokenOffsets };
