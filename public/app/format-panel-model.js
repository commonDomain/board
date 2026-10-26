import { DEFAULT_TEXT_BORDER_COLOR, NOTE_STYLES, TEXT_BORDER_STYLES } from './constants.js';

function normalizeNoteFill(value) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : '#fff4b2';
}

// Dark fills need dimmer highlights and light rules; relative luminance below this reads as dark paper.
const DARK_NOTE_FILL_LUMINANCE = 0.2;

function noteFillLuminance(value) {
  const hex = normalizeNoteFill(value);
  const [red, green, blue] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function noteFillTone(value) {
  return noteFillLuminance(value) < DARK_NOTE_FILL_LUMINANCE ? 'dark' : 'light';
}

// White highlights read as fog on mid and dark paper, so their strength follows the fill's luminance.
function noteHighlightStrength(value) {
  return Math.round(Math.min(1, Math.max(0.3, (noteFillLuminance(value) + 0.1) / 0.6)) * 100) / 100;
}

function normalizeNoteStyle(value) {
  return NOTE_STYLES.some((style) => style.value === value) ? value : NOTE_STYLES[0].value;
}

function normalizeTextBorderStyle(value) {
  return TEXT_BORDER_STYLES.has(value) ? value : 'solid';
}

// A text box fill is 'default' (soft paper white), 'none' (plain text) or a hex colour.
function normalizeTextFill(value) {
  return value === 'none' ? 'none' : normalizeTextAppearanceColor(value, 'default');
}

function normalizeTextOpacity(value) {
  const opacity = Number(value);
  return Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
}

function normalizeTextAppearanceColor(value, fallback = DEFAULT_TEXT_BORDER_COLOR) {
  if (value === 'default') return 'default';
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
}
export { normalizeNoteFill, noteFillTone, noteHighlightStrength, normalizeTextFill, normalizeTextOpacity, normalizeNoteStyle, normalizeTextBorderStyle, normalizeTextAppearanceColor };
