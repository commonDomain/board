import { MIN_ITEM_SIZE } from './constants.js';

const DEFAULT_NOTE_WIDTH = 320;
const DEFAULT_NOTE_HEIGHT = 240;
let measurementHost;

function textMeasurementHost() {
  if (measurementHost?.isConnected) return measurementHost;
  measurementHost = document.createElement('div');
  measurementHost.setAttribute('aria-hidden', 'true');
  Object.assign(measurementHost.style, {
    position: 'fixed', left: '-100000px', top: '0', width: '0', height: '0',
    contain: 'strict', visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden'
  });
  document.body.appendChild(measurementHost);
  return measurementHost;
}

// A measurement depends only on the card's own markup, the requested width and
// loaded fonts: the probe is laid out outside the canvas. Re-rendering an
// unchanged card (snapshots, undo, regrouping) then costs no forced layout,
// which otherwise runs once per card and dominates full-canvas renders.
const MEASUREMENT_CACHE_LIMIT = 1500;
const measurements = new Map();
let measurementFonts = 0;
if (typeof document !== 'undefined' && document.fonts?.addEventListener)
  document.fonts.addEventListener('loadingdone', () => { measurementFonts++; measurements.clear(); });

function measurementKey(card, width) {
  const root = document.documentElement;
  return `${measurementFonts}|${globalThis.devicePixelRatio || 1}|${root.dataset.formFactor || ''}|${root.className}|${Number(width) || 0}|${card.outerHTML}`;
}

// Measure an untransformed copy: canvas zoom/rotation must not change the
// document dimensions, and measuring must never disturb the live selection.
function measureTextCardContent(card, width) {
  const key = measurementKey(card, width);
  const cached = measurements.get(key);
  if (cached) return { ...cached };
  const size = measureTextCardLayout(card, width);
  if (measurements.size >= MEASUREMENT_CACHE_LIMIT) measurements.delete(measurements.keys().next().value);
  measurements.set(key, size);
  return { ...size };
}

function measureTextCardLayout(card, width) {
  const probe = card.cloneNode(true);
  probe.contentEditable = 'false';
  probe.setAttribute('aria-hidden', 'true');
  probe.removeAttribute('data-item-id');
  Object.assign(probe.style, {
    position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden',
    pointerEvents: 'none', boxSizing: 'border-box', width: 'max-content',
    height: 'auto', minWidth: '0', minHeight: '0', maxWidth: 'none',
    maxHeight: 'none', transform: 'none', zoom: '1', overflow: 'hidden'
  });
  textMeasurementHost().appendChild(probe);
  try {
    // Keep every explicit line intact. Both automatic sizing and manual resize
    // must respect the widest line instead of trading width for more rows.
    const minimumWidth = Math.max(MIN_ITEM_SIZE, Math.ceil(probe.offsetWidth) + 2);
    let nextWidth = Math.max(minimumWidth, Number(width) || MIN_ITEM_SIZE);
    probe.style.width = `${nextWidth}px`;
    // Grid tracks use minmax(0, 1fr), so their intrinsic minimum can be zero.
    // Include actual glyph/marker overflow before measuring the wrapped height.
    if (probe.scrollWidth > probe.clientWidth) {
      nextWidth += probe.scrollWidth - probe.clientWidth + 2;
      probe.style.width = `${nextWidth}px`;
    }
    // offsetHeight includes padding, borders, wrapped lines and empty lines.
    const borderHeight = probe.offsetHeight - probe.clientHeight;
    return { w: nextWidth, h: Math.max(MIN_ITEM_SIZE, probe.offsetHeight + 2, probe.scrollHeight + borderHeight + 2) };
  } finally {
    probe.remove();
  }
}

function fitNoteToContent(item, card) {
  if (!['note', 'text'].includes(item?.type) || !card) return;
  const size = measureTextCardContent(card, item.w);
  item.w = size.w;
  item.h = Math.max(Number(item.h) || (item.type === 'note' ? DEFAULT_NOTE_HEIGHT : MIN_ITEM_SIZE), size.h);
}

const measureNoteContent = measureTextCardContent;
export { DEFAULT_NOTE_WIDTH, DEFAULT_NOTE_HEIGHT, measureNoteContent, measureTextCardContent, fitNoteToContent };
