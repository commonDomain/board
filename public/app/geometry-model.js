import { MIN_ITEM_SIZE } from './constants.js';
import { round } from './utilities.js';

function findOpenCanvasPoint(width, height, preferred, occupied = [], gap = 28) {
  const overlaps = (point) =>
    occupied.some(
      (rect) =>
        point.x < Number(rect.x || 0) + Number(rect.w || 0) + gap &&
        point.x + width + gap > Number(rect.x || 0) &&
        point.y < Number(rect.y || 0) + Number(rect.h || 0) + gap &&
        point.y + height + gap > Number(rect.y || 0)
    );
  const origin = { x: Math.round(preferred.x), y: Math.round(preferred.y) };
  if (!overlaps(origin)) return origin;
  const stepX = Math.max(96, Math.min(360, Math.round(width * 0.45)));
  const stepY = Math.max(84, Math.min(280, Math.round(height * 0.45)));
  for (let ring = 1; ring <= 24; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (const dx of [-ring, ring]) {
        const candidate = { x: origin.x + dx * stepX, y: origin.y + dy * stepY };
        if (!overlaps(candidate)) return candidate;
      }
    }
    for (let dx = -ring + 1; dx < ring; dx += 1) {
      for (const dy of [-ring, ring]) {
        const candidate = { x: origin.x + dx * stepX, y: origin.y + dy * stepY };
        if (!overlaps(candidate)) return candidate;
      }
    }
  }
  return { x: origin.x + stepX * 25, y: origin.y };
}

function getRectBounds(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}

function pointsToPath(points) {
  if (!points.length) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  const commands = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const mid = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2
    };
    commands.push(`Q ${round(current.x)} ${round(current.y)} ${round(mid.x)} ${round(mid.y)}`);
  }
  const last = points[points.length - 1];
  commands.push(`L ${round(last.x)} ${round(last.y)}`);
  return commands.join(' ');
}

function getPointsBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
  };
}

function getInkItemBounds(points, strokeWidth, brushType, settings = {}) {
  const engineBounds = window.WhiteboardBrushEngine?.getBrushStrokeBounds?.(points, strokeWidth, brushType, settings);
  if (engineBounds && Number.isFinite(engineBounds.x) && Number.isFinite(engineBounds.y)) {
    return {
      x: engineBounds.x,
      y: engineBounds.y,
      w: Math.max(MIN_ITEM_SIZE, engineBounds.width),
      h: Math.max(MIN_ITEM_SIZE, engineBounds.height)
    };
  }
  const bounds = getPointsBounds(points);
  const pad = Math.max(12, Number(strokeWidth) * 2.5);
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    w: Math.max(MIN_ITEM_SIZE, bounds.w + pad * 2),
    h: Math.max(MIN_ITEM_SIZE, bounds.h + pad * 2)
  };
}
export { findOpenCanvasPoint, getRectBounds, pointsToPath, getPointsBounds, getInkItemBounds };
