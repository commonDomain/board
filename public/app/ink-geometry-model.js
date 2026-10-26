import { getInkItemBounds } from './geometry-model.js';
import { clamp, distance } from './utilities.js';

function densifyStrokePoints(points, maxStep) {
  if (points.length < 2) {
    return points.slice();
  }
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalLength += distance(points[index - 1], points[index]);
  }
  const effectiveStep = Math.max(0.25, maxStep, totalLength / 80_000);
  const dense = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const count = Math.max(1, Math.ceil(distance(a, b) / effectiveStep));
    for (let step = 1; step <= count; step += 1) {
      const t = step / count;
      dense.push(interpolateStrokePoint(a, b, t));
    }
  }
  return dense;
}

function interpolateStrokePoint(a, b, t) {
  return {
    ...a,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    tiltX: a.tiltX + (b.tiltX - a.tiltX) * t,
    tiltY: a.tiltY + (b.tiltY - a.tiltY) * t,
    time: a.time + (b.time - a.time) * t,
    twist: a.twist + (b.twist - a.twist) * t
  };
}

function createEraserHitTester(path, radius) {
  const sampleStep = Math.max(1, radius * 0.35);
  const samples = densifyStrokePoints(path, sampleStep);
  const cellSize = Math.max(4, radius * 2);
  const cells = new Map();
  for (const sample of samples) {
    const x = Math.floor(sample.x / cellSize);
    const y = Math.floor(sample.y / cellSize);
    const key = `${x}:${y}`;
    if (!cells.has(key)) {
      cells.set(key, []);
    }
    cells.get(key).push(sample);
  }
  return (point, extraRadius = 0) => {
    const threshold = radius + extraRadius + sampleStep * 0.5;
    const range = Math.max(1, Math.ceil(threshold / cellSize));
    const centerX = Math.floor(point.x / cellSize);
    const centerY = Math.floor(point.y / cellSize);
    for (let y = centerY - range; y <= centerY + range; y += 1) {
      for (let x = centerX - range; x <= centerX + range; x += 1) {
        const candidates = cells.get(`${x}:${y}`);
        if (candidates?.some((sample) => distance(point, sample) <= threshold)) {
          return true;
        }
      }
    }
    return false;
  };
}

function splitKeptStrokeRuns(points, removed) {
  const runs = [];
  let run = [];
  for (let index = 0; index < points.length; index += 1) {
    if (!removed[index]) {
      run.push(points[index]);
    } else if (run.length) {
      runs.push(ensureDrawableStrokeRun(run));
      run = [];
    }
  }
  if (run.length) {
    runs.push(ensureDrawableStrokeRun(run));
  }
  return runs;
}

function ensureDrawableStrokeRun(points) {
  if (points.length !== 1) {
    return points;
  }
  return [points[0], { ...points[0], x: points[0].x + 0.01, time: (points[0].time || 0) + 1 }];
}

function rebuildInkFromPoints(item, points) {
  const baseWidth = Math.max(1, Number(item.baseW || item.w) || 1);
  const baseHeight = Math.max(1, Number(item.baseH || item.h) || 1);
  const scale = Math.sqrt(
    Math.abs(((Number(item.w) || baseWidth) / baseWidth) * ((Number(item.h) || baseHeight) / baseHeight))
  );
  item.strokeWidth = Math.max(0.1, (Number(item.strokeWidth) || 4) * scale);
  const { x, y, w, h } = getInkItemBounds(points, item.strokeWidth, item.brushType, item.brushOpts);
  item.x = x;
  item.y = y;
  item.w = w;
  item.h = h;
  item.baseW = w;
  item.baseH = h;
  item.rotation = 0;
  const localPoints = serializeStrokePoints(points, x, y);
  item.pts = localPoints;
}

function serializeStrokePoints(points, originX = 0, originY = 0) {
  const firstTime = Number(points[0]?.time) || 0;
  return points.map((point) => ({
    x: Math.round((point.x - originX) * 100) / 100,
    y: Math.round((point.y - originY) * 100) / 100,
    pressure: Math.round(clamp(Number(point.pressure) || 0, 0, 1) * 1000) / 1000,
    tiltX: Math.round((Number(point.tiltX) || 0) * 10) / 10,
    tiltY: Math.round((Number(point.tiltY) || 0) * 10) / 10,
    time: Math.max(0, Math.round(((Number(point.time) || firstTime) - firstTime) * 10) / 10),
    pointerType: point.pointerType || 'mouse',
    twist: Math.round((Number(point.twist) || 0) * 10) / 10,
    tangentialPressure: Math.round(clamp(Number(point.tangentialPressure) || 0, -1, 1) * 1000) / 1000,
    altitudeAngle: Number.isFinite(Number(point.altitudeAngle))
      ? Math.round(Number(point.altitudeAngle) * 10_000) / 10_000
      : undefined,
    azimuthAngle: Number.isFinite(Number(point.azimuthAngle))
      ? Math.round(Number(point.azimuthAngle) * 10_000) / 10_000
      : undefined
  }));
}

function limitStrokePoints(points, maximum = 6_000) {
  if (points.length <= maximum) {
    return points;
  }
  const step = (points.length - 1) / (maximum - 1);
  const limited = [];
  for (let index = 0; index < maximum; index += 1) {
    limited.push(points[Math.min(points.length - 1, Math.round(index * step))]);
  }
  return limited;
}
export {
  interpolateStrokePoint,
  ensureDrawableStrokeRun,
  serializeStrokePoints,
  limitStrokePoints,
  densifyStrokePoints,
  createEraserHitTester,
  splitKeptStrokeRuns,
  rebuildInkFromPoints
};
