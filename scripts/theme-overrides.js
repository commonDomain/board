'use strict';

// Derives studio-theme overrides from the compiled classic stylesheet.
// Classic CSS stays the single source of layout; this only remaps literal
// purple accents, glass surfaces and (for the dark theme) light surfaces and
// dark text onto theme tokens. Rules for canvas content are left untouched.

const SKIP_SELECTOR = /preview|swatch|palette|color-(?:chip|dot|sample|option|choice|value|input)|custom-color-sample|stone|gomoku-(?:board|cell|point)|grid-layer|data-bg|text-border|wallpaper|pet-|toolbar-pet|\.ProseMirror|nt-page-content|sheet-(?:grid|cell|canvas)|cell-|amap-(?:map|frame)|kdocs|\.mind-node|mindmap-node|brush-(?:sample|preview|stroke)|sticker-(?:art|image)|emoji|avatar-color|highlight-mark|text-color|::selection|connector-impact|impact-/;

// Canvas content sits on the canvas background, which themes never change; the
// dark theme therefore leaves it light.
const CANVAS_CONTENT = /\.board-item|\.text-card|\.note-card|\.sheet-item|\.sheet-preview|\.mind-node|\.mind-action|\.mind-note|\.mindmap-card|\.mindmap-source-badge|\.section-(?:titlebar|frame|title|body|label|collapsed)|\.amap-card|\.amap-map-shield|\.table-item|\.table-cell|\.table-(?:column|row)-handle|\.table-add|\.image-item|\.shape-item|\.connection-(?:line|label|path)|\.items-layer|\.section-layer|\.board\b|\.draw-surface|\.text-list|\.note-region|\.kdocs-embed|\.sticker-item|\.link-card|\.nt-|\.notes-|\.note-actions|\.independent-notes/;

