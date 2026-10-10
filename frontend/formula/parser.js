'use strict';

const { ERRORS, parseA1 } = require('./references');
const { BINARY_PRECEDENCE, TOKEN, tokenize } = require('./tokenizer');

function parseFormula(source) {
  const body = String(source ?? '').replace(/^=/, '');
  const lexed = tokenize(body);
  if (lexed.error) return { error: lexed.error, message: lexed.message };
  const tokens = lexed.tokens;
  let position = 0;

  const peek = () => tokens[position] || null;

  function parseExpression(minPrecedence) {
    let left = parseUnary();
    if (left.error) return left;
    for (;;) {
      const token = peek();
      if (!token || token.type !== TOKEN.OP) break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      position += 1;
      const right = parseExpression(precedence + 1);
      if (right.error) return right;
      left = { type: 'binary', operator: token.value, left, right };
    }
    return left;
  }

  /**
   * Unary minus, unary plus, power and trailing percent, in Excel's order:
   * percent binds tightest, then unary minus/plus, then "^". Excel therefore
   * returns 4 for -2^2 (the minus is part of the base) and 512 for 2^3^2
   * (left associative). JavaScript's -2**2 is a syntax error, which is
   * exactly the trap this ordering avoids.
   */
  function parseUnary() {
    const token = peek();
    if (token && token.type === TOKEN.OP && (token.value === '-' || token.value === '+')) {
      position += 1;
      const operand = parseUnary();
      if (operand.error) return operand;
      // A unary sign owns its base: (-2)^2, not -(2^2).
      return parsePower(token.value === '-' ? { type: 'unary', operator: '-', operand } : operand);
    }
    return parsePower(parsePostfix());
  }

  function parsePower(base) {
    if (base.error) return base;
    if (peek() && peek().type === TOKEN.OP && peek().value === '^') {
      position += 1;
      const exponent = parseUnary();
      if (exponent.error) return exponent;
      return { type: 'binary', operator: '^', left: base, right: exponent };
    }
    return base;
  }

  function parsePostfix() {
    let node = parsePrimary();
    if (node.error) return node;
    // Range: ref ":" ref
    if (peek() && peek().type === TOKEN.COLON) {
      position += 1;
      const end = parsePrimary();
      if (end.error) return end;
      if (node.type !== 'ref' || end.type !== 'ref') {
        return { error: ERRORS['#REF!'], message: '区间运算符两侧必须是单元格引用' };
      }
      // "Sheet1!A1:B5" qualifies only the first endpoint; the tokenizer sees
      // the second one as bare, so it inherits the sheet.
      const rangeSheet = node.sheet || end.sheet || null;
      if (node.sheet && end.sheet && node.sheet !== end.sheet) {
        return { error: ERRORS['#REF!'], message: '区间不能跨工作表' };
      }
      node = { type: 'range', sheet: rangeSheet, start: node, end };
    }
    // Excel's trailing percent is a postfix operator: 50% === 0.5.
    while (peek() && peek().type === TOKEN.OP && peek().value === '%') {
      position += 1;
      node = { type: 'percent', operand: node };
    }
    return node;
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return { error: ERRORS['#VALUE!'], message: '公式意外结束' };
    if (token.type === TOKEN.NUMBER) {
      position += 1;
      return { type: 'number', value: token.value };
    }
    if (token.type === TOKEN.STRING) {
      position += 1;
      return { type: 'string', value: token.value };
    }
    if (token.type === TOKEN.BOOL) {
      position += 1;
      return { type: 'bool', value: token.value };
    }
    if (token.type === TOKEN.ERROR) {
      position += 1;
      return { type: 'error', value: token.value };
    }
    if (token.type === TOKEN.REF) {
      position += 1;
      const parsed = parseA1(token.value);
      if (!parsed) return { error: ERRORS['#REF!'], message: '无效的单元格引用' };
      return {
        type: 'ref',
        sheet: token.sheet || null,
        row: parsed.row,
        column: parsed.column,
        absoluteRow: token.value.includes('$') ? token.value.lastIndexOf('$') > 0 : false,
        absoluteColumn: token.value.startsWith('$')
      };
    }
    if (token.type === TOKEN.NAME) {
      position += 1;
      if (peek() && peek().type === TOKEN.LPAREN) {
        position += 1;
        const args = [];
        if (!(peek() && peek().type === TOKEN.RPAREN)) {
          for (;;) {
            const argument = parseExpression(0);
            if (argument.error) return argument;
            args.push(argument);
            const next = peek();
            if (next && next.type === TOKEN.COMMA) {
              position += 1;
              continue;
            }
            break;
          }
        }
        if (!peek() || peek().type !== TOKEN.RPAREN) {
          return { error: ERRORS['#VALUE!'], message: `函数 ${token.value} 缺少右括号` };
        }
        position += 1;
        return { type: 'call', name: token.value.toUpperCase(), args };
      }
      // A defined name that looks like a reference is treated as one.
      const asRef = parseA1(token.value);
      if (asRef) return { type: 'ref', sheet: null, row: asRef.row, column: asRef.column };
      return { type: 'name', name: token.value.toUpperCase() };
    }
    if (token.type === TOKEN.LPAREN) {
      position += 1;
      const inner = parseExpression(0);
      if (inner.error) return inner;
      if (!peek() || peek().type !== TOKEN.RPAREN) {
        return { error: ERRORS['#VALUE!'], message: '缺少右括号' };
      }
      position += 1;
      return inner;
    }
    return { error: ERRORS['#VALUE!'], message: '公式语法错误' };
  }

  const ast = parseExpression(0);
  if (ast.error) return ast;
  if (position !== tokens.length) return { error: ERRORS['#VALUE!'], message: '公式存在多余内容' };
  return { ast };
}

module.exports = { parseFormula };
