import { state } from '../state.js';
import { ownerGlyphRects } from './layout-cache.js';
import { stateRuntime } from './runtime/state.js';
import { C, svg } from './state.js';

const owners = new Map(), connections = new Map();
const externalClips = new WeakMap();
let layer = null, defs = null;

function resetInternalConnections() {
  owners.clear(); connections.clear(); layer = stateRuntime.internalLayer;
  layer?.replaceChildren();
  defs = svg('defs'); layer?.append(defs);
}

function clipExternalConnection(root, group, item, ends, bounds) {
  const targets = [...new Map([ends.source, ends.target].filter(end => end.internal).map(end => [end.owner.id, end.owner])).values()];
  let entry = externalClips.get(root);
  if (!targets.length) {
    group.removeAttribute('clip-path'); entry?.inner.removeAttribute('clip-path');
    return;
  }
  if (!entry) {
    const inner = svg('g');
    while (group.firstChild) inner.append(group.firstChild);
    group.append(inner);
    entry = { inner, clips: [], key: null }; externalClips.set(root, entry);
  }
  const key = JSON.stringify([bounds, targets.map(owner => [owner.x, owner.y, owner.w, owner.h, owner.rotation])]);
  if (entry.key !== key) {
    const outside = `M ${bounds.x} ${bounds.y} h ${bounds.w} v ${bounds.h} h ${-bounds.w} Z`;
    targets.forEach((owner, index) => {
      let clip = entry.clips[index];
      if (!clip) {
        clip = svg('clipPath', { id: `connection-outside-${item.id}-${index}`, clipPathUnits: 'userSpaceOnUse' });
        clip.append(svg('path', { 'clip-rule': 'evenodd' }));
        entry.clips[index] = clip; root.querySelector('defs').append(clip);
      }
      const corners = [{x:owner.x,y:owner.y},{x:owner.x+owner.w,y:owner.y},{x:owner.x+owner.w,y:owner.y+owner.h},{x:owner.x,y:owner.y+owner.h}].map(p => C.rotate(p, owner));
      const hole = corners.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z';
      clip.firstElementChild.setAttribute('d', `${outside} ${hole}`);
    });
    entry.key = key;
  }
  group.setAttribute('clip-path', `url(#connection-outside-${item.id}-0)`);
  if (targets.length > 1) entry.inner.setAttribute('clip-path', `url(#connection-outside-${item.id}-1)`);
  else entry.inner.removeAttribute('clip-path');
}

function ownerMask(owner) {
  const layout = ownerGlyphRects(owner);
  if (!layout) return null;
  let entry = owners.get(owner.id);
  const transform = `translate(${owner.x} ${owner.y}) rotate(${owner.rotation || 0} ${owner.w / 2} ${owner.h / 2})`;
  const inverse = `rotate(${-owner.rotation || 0} ${owner.w / 2} ${owner.h / 2}) translate(${-owner.x} ${-owner.y})`;
  if (entry) {
    if (entry.group.getAttribute('transform') !== transform) entry.group.setAttribute('transform', transform);
    if (entry.content.getAttribute('transform') !== inverse) entry.content.setAttribute('transform', inverse);
  }
  if (entry?.version === layout.entry.version && entry.node === layout.node) return entry;
  if (entry) { entry.mask.remove(); entry.clip.remove(); }
  const maskId = `connection-text-mask-${owner.id}`, clipId = `connection-text-clip-${owner.id}`;
  const mask = svg('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: owner.w, height: owner.h });
  const clip = svg('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
  clip.append(svg('rect', { width: owner.w, height: owner.h }));
  mask.append(svg('rect', { width: owner.w, height: owner.h, fill: 'white' }));
  for (const r of layout.entry.glyphs) mask.append(svg('rect', { x: r.x - 2, y: r.y - 2, width: r.w + 4, height: r.h + 4, fill: 'black' }));
  defs.append(clip, mask);
  const group = entry?.group || svg('g', { 'data-internal-owner': owner.id, 'clip-path': `url(#${clipId})`, mask: `url(#${maskId})` });
  const content = entry?.content || svg('g');
  if (!entry) { group.append(content); layer.append(group); }
  group.setAttribute('transform', transform); content.setAttribute('transform', inverse);
  entry = { mask, clip, maskId, clipId, group, content, node: layout.node, version: layout.entry.version };
  owners.set(owner.id, entry);
  return entry;
}

// All connections to a card share one text mask. Moving the card only updates
// transforms and paths; text nodes and SVG mask rectangles remain untouched.
function renderInternalConnection(item, ends, path, root) {
  if (!stateRuntime.internalLayer) return;
  if (layer !== stateRuntime.internalLayer || defs?.parentNode !== layer) resetInternalConnections();
  const targets = new Map(!ends.hidden ? [ends.source, ends.target].filter(end => end.internal).map(end => [end.owner.id, end.owner]) : []);
  let entry = connections.get(item.id);
  if (!targets.size) {
    if (entry) for (const child of entry.paths.values()) child.group.remove();
    connections.delete(item.id); return;
  }
  if (!entry) {
    entry = { paths: new Map(), root };
    connections.set(item.id, entry);
  }
  entry.root = root;
  for (const [id, child] of entry.paths) if (!targets.has(id)) { child.group.remove(); entry.paths.delete(id); }
  for (const [id, owner] of targets) {
    const mask = ownerMask(owner);
    if (!mask) continue;
    let child = entry.paths.get(id);
    if (!child) {
      child = { group: svg('g', { 'data-internal-id': item.id }), path: svg('path') };
      child.group.append(child.path); entry.paths.set(id, child);
    }
    // Virtualization can replace the owner's mask while the connector stays
    // mounted. Its retained path must join the new owner surface as well.
    if (child.group.parentNode !== mask.content) mask.content.append(child.group);
    window.MusePlanning?.decorateTaskLine(child.group, item);
    for (const key of ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'marker-start', 'marker-end', 'stroke-dasharray']) {
      const value = path.getAttribute(key);
      if (value === null) child.path.removeAttribute(key);
      else if (child.path.getAttribute(key) !== value) child.path.setAttribute(key, value);
    }
  }
}

function pruneInternalConnections() {
  for (const [id, entry] of connections) if (!state.items.has(id) || !entry.root.isConnected) {
    for (const child of entry.paths.values()) child.group.remove();
    connections.delete(id);
  }
  const used = new Set();
  for (const entry of connections.values()) for (const id of entry.paths.keys()) used.add(id);
  for (const [id, entry] of owners) if (!used.has(id) || !entry.node.isConnected) {
    entry.mask.remove(); entry.clip.remove(); entry.group.remove(); owners.delete(id);
  }
}

export { clipExternalConnection, renderInternalConnection, pruneInternalConnections, resetInternalConnections };
