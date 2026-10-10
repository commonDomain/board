import { snapshotItems } from './history-controller-model.js';
import { getBoardPoint } from './camera.js';
import { els } from './elements.js';
import { eraserMayIntersectItem } from './eraser.js';
import { getInkItemBounds } from './geometry-model.js';
import { hashString, normalizeBrushPoints } from './ink-rendering-model.js';
import { upsertItem } from './items.js';
import { canMutateItem, sortedRenderItems } from './layers-model.js';
import { captureViewportPointer } from './pan.js';
import { inkGeometryRuntime } from './runtime/ink-geometry.js';
import { state } from './state.js';
import { clamp, createSvg, distance, makeId } from './utilities.js';
import { serializeStrokePoints, limitStrokePoints, rebuildInkFromPoints } from './ink-geometry-model.js';

function startSmudge(event) {
  event.preventDefault();
  const point = getBoardPoint(event);
  state.smudgePath = {
    points: [point],
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    radius: Math.max(6, state.size * 1.5)
  };
  inkGeometryRuntime.smudgePreviewCircle = createSvg('circle');
  inkGeometryRuntime.smudgePreviewCircle.setAttribute('r', String(state.smudgePath.radius));
  inkGeometryRuntime.smudgePreviewCircle.setAttribute('fill', 'none');
  inkGeometryRuntime.smudgePreviewCircle.setAttribute('stroke', 'rgba(47,125,246,0.65)');
  inkGeometryRuntime.smudgePreviewCircle.setAttribute('stroke-width', '1.5');
  inkGeometryRuntime.smudgePreviewCircle.setAttribute('stroke-dasharray', '4 3');
  updateSmudgePreview(point);
  els.drawSurface.appendChild(inkGeometryRuntime.smudgePreviewCircle);
  captureViewportPointer(event.pointerId);
}

function continueSmudge(event) {
  event.preventDefault();
  const smudge = state.smudgePath;
  if (!smudge || event.pointerId !== smudge.pointerId) {
    return;
  }
  const point = getBoardPoint(event);
  const last = smudge.points[smudge.points.length - 1];
  if (!last || distance(last, point) >= 2) {
    smudge.points.push(point);
    updateSmudgePreview(point);
  }
}

function updateSmudgePreview(point) {
  if (inkGeometryRuntime.smudgePreviewCircle) {
    inkGeometryRuntime.smudgePreviewCircle.setAttribute('cx', String(point.x));
    inkGeometryRuntime.smudgePreviewCircle.setAttribute('cy', String(point.y));
  }
}

function finishSmudge() {
  const smudge = state.smudgePath;
  state.smudgePath = null;
  inkGeometryRuntime.smudgePreviewCircle?.remove();
  inkGeometryRuntime.smudgePreviewCircle = null;
  if (!smudge || smudge.points.length < 2) {
    return;
  }
  applySmudgeToInk(limitStrokePoints(smudge.points, 1000), smudge.radius);
}