function parseColor(token) {
  const value = token.trim().toLowerCase();
  if (value === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (value === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  let match = value.match(/^#([0-9a-f]{3,8})$/);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    };
  }
  match = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (match) {
    let alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return { r: +match[1], g: +match[2], b: +match[3], a: alpha };
  }
  return null;
}

function hsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function classify(color) {
  const { h, s, l } = hsl(color);
  if (s > 0.3 && h >= 228 && h <= 285 && l <= 0.95) return l > 0.86 ? 'lavender' : 'purple';
  if (s <= 0.35 || l > 0.94) {
    if (l >= 0.88) return 'light';
    if (l <= 0.36) return 'dark';
    return 'mid';
  }
  return 'other';
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b/g;

function colorsIn(value) {
  return (value.match(COLOR_TOKEN) || []).map((token) => ({ token, color: parseColor(token) })).filter((entry) => entry.color);
}

function hasPurple(value) {
  return colorsIn(value).some(({ color }) => ['purple', 'lavender'].includes(classify(color)) && color.a > 0.02);
}

function maxPurpleAlpha(value) {
  return Math.max(0, ...colorsIn(value).filter(({ color }) => classify(color) === 'purple').map(({ color }) => color.a));
}

// Replace color tokens one by one; returns null when nothing changed.
function remapColors(value, mapper) {
  let changed = false;
  const next = value.replace(COLOR_TOKEN, (token) => {
    const color = parseColor(token);
    if (!color) return token;
    const replacement = mapper(color, classify(color));
    if (replacement && replacement !== token) { changed = true; return replacement; }
    return token;
  });
  return changed ? next : null;
}

function splitTopLevel(value, separator = ',') {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === separator && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const isBackground = (prop) => prop === 'background' || prop === 'background-color' || prop === 'background-image';
const isBorder = (prop) => /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|column-rule(-color)?|text-decoration-color)$/.test(prop);

function studioDeclaration(prop, value, siblings) {
  if (prop === 'backdrop-filter' || prop === '-webkit-backdrop-filter') return value.trim() === 'none' ? null : 'none';
  if (isBackground(prop)) {
    if (/url\(|repeating-|conic-/.test(value) || siblings.has('background-size') || siblings.has('mask') || siblings.has('-webkit-mask')) return null;
    if (/gradient\(/.test(value)) {
      const colors = colorsIn(value);
      if (!colors.length) return null;
      const strong = colors.filter(({ color }) => classify(color) === 'purple');
      if (strong.length) return maxPurpleAlpha(value) >= 0.5 ? 'var(--t-accent)' : 'var(--t-accent-soft)';
      if (colors.every(({ color }) => ['light', 'lavender'].includes(classify(color)))) {
        return colors.some(({ color }) => classify(color) === 'lavender') ? 'var(--t-accent-soft)' : 'var(--t-surface)';
      }
      if (colors.every(({ color }) => classify(color) === 'dark')) return 'var(--t-surface)';
      return null;
    }
    return remapColors(value, (color, kind) => {
      if (kind === 'purple') return color.a >= 0.6 ? 'var(--t-accent)' : 'var(--t-accent-soft)';
      if (kind === 'lavender') return 'var(--t-accent-soft)';
      if (kind === 'light' && color.a < 0.97 && color.a > 0.3) return 'var(--t-surface)';
      return null;
    });
  }
  if (prop === 'color' || prop === 'caret-color' || prop === 'accent-color' || prop === 'fill' || prop === 'stroke' || prop === 'stop-color') {
    return remapColors(value, (color, kind) => {
      if (kind === 'purple') return 'var(--t-accent)';
      if (kind === 'lavender' && prop === 'color') return 'var(--t-ink-2)';
      return null;
    });
  }
  if (isBorder(prop)) {
    return remapColors(value, (color, kind) => {
      if (kind === 'purple' || kind === 'lavender') return color.a >= 0.7 ? 'var(--t-accent)' : 'var(--t-accent-line)';
      if (kind === 'light' && color.a < 0.97) return 'var(--t-line)';
      return null;
    });
  }
  if (prop === 'box-shadow') {
    if (value.trim() === 'none') return null;
    const layers = splitTopLevel(value);
    let changed = false;
    const kept = [];
    for (const layer of layers) {
      const colors = colorsIn(layer);
      const white = colors.some(({ color }) => classify(color) === 'light');
      const purple = colors.some(({ color }) => ['purple', 'lavender'].includes(classify(color)));
      if (/\binset\b/.test(layer) && white) { changed = true; continue; }
      if (purple) {
        changed = true;
        const ring = /^0(px)?\s+0(px)?\s+0(px)?\s+[\d.]+px/.test(layer.replace(/^inset\s+/, ''));
        if (ring) kept.push(remapColors(layer, (color, kind) => (kind === 'purple' || kind === 'lavender') ? (color.a >= 0.5 ? 'var(--t-accent-line)' : 'var(--t-accent-soft)') : null) || layer);
        else kept.push('var(--t-shadow-1)');
        continue;
      }
      kept.push(layer);
    }
    if (!changed) return null;
    const unique = [...new Set(kept)];
    return unique.length ? unique.join(',') : 'none';
  }
  if (prop === 'text-shadow' || prop === 'filter') {
    return hasPurple(value) ? (prop === 'filter' ? 'none' : 'none') : null;
  }
  if (prop.startsWith('--')) {
    if (/url\(/.test(value)) return null;
    if (/gradient\(/.test(value) && hasPurple(value)) return maxPurpleAlpha(value) >= 0.5 ? 'var(--t-accent)' : 'var(--t-surface)';
    if (/gradient\(/.test(value) && colorsIn(value).length && colorsIn(value).every(({ color }) => classify(color) === 'light')) return 'var(--t-surface)';
    return remapColors(value, (color, kind) => (kind === 'purple' ? (color.a >= 0.6 ? 'var(--t-accent)' : 'var(--t-accent-soft)') : kind === 'lavender' ? 'var(--t-accent-soft)' : null));
  }
  return null;
}

// Dark theme: light surfaces become dark, dark text becomes light.
function nightDeclaration(prop, value, siblings) {
  if (isBackground(prop)) {
    if (/url\(|repeating-|conic-/.test(value) || siblings.has('background-size') || siblings.has('mask') || siblings.has('-webkit-mask')) return null;
    if (/gradient\(/.test(value)) {
      const colors = colorsIn(value);
      if (colors.length && colors.every(({ color }) => ['light', 'lavender', 'mid'].includes(classify(color)))) return 'var(--t-surface)';
      return null;
    }
    return remapColors(value, (color, kind) => {
      if (kind === 'light' || kind === 'lavender') {
        if (color.a >= 0.75) return 'var(--t-surface)';
        if (color.a >= 0.35) return 'var(--t-raised)';
        return 'var(--t-hover)';
      }
      if (kind === 'mid' && color.a < 0.2) return 'var(--t-hover)';
      if (kind === 'dark' && color.a < 0.2) return 'var(--t-hover)';
      return null;
    });
  }
  if (prop === 'color' || prop === 'fill' || prop === 'caret-color') {
    return remapColors(value, (color, kind) => {
      if (kind === 'dark') return 'var(--t-ink)';
      if (kind === 'mid') return 'var(--t-ink-2)';
      return null;
    });
  }
  if (isBorder(prop)) {
    return remapColors(value, (color, kind) => {
      if (kind === 'dark' && color.a <= 0.5) return 'var(--t-line)';
      if (kind === 'mid' && color.a <= 0.6) return 'var(--t-line)';
      if (kind === 'light' || kind === 'lavender') return 'var(--t-line)';
      if (kind === 'mid') return 'var(--t-line-strong)';
      return null;
    });
  }
  if (prop.startsWith('--')) {
    if (/url\(/.test(value)) return null;
    if (/gradient\(/.test(value)) {
      const colors = colorsIn(value);
      return colors.length && colors.every(({ color }) => ['light', 'lavender'].includes(classify(color))) ? 'var(--t-surface)' : null;
    }
    return null;
  }
  return null;
}

// Minimal parser for esbuild-minified CSS: rules, @media/@supports/@layer/@container blocks.
function parseBlocks(css) {
  const root = [];
  const stack = [root];
  let i = 0, start = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const quote = c; i++;
      while (i < n && css[i] !== quote) { if (css[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; start = i; continue; }
    if (c === '{') {
      const prelude = css.slice(start, i).trim();
      if (/^@(media|supports|layer|container|document)\b/.test(prelude)) {
        const node = { type: 'group', prelude, children: [] };
        stack[stack.length - 1].push(node);
        stack.push(node.children);
        i++; start = i; continue;
      }
      // Rule or opaque at-rule: find matching brace.
      let depth = 1, j = i + 1;
      while (j < n && depth) {
        const d = css[j];
        if (d === '"' || d === "'") { const q = d; j++; while (j < n && css[j] !== q) { if (css[j] === '\\') j++; j++; } }
        else if (d === '{') depth++;
        else if (d === '}') depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      if (!prelude.startsWith('@')) flattenRule(prelude, body, stack[stack.length - 1]);
      i = j; start = i; continue;
    }
    if (c === '}') { if (stack.length > 1) stack.pop(); i++; start = i; continue; }
    if (c === ';' && stack.length >= 1) { start = i + 1; }
    i++;
  }
  return root;
}

// Splits a rule body into plain declarations and nested blocks (CSS nesting).
function splitRuleBody(body) {
  const declarations = [], nested = [];
  let buffer = '', i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'") {
      const quote = c; let j = i + 1;
      while (j < body.length && body[j] !== quote) { if (body[j] === '\\') j++; j++; }
      buffer += body.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '(') {
      let depth = 1, j = i + 1;
      while (j < body.length && depth) { if (body[j] === '(') depth++; else if (body[j] === ')') depth--; j++; }
      buffer += body.slice(i, j); i = j; continue;
    }
    if (c === '{') {
      let depth = 1, j = i + 1;
      while (j < body.length && depth) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++; }
      nested.push({ prelude: buffer.trim(), body: body.slice(i + 1, j - 1) });
      buffer = ''; i = j; continue;
    }
    if (c === ';') { if (buffer.trim()) declarations.push(buffer.trim()); buffer = ''; i++; continue; }
    buffer += c; i++;
  }
  if (buffer.trim()) declarations.push(buffer.trim());
  return { declarations: declarations.join(';'), nested };
}

function nestSelector(parent, child) {
  const parentGroup = splitTopLevel(parent).length > 1 ? `:is(${parent})` : parent;
  return splitTopLevel(child).map((part) => (part.includes('&') ? part.replace(/&/g, parentGroup) : `${parentGroup} ${part}`)).join(',');
}

function flattenRule(selector, body, target) {
  const { declarations, nested } = splitRuleBody(body);
  if (declarations) target.push({ type: 'rule', selector, body: declarations });
  for (const block of nested) {
    if (/^@(media|supports|container|layer)\b/.test(block.prelude)) {
      const group = { type: 'group', prelude: block.prelude, children: [] };
      flattenRule(selector, block.body, group.children);
      target.push(group);
    } else if (!block.prelude.startsWith('@')) {
      flattenRule(nestSelector(selector, block.prelude), block.body, target);
    }
  }
}

function parseDeclarations(body) {
  const declarations = [];
  for (const part of splitTopLevel(body, ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (/[{}]/.test(value)) continue;
    let important = false;
    if (/!important\s*$/i.test(value)) { important = true; value = value.replace(/\s*!important\s*$/i, ''); }
    declarations.push({ prop, value, important });
  }
  return declarations;
}

function scopeSelector(selector, scope) {
  return splitTopLevel(selector).map((single) => {
    const match = single.match(/^(html|:root)((?:\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*)(.*)$/i);
    if (match) return `:root${scope}${match[2]}${match[3]}`;
    return `:root${scope} ${single}`;
  }).join(',');
}

function transform(nodes, scope, mapper, skipContent = false) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'group') {
      const inner = transform(node.children, scope, mapper, skipContent);
      if (inner) out += `${node.prelude}{${inner}}`;
      continue;
    }
    if (SKIP_SELECTOR.test(node.selector) || (skipContent && CANVAS_CONTENT.test(node.selector))) continue;
    const declarations = parseDeclarations(node.body);
    const siblings = new Set(declarations.map((d) => d.prop));
    const changed = [];
    for (const declaration of declarations) {
      const next = mapper(declaration.prop, declaration.value, siblings);
      if (next !== null && next !== undefined && next !== declaration.value) {
        changed.push(`${declaration.prop}:${next}${declaration.important ? '!important' : ''}`);
      }
    }
    if (changed.length) out += `${scopeSelector(node.selector, scope)}{${changed.join(';')}}`;
  }
  return out;
}

function generateThemeOverrides(sources) {
  let studio = '', night = '';
  for (const css of sources) {
    const tree = parseBlocks(String(css));
    studio += transform(tree, '[data-ui=studio]', studioDeclaration);
    night += transform(tree, '[data-theme=night]', nightDeclaration, true);
  }
  return `/* Derived from classic styles by scripts/theme-overrides.js */\n${studio}\n${night}\n`;
}

module.exports = { generateThemeOverrides, parseColor, classify };
