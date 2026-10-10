import { DEFAULT_TEXT_BORDER_COLOR, TEXT_BORDER_STYLES } from './constants.js';

function normalizeNoteFill(value) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : '#fff4b2';
}

function normalizeTextBorderStyle(value) {
  return TEXT_BORDER_STYLES.has(value) ? value : 'solid';
}

function normalizeTextAppearanceColor(value, fallback = DEFAULT_TEXT_BORDER_COLOR) {
  if (value === 'default') return 'default';
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
}
export { normalizeNoteFill, normalizeTextBorderStyle, normalizeTextAppearanceColor };
