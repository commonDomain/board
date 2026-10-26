// Compact numeric tuples retain sensor fields while accepting legacy [x,y,p].
const fields = ['x', 'y', 'pressure', 'time', 'tiltX', 'tiltY', 'twist', 'tangentialPressure', 'altitudeAngle', 'azimuthAngle'];
export function packInkPoint(point) {
  const mask = fields.reduce((bits, key, i) => Number.isFinite(point[key]) ? bits | (1 << i) : bits, 0);
  return [...fields.map(key => Number.isFinite(point[key]) ? point[key] : 0), ['mouse', 'touch', 'pen'].indexOf(point.pointerType), mask];
}
export function unpackInkPoint(tuple) {
  if (tuple.length < 12) return { x: tuple[0], y: tuple[1], pressure: tuple[2] ?? 0.5 };
  const point = {};
  fields.forEach((key, i) => { if (tuple[11] & (1 << i)) point[key] = tuple[i]; });
  if (tuple[10] >= 0) point.pointerType = ['mouse', 'touch', 'pen'][tuple[10]];
  return point;
}
export function inkSeed(item) {
  if (Number.isFinite(item.seed)) return item.seed;
  let hash = 2166136261;
  for (const char of String(item.id || 'ink')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
export function importInk(item) {
  return {
    inkVersion: 1, rotation: Number.isFinite(item.rotation) ? item.rotation : 0, points: (item.pts || []).map(packInkPoint),
    baseW: item.baseW || item.w, baseH: item.baseH || item.h,
    seed: inkSeed(item), brushOpts: structuredClone(item.brushOpts || {}),
    color: item.stroke || '#34313d', size: item.strokeWidth || 3,
    opacity: item.opacity ?? 1, brushType: item.brushType || 'brush'
  };
}
export function exportInk(element) {
  return {
    rotation: element.rotation || 0, pts: element.points.map(unpackInkPoint), baseW: element.baseW || element.w, baseH: element.baseH || element.h,
    stroke: element.color, strokeWidth: element.size, opacity: element.highlighter && element.inkVersion !== 1 ? 0.3 : element.opacity ?? 1,
    brushType: element.brushType || 'brush',
    ...(element.inkVersion === 1 ? { seed: element.seed, brushOpts: structuredClone(element.brushOpts || {}) } : { brushOpts: { legacyLine: true } })
  };
}
export function renderNotebookInk(canvas, element, ratio, engine) {
  if (!engine?.render) return false;
  const item = exportInk(element);
  engine.render(canvas, {
    points: item.pts, brushId: item.brushType, color: item.stroke, size: item.strokeWidth,
    opacity: item.opacity, settings: item.brushOpts, seed: item.seed,
    bounds: { x: 0, y: 0, width: item.baseW, height: item.baseH },
    pixelRatio: ratio * Math.sqrt((element.w * element.h) / (item.baseW * item.baseH)), complete: true
  });
  return true;
}

export function validInkMetadata(element) {
  if (element.inkVersion === undefined) return true;
  if (element.rotation !== undefined && (!Number.isFinite(element.rotation) || Math.abs(element.rotation) > 360)) return false;
  if (element.inkVersion !== 1 || ![element.baseW, element.baseH].every(n => Number.isFinite(n) && n > 0 && n <= 1000000)) return false;
  if (!Number.isInteger(element.seed) || element.seed < 0 || element.seed > 4294967295) return false;
  if (!Number.isFinite(element.size) || element.size < 0.1 || element.size > 2048) return false;
  if (!Number.isFinite(element.opacity) || element.opacity < 0 || element.opacity > 1) return false;
  if (!element.brushOpts || typeof element.brushOpts !== 'object' || Array.isArray(element.brushOpts)) return false;
  if (JSON.stringify(element.brushOpts).length > 4096) return false;
  const ranges = { smooth: [0,1], pressure: [0,1], pressureGamma: [.2,4], flow: [.01,1], grain: [0,1], jitter: [0,1], spacing: [.25,2], nibAngle: [-90,90], density: [.05,1], opacity: [0,1], padding: [0,1000], startTaper: [0,5000], endTaper: [0,5000] };
  for (const [key, value] of Object.entries(element.brushOpts)) {
    if (ranges[key]) { if (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1]) return false; }
    else if (key === 'renderVersion') { if (value !== 2) return false; }
    else if (key === 'angleMode') { if (!['fixed', 'direction', 'tilt'].includes(value)) return false; }
    else if (['mirrorX', 'mirrorY', 'simulatePressure', 'legacyLine'].includes(key)) { if (typeof value !== 'boolean') return false; }
    else return false;
  }
  return element.points.every(p => p.length === 12 && Number.isInteger(p[10]) && p[10] >= -1 && p[10] <= 2 && Number.isInteger(p[11]) && p[11] >= 3 && (p[11] & 3) === 3 && p[11] <= 1023);
}