function inkItemPointsToBoard(item) {
  const localPoints = normalizeBrushPoints(item.pts);
  const baseWidth = Math.max(1, Number(item.baseW || item.w) || 1);
  const baseHeight = Math.max(1, Number(item.baseH || item.h) || 1);
  const scaleX = (Number(item.w) || baseWidth) / baseWidth;
  const scaleY = (Number(item.h) || baseHeight) / baseHeight;
  const centerX = item.x + item.w / 2;
  const centerY = item.y + item.h / 2;
  const radians = ((Number(item.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return localPoints.map((point) => {
    const x = item.x + point.x * scaleX;
    const y = item.y + point.y * scaleY;
    const dx = x - centerX;
    const dy = y - centerY;
    return {
      ...point,
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos
    };
  });
}

function createInkPiece(source, boardPoints, index) {
  boardPoints = limitStrokePoints(boardPoints);
  const sourceCopy = { ...source };
  const baseWidth = Math.max(1, Number(source.baseW || source.w) || 1);
  const baseHeight = Math.max(1, Number(source.baseH || source.h) || 1);
  const scale = Math.sqrt(
    Math.abs(((Number(source.w) || baseWidth) / baseWidth) * ((Number(source.h) || baseHeight) / baseHeight))
  );
  const strokeWidth = Math.max(0.1, (Number(source.strokeWidth) || 4) * scale);
  const { x, y, w, h } = getInkItemBounds(boardPoints, strokeWidth, source.brushType, source.brushOpts);
  const points = serializeStrokePoints(boardPoints, x, y);
  return {
    ...sourceCopy,
    id: index === 0 ? source.id : makeId('ink'),
    x,
    y,
    w,
    h,
    baseW: w,
    baseH: h,
    rotation: 0,
    strokeWidth,
    pts: points,
    seed:
      index === 0
        ? (Number(source.seed) || hashString(source.id)) >>> 0
        : ((Number(source.seed) || hashString(source.id)) + Math.imul(index, 0x9e3779b1)) >>> 0,
    brushOpts: { ...(source.brushOpts || {}) }
  };
}

function applySmudgeToInk(smudgePoints, radius) {
  const beforeItems = snapshotItems();
  let first = true;
  const items = sortedRenderItems().reverse();
  for (const item of items) {
    if (item.type !== 'ink' || !canMutateItem(item)) {
      continue;
    }
    const rotation = Math.abs(Number(item.rotation) || 0) % 360;
    if (rotation < 0.01 && !eraserMayIntersectItem(item, smudgePoints, radius)) {
      continue;
    }
    if (smudgeInkItem(item, smudgePoints, radius)) {
      upsertItem(item, first ? { historySnapshot: beforeItems } : { history: false });
      first = false;
    }
  }
}

function smudgeInkItem(item, smudgePoints, radius) {
  const points = inkItemPointsToBoard(item);
  if (points.length < 2) {
    return false;
  }
  const cellSize = Math.max(4, radius);
  const grid = new Map();
  const pointCells = new Array(points.length);
  const cellKey = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  const addToGrid = (index) => {
    const key = cellKey(points[index].x, points[index].y);
    pointCells[index] = key;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = new Set();
      grid.set(key, bucket);
    }
    bucket.add(index);
  };
  points.forEach((_, index) => addToGrid(index));
  let changed = false;
  for (let index = 1; index < smudgePoints.length; index += 1) {
    const a = smudgePoints[index - 1];
    const b = smudgePoints[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segmentLength = Math.hypot(dx, dy) || 1;
    const candidateIndexes = new Set();
    const minCellX = Math.floor((Math.min(a.x, b.x) - radius) / cellSize);
    const maxCellX = Math.floor((Math.max(a.x, b.x) + radius) / cellSize);
    const minCellY = Math.floor((Math.min(a.y, b.y) - radius) / cellSize);
    const maxCellY = Math.floor((Math.max(a.y, b.y) + radius) / cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (const pointIndex of grid.get(`${cellX},${cellY}`) || []) {
          candidateIndexes.add(pointIndex);
        }
      }
    }
    for (const pointIndex of candidateIndexes) {
      const point = points[pointIndex];
      const relX = point.x - a.x;
      const relY = point.y - a.y;
      const t = clamp((relX * dx + relY * dy) / (segmentLength * segmentLength), 0, 1);
      const closestX = a.x + dx * t;
      const closestY = a.y + dy * t;
      const distanceToSegment = Math.hypot(point.x - closestX, point.y - closestY);
      if (distanceToSegment < radius) {
        const falloff = 1 - distanceToSegment / radius;
        const strength = falloff * falloff * 0.9;
        point.x += dx * strength;
        point.y += dy * strength;
        const nextCell = cellKey(point.x, point.y);
        if (nextCell !== pointCells[pointIndex]) {
          grid.get(pointCells[pointIndex])?.delete(pointIndex);
          addToGrid(pointIndex);
        }
        changed = true;
      }
    }
  }
  if (!changed) {
    return false;
  }
  rebuildInkFromPoints(item, points);
  return true;
}
export {
  startSmudge,
  continueSmudge,
  updateSmudgePreview,
  finishSmudge,
  inkItemPointsToBoard,
  createInkPiece,
  applySmudgeToInk,
  smudgeInkItem
};
