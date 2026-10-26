import { compareRenderItems } from './layers-model.js';
import { state } from './state.js';

const pending = new Set();
const ranks = new WeakMap();
let frame = null;

// Document ranks may be fractional. CSS z-index requires integers. Project
// only mounted siblings to dense integers without changing saved document data.
export function scheduleItemStacking(item, node) {
  const parent = node.parentElement;
  if (!parent) return;
  const previous = ranks.get(node);
  if (previous?.parent === parent && previous.z === item.z) return;
  ranks.set(node, { parent, z: item.z });
  pending.add(parent);
  if (frame === null) frame = requestAnimationFrame(flushItemStacking);
}

export function flushItemStacking() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  for (const parent of pending) {
    if (!parent.isConnected) continue;
    const entries = Array.from(parent.children).map(node => ({ node, item: state.items.get(node.dataset.itemId) }))
      .filter(entry => entry.item).sort((a, b) => compareRenderItems(a.item, b.item));
    const index = new Map();
    entries.forEach(({ node, item }, rank) => {
      const value = String(rank + 1);
      if (node.style.getPropertyValue('--z') !== value) node.style.setProperty('--z', value);
      index.set(item.id, value);
    });
    for (const node of parent.querySelectorAll('.eraser-ink-preview')) {
      node.style.setProperty('--z', index.get(node.dataset.stackSourceId) || '1');
    }
  }
  pending.clear();
}
