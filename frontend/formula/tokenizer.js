'use strict';

const { ERRORS } = require('./references');

const TOKEN = {
  NUMBER: 'number',
  STRING: 'string',
  BOOL: 'bool',
  ERROR: 'error',
  REF: 'ref',
  NAME: 'name',
  OP: 'op',
  LPAREN: 'lparen',
  RPAREN: 'rparen',
  COMMA: 'comma',
  COLON: 'colon'
};

const OPERATORS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%'];

function tokenize(source) {
  const text = String(source ?? '');
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: TOKEN.LPAREN });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: TOKEN.RPAREN });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: TOKEN.COMMA });
      index += 1;
      continue;
    }
    if (char === ':') {
      tokens.push({ type: TOKEN.COLON });
      index += 1;
      continue;
    }
    if (char === '"') {
      let cursor = index + 1;
      let value = '';
      while (cursor < text.length) {
        if (text[cursor] === '"') {
          if (text[cursor + 1] === '"') {
            value += '"';
            cursor += 2;
            continue;
          }
          break;
        }
        value += text[cursor];
        cursor += 1;
      }
      if (cursor >= text.length) return { error: ERRORS['#VALUE!'], message: '未闭合的字符串' };
      tokens.push({ type: TOKEN.STRING, value });
      index = cursor + 1;
      continue;
    }
    if (char === '#') {
      const match = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CIRC!)/i.exec(text.slice(index));
      if (!match) return { error: ERRORS['#NAME?'], message: '未知的错误字面量' };
      tokens.push({ type: TOKEN.ERROR, value: match[0].toUpperCase() });
      index += match[0].length;
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[index + 1] || ''))) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(index));
      tokens.push({ type: TOKEN.NUMBER, value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    // A quoted sheet name, which must be followed by ! and a reference.
    if (char === "'") {
      let cursor = index + 1;
      let name = '';
      while (cursor < text.length) {
        if (text[cursor] === "'") {
          if (text[cursor + 1] === "'") {
            name += "'";
            cursor += 2;
            continue;
          }
          break;
        }
        name += text[cursor];
        cursor += 1;
      }
      if (text[cursor + 1] !== '!') {
        return { error: ERRORS['#NAME?'], message: '工作表名后缺少 !' };
      }
      const refMatch = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})(?![A-Za-z0-9_])/.exec(text.slice(cursor + 2));
      if (!refMatch) return { error: ERRORS['#REF!'], message: '工作表引用后缺少单元格' };
      tokens.push({ type: TOKEN.REF, value: refMatch[1], sheet: name });
      index = cursor + 2 + refMatch[1].length;
      continue;
    }
    if (/[A-Za-z_$\u4e00-\u9fa5\\]/.test(char)) {
      // Reference-ish text: sheet prefix, cell, function name or defined name.
      const match = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})(?![A-Za-z0-9_])/.exec(text.slice(index));
      if (match) {
        tokens.push({ type: TOKEN.REF, value: match[1] });
        index += match[1].length;
        continue;
      }
      const name = /^[A-Za-z_\\\u4e00-\u9fa5][A-Za-z0-9_.\\\u4e00-\u9fa5]*/.exec(text.slice(index));
      if (!name) return { error: ERRORS['#NAME?'], message: `无法识别的字符 "${char}"` };
      let value = name[0];
      let cursor = index + value.length;
      // "Sheet1!A1" and "Sheet1!A1:B2".
      if (text[cursor] === '!') {
        cursor += 1;
        const refMatch = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})(?![A-Za-z0-9_])/.exec(text.slice(cursor));
        if (!refMatch) return { error: ERRORS['#REF!'], message: '工作表引用后缺少单元格' };
        // Unquoted sheet names reach here as bare names; emitting a proper
        // reference token (instead of name + ref) is what lets reference
        // rewriting see cross-sheet formulas at all.
        tokens.push({ type: TOKEN.REF, value: refMatch[1], sheet: value });
        index = cursor + refMatch[1].length;
        continue;
      }
      if (/^(TRUE|FALSE)$/i.test(value)) {
        tokens.push({ type: TOKEN.BOOL, value: value.toUpperCase() === 'TRUE' });
      } else {
        tokens.push({ type: TOKEN.NAME, value });
      }
      index = cursor;
      continue;
    }
    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, index));
    if (operator) {
      tokens.push({ type: TOKEN.OP, value: operator });
      index += operator.length;
      continue;
    }
    return { error: ERRORS['#VALUE!'], message: `无法识别的字符 "${char}"` };
  }
  return { tokens };
}

const BINARY_PRECEDENCE = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '<=': 1,
  '>': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4
};

module.exports = { TOKEN, OPERATORS, tokenize, BINARY_PRECEDENCE };
