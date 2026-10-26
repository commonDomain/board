import { C, mounted } from './state.js';
import { clientContentGeometry } from './content-geometry.js';

let layouts = new WeakMap();
let serial = 0;

// Store text geometry in card coordinates. Translation, camera zoom and group
// movement then reuse the same measurements for every attached connector.
function ownerLayout(owner) {
  const node = mounted(owner.id);
  if (!node) return null;
  let entry = layouts.get(node);
  const key = `${owner.w}|${owner.h}`;
  if (!entry || entry.key !== key || entry.content !== node.firstElementChild) {
    entry = { key, content: node.firstElementChild, version: ++serial, maps: new WeakMap(), ranges: new Map(), glyphs: null };
    layouts.set(node, entry);
  }
  return { node, entry };
}

function invalidateContentLayout(id) {
  const node = mounted(id);
  if (node) layouts.delete(node);
}

function resetContentLayouts() { layouts = new WeakMap(); }

function localRangeRects(owner, locator, root, buildMap) {
  const layout = ownerLayout(owner);
  if (!layout) return [];
  const { node, entry } = layout;
  let map = entry.maps.get(root);
  if (!map) { map = buildMap(root); entry.maps.set(root, map); }
  const actual = C.contentText(owner, locator);
  if (C.text(map.value) !== C.text(actual)) return [];
  const key = JSON.stringify([locator.nodeId, locator.rowId, locator.columnId, locator.start, locator.end]);
  if (entry.ranges.has(key)) return entry.ranges.get(key);
  const from = C.chars(map.value).slice(0, locator.start).join('').length;
  const to = C.chars(map.value).slice(0, locator.end).join('').length;
  const geometry = clientContentGeometry(node);
  if (!geometry) return [];
  const rects = map.entries.flatMap(part => {
    const start = Math.max(0, from - part.start), end = Math.min(part.length, to - part.start);
    if (start >= end) return [];
    const range = document.createRange();
    range.setStart(part.node, start); range.setEnd(part.node, end);
    const caret = range.cloneRange(); caret.collapse(true);
    const height = geometry.caretHeight(caret.getClientRects()[0]);
    return Array.from(range.getClientRects()).map(rect => geometry.rect(rect, height)).filter(Boolean);
  });
  // Bound retained selections when a user repeatedly chooses different ranges.
  if (entry.ranges.size >= 512) entry.ranges.delete(entry.ranges.keys().next().value);
  entry.ranges.set(key, rects);
  return rects;
}

function ownerGlyphRects(owner) {
  const layout = ownerLayout(owner);
  if (!layout || layout.entry.glyphs) return layout;
  const geometry = clientContentGeometry(layout.node);
  layout.entry.glyphs = [];
  if (!geometry) return layout;
  const seen = new Set();
  for (const content of layout.node.querySelectorAll('.text-list-content,.mind-node-text,td,th')) {
    const range = document.createRange(); range.selectNodeContents(content);
    const caret = range.cloneRange(); caret.collapse(true);
    const height = geometry.caretHeight(caret.getClientRects()[0]);
    for (const rect of range.getClientRects()) {
      const local = geometry.rect(rect, height);
      if (!local) continue;
      const key = [local.x, local.y, local.w, local.h].map(value => Math.round(value * 1000)).join('|');
      if (!seen.has(key)) { seen.add(key); layout.entry.glyphs.push(local); }
    }
  }
  return layout;
}

export { invalidateContentLayout, localRangeRects, ownerGlyphRects, resetContentLayouts };
