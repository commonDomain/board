'use strict';

const HEADER_HEIGHT = 22;

const HEADER_WIDTH = 44;

const FILL_HANDLE_SIZE = 6;

const RESIZE_GRAB_PX = 3;

const FALLBACK_PALETTE = {
  surface: '#ffffff',
  surfaceMuted: '#f3f5f9',
  header: '#f5f6fa',
  headerText: '#6d7380',
  ink: '#171922',
  muted: '#6d7380',
  grid: 'rgba(89, 99, 118, 0.19)',
  gridStrong: 'rgba(19, 26, 43, 0.28)',
  accent: '#6957f5',
  accentSoft: 'rgba(105, 87, 245, 0.12)',
  select: '#6657ee',
  selectSoft: 'rgba(102, 87, 238, 0.14)',
  danger: '#e6525d'
};

const PALETTE_VARIABLES = {
  surface: '--surface-strong',
  surfaceMuted: '--surface-muted',
  header: '--surface-muted',
  headerText: '--muted',
  ink: '--ink',
  muted: '--muted',
  grid: '--grid',
  gridStrong: '--line-strong',
  accent: '--accent',
  accentSoft: '--accent-soft',
  select: '--select',
  danger: '--danger'
};

function readPalette(element) {
  const palette = { ...FALLBACK_PALETTE };
  const target = element || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target || typeof getComputedStyle !== 'function') return palette;
  let computed;
  try {
    computed = getComputedStyle(target);
  } catch {
    return palette;
  }
  for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
    const value = computed.getPropertyValue(variable);
    if (value && value.trim()) palette[key] = value.trim();
  }
  palette.selectSoft = palette.accentSoft;
  return palette;
}

function fontString(style, fontSize, family) {
  const parts = [];
  if (style && style.italic) parts.push('italic');
  if (style && style.bold) parts.push('700');
  parts.push(`${fontSize}px`);
  parts.push(family || 'Inter, system-ui, "Microsoft YaHei", sans-serif');
  return parts.join(' ');
}

function createSelection(row = 0, column = 0) {
  return {
    anchor: { row, column },
    focus: { row, column },
    get start() {
      return {
        row: Math.min(this.anchor.row, this.focus.row),
        column: Math.min(this.anchor.column, this.focus.column)
      };
    },
    get end() {
      return {
        row: Math.max(this.anchor.row, this.focus.row),
        column: Math.max(this.anchor.column, this.focus.column)
      };
    },
    get width() {
      return Math.abs(this.focus.column - this.anchor.column) + 1;
    },
    get height() {
      return Math.abs(this.focus.row - this.anchor.row) + 1;
    },
    contains(row, column) {
      const start = this.start;
      const end = this.end;
      return row >= start.row && row <= end.row && column >= start.column && column <= end.column;
    }
  };
}

module.exports = {
  HEADER_HEIGHT,
  HEADER_WIDTH,
  FILL_HANDLE_SIZE,
  RESIZE_GRAB_PX,
  FALLBACK_PALETTE,
  PALETTE_VARIABLES,
  readPalette,
  fontString,
  createSelection
};
