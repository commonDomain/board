'use strict';

// Point arrays are immutable after validation. Operations replace a stroke rather
// than editing its samples, so drafts can share them without sharing mutable state.
const immutablePoints = new WeakSet();
const encodedPoints = new WeakMap();

function protectPoints(points) {
  if (!immutablePoints.has(points)) {
    for (const point of points) Object.freeze(point);
    Object.freeze(points);
    immutablePoints.add(points);
  }
  return points;
}

function cloneStateForOperation(state) {
  const { items, ...metadata } = state;
  return {
    ...structuredClone(metadata),
    items: items.map(item => {
      if (item.type !== 'ink' || !Array.isArray(item.pts)) return structuredClone(item);
      const { pts, ...properties } = item;
      return { ...structuredClone(properties), pts: protectPoints(pts) };
    })
  };
}

function encodeItem(item) {
  if (item.type !== 'ink' || !Array.isArray(item.pts)) return JSON.stringify(item);
  const { pts, ...properties } = item;
  protectPoints(pts);
  let encoded = encodedPoints.get(pts);
  if (encoded === undefined) {
    encoded = JSON.stringify(pts);
    encodedPoints.set(pts, encoded);
  }
  return `${JSON.stringify(properties).slice(0, -1)},"pts":${encoded}}`;
}

function serializeState(state) {
  const { items, ...metadata } = state;
  const prefix = JSON.stringify(metadata);
  return `${prefix.slice(0, -1)}${prefix.length > 2 ? ',' : ''}"items":[${items.map(encodeItem).join(',')}]}`;
}

function cachedPointBytes(state) {
  let bytes = 0;
  const seen = new Set();
  for (const item of state.items) {
    if (!Array.isArray(item.pts) || seen.has(item.pts)) continue;
    seen.add(item.pts);
    bytes += (encodedPoints.get(item.pts)?.length || 0) * 2;
  }
  return bytes;
}

module.exports = { cloneStateForOperation, serializeState, cachedPointBytes };
