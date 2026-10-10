import { clamp } from './math.js';

function parseColor(color) {
  const value = String(color || '').trim();
  let match = /^#([0-9a-f]{3})$/i.exec(value);
  if (match) {
    return match[1].split('').map((part) => parseInt(part + part, 16));
  }
  match = /^#([0-9a-f]{6})$/i.exec(value);
  if (match) {
    return [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)];
  }
  match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function adjustColor(color, amount) {
  const rgb = parseColor(color);
  if (!rgb) {
    return color;
  }
  const adjusted = rgb.map((channel) => Math.round(clamp(channel + amount, 0, 255)));
  return `rgb(${adjusted[0]}, ${adjusted[1]}, ${adjusted[2]})`;
}

export { adjustColor, parseColor };
