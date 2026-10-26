import { BRUSH_ALIASES } from './constants.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizeBrushId(brushId) {
  const key = String(brushId || 'pen')
    .trim()
    .toLowerCase();
  return BRUSH_ALIASES[key] || 'pen';
}

function hashString(value) {
  const string = String(value == null ? '' : value);
  let hash = 2166136261;
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed, salt) {
  if (Number.isFinite(Number(seed))) {
    return Number(seed) >>> 0;
  }
  return hashString(`${seed == null ? 'whiteboard' : seed}:${salt || ''}`);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export { clamp, distance, finite, hashString, lerp, mulberry32, normalizeBrushId, normalizeSeed };
