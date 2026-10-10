import { BRUSH_PADDING, MAX_TEXTURE_DABS } from './constants.js';
import { clamp, distance, finite, lerp, normalizeBrushId } from './math.js';

function getStrokeBounds(points, size, padding) {
  if (!Array.isArray(points) || !points.length) {
    return { x: 0, y: 0, width: 0, height: 0, w: 0, h: 0, left: 0, top: 0, right: 0, bottom: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const x = finite(point && point.x, NaN);
    const y = finite(point && point.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0, w: 0, h: 0, left: 0, top: 0, right: 0, bottom: 0 };
  }
  const inset = Math.max(0, finite(size, 1) / 2 + finite(padding, 0));
  const left = minX - inset;
  const top = minY - inset;
  const right = maxX + inset;
  const bottom = maxY + inset;
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
    left,
    top,
    right,
    bottom
  };
}

function getBrushStrokeBounds(points, size, brushId, settings = {}) {
  const normalizedSize = clamp(finite(size, 4), 0.1, 2048);
  const paddingScale = BRUSH_PADDING[normalizeBrushId(brushId)] || 1.5;
  const padding = normalizedSize * paddingScale + Math.max(0, finite(settings.padding, 2));
  return getStrokeBounds(normalizePoints(points), normalizedSize * paddingScale, padding);
}

function normalizePoints(points) {
  const normalized = [];
  if (!Array.isArray(points)) {
    return normalized;
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }
    if (typeof point !== 'object' || Array.isArray(point)) {
      continue;
    }
    const x = finite(point.x, NaN);
    const y = finite(point.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    normalized.push({
      x,
      y,
      pressure: clamp(finite(point.pressure, 0.5), 0, 1),
      tiltX: clamp(finite(point.tiltX, 0), -90, 90),
      tiltY: clamp(finite(point.tiltY, 0), -90, 90),
      time: finite(point.time !== undefined ? point.time : point.timeStamp, index * 8),
      pointerType: String(point.pointerType || 'mouse'),
      twist: finite(point.twist, 0),
      altitudeAngle: finite(point.altitudeAngle, Math.PI / 2),
      azimuthAngle: finite(point.azimuthAngle, 0),
      velocity: 0
    });
  }
  let filteredVelocity = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const point = normalized[index];
    const dt = clamp(point.time - previous.time || 8, 1, 64);
    const rawVelocity = distance(previous, point) / dt;
    filteredVelocity = lerp(filteredVelocity, rawVelocity, 0.32);
    point.velocity = filteredVelocity;
  }
  if (normalized.length > 1) {
    normalized[0].velocity = normalized[1].velocity;
  }
  return normalized;
}

function interpolatePoint(a, b, amount) {
  return {
    x: lerp(a.x, b.x, amount),
    y: lerp(a.y, b.y, amount),
    pressure: lerp(a.pressure, b.pressure, amount),
    tiltX: lerp(a.tiltX, b.tiltX, amount),
    tiltY: lerp(a.tiltY, b.tiltY, amount),
    time: lerp(a.time, b.time, amount),
    pointerType: amount < 0.5 ? a.pointerType : b.pointerType,
    twist: lerp(a.twist || 0, b.twist || 0, amount),
    altitudeAngle: lerp(a.altitudeAngle, b.altitudeAngle, amount),
    azimuthAngle: lerp(a.azimuthAngle, b.azimuthAngle, amount),
    velocity: lerp(a.velocity || 0, b.velocity || 0, amount)
  };
}

function totalPathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

function resampleByDistance(points, requestedSpacing, limit) {
  if (points.length < 2) {
    return points.slice();
  }
  const cap = Math.max(2, Math.floor(finite(limit, MAX_TEXTURE_DABS)));
  const total = totalPathLength(points);
  const spacing = Math.max(0.05, finite(requestedSpacing, 1), total / Math.max(1, cap - 1));
  const output = [{ ...points[0] }];
  let distanceSinceSample = 0;

  for (let index = 1; index < points.length && output.length < cap; index += 1) {
    let start = points[index - 1];
    const end = points[index];
    let segmentLength = distance(start, end);
    if (segmentLength < 1e-6) {
      continue;
    }
    while (distanceSinceSample + segmentLength >= spacing && output.length < cap) {
      const amount = (spacing - distanceSinceSample) / segmentLength;
      const sample = interpolatePoint(start, end, clamp(amount, 0, 1));
      output.push(sample);
      start = sample;
      segmentLength = distance(start, end);
      distanceSinceSample = 0;
      if (segmentLength < 1e-6) {
        break;
      }
    }
    distanceSinceSample += segmentLength;
  }

  const last = points[points.length - 1];
  if (output.length < cap && distance(output[output.length - 1], last) > 1e-4) {
    output.push({ ...last });
  }
  return output;
}

function applyPressureDynamics(points, settings) {
  const sensitivity = clamp(finite(settings.pressure, 1), 0, 1);
  const gamma = clamp(finite(settings.pressureGamma, 1), 0.2, 4);
  const forceSimulation = settings.simulatePressure === true;
  return points.map((point) => {
    let pressure = point.pressure;
    if (forceSimulation || (settings.simulatePressure !== false && point.pointerType === 'mouse')) {
      const simulated = clamp(0.12 + 0.88 / (1 + point.velocity * 0.8), 0.12, 1);
      pressure = simulated;
    }
    pressure = Math.pow(clamp(pressure, 0, 1), gamma);
    pressure = lerp(0.5, pressure, sensitivity);
    return { ...point, pressure: clamp(pressure, 0.01, 1) };
  });
}

function directionAt(points, index) {
  const previous = points[Math.max(0, index - 1)] || points[index];
  const next = points[Math.min(points.length - 1, index + 1)] || points[index];
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length, angle: Math.atan2(dy, dx) };
}

function tiltAmount(point) {
  if (Number.isFinite(point.altitudeAngle) && point.altitudeAngle >= 0 && point.altitudeAngle <= Math.PI / 2) {
    return clamp(1 - point.altitudeAngle / (Math.PI / 2), 0, 1);
  }
  return clamp(Math.hypot(point.tiltX || 0, point.tiltY || 0) / 90, 0, 1);
}

function tiltAngle(point, fallback) {
  if (Math.abs(point.tiltX || 0) + Math.abs(point.tiltY || 0) > 2) {
    return Math.atan2(point.tiltY, point.tiltX);
  }
  if (Number.isFinite(point.azimuthAngle)) {
    return point.azimuthAngle;
  }
  return fallback;
}

export {
  applyPressureDynamics,
  directionAt,
  getBrushStrokeBounds,
  getStrokeBounds,
  interpolatePoint,
  normalizePoints,
  resampleByDistance,
  tiltAmount,
  tiltAngle,
  totalPathLength
};
