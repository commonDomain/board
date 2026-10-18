import { canMutateItem } from './layers-model.js';
import { getRectBounds } from './geometry-model.js';
import { intersectsRect } from './rendering-model.js';
import { state } from './state.js';

function isTransformableItem(item) {
  return canMutateItem(item);
}

function pickPrimarySelection(point, ids) {
  let containing = null;
  for (const id of ids) {
    const item = state.items.get(id);
    if (item && point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h) {
      containing = item;
      break;
    }
  }
  if (containing) {
    return containing.id;
  }
  let primary = null;
  let primaryZ = -Infinity;
  for (const id of ids) {
    const item = state.items.get(id);
    if (item && Number(item.z || 1) > primaryZ) {
      primary = id;
      primaryZ = Number(item.z || 1);
    }
  }
  return primary;
}

function itemIntersectsLasso(item, polygon) {
  if (!polygon || polygon.length < 3) {
    return false;
  }
  if (item.type === 'connector') return connectorIntersectsPolygon(item, polygon);
  const corners = [
    { x: item.x, y: item.y },
    { x: item.x + item.w, y: item.y },
    { x: item.x + item.w, y: item.y + item.h },
    { x: item.x, y: item.y + item.h }
  ].map(point => {
    const angle = (Number(item.rotation) || 0) * Math.PI / 180;
    const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
    return { x: cx + (point.x - cx) * Math.cos(angle) - (point.y - cy) * Math.sin(angle),
      y: cy + (point.x - cx) * Math.sin(angle) + (point.y - cy) * Math.cos(angle) };
  });
  if (corners.some((point) => pointInPolygon(point, polygon))) {
    return true;
  }
  if (
    polygon.some(
      (point) => pointInPolygon(point, corners)
    )
  ) {
    return true;
  }
  const rectangleEdges = corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]]);
  for (let index = 0; index < polygon.length; index += 1) {
    const edge = [polygon[index], polygon[(index + 1) % polygon.length]];
    if (
      rectangleEdges.some((rectangleEdge) => segmentsIntersect(edge[0], edge[1], rectangleEdge[0], rectangleEdge[1]))
    ) {
      return true;
    }
  }
  return false;
}

function itemIntersectsMarquee(item, marquee) {
  if (marquee.mode === 'lasso') return itemIntersectsLasso(item, marquee.points);
  const rect = getRectBounds(marquee.start, marquee.current);
  if (item.type !== 'connector' && !item.rotation) return intersectsRect(item, rect);
  return itemIntersectsLasso(item, [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h }
  ]);
}

function connectorIntersectsPolygon(item, polygon) {
  const route = window.ConnectorUI?.selectionGeometry(item);
  if (!route?.points?.length) return false;
  const { points, radius } = route;
  if (points.some(point => pointInPolygon(point, polygon))) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    for (let segment = 1; segment < points.length; segment += 1) {
      const c = points[segment - 1], d = points[segment];
      if (segmentsIntersect(a, b, c, d) ||
        window.ConnectorCore.distanceToSegment(a, c, d) <= radius ||
        window.ConnectorCore.distanceToSegment(b, c, d) <= radius ||
        window.ConnectorCore.distanceToSegment(c, a, b) <= radius ||
        window.ConnectorCore.distanceToSegment(d, a, b) <= radius) return true;
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const epsilon = 1e-8;
  const hasOppositeSigns = (left, right) =>
    (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon);
  if (hasOppositeSigns(abC, abD) && hasOppositeSigns(cdA, cdB)) {
    return true;
  }
  const liesOnSegment = (p, q, r) =>
    r.x >= Math.min(p.x, q.x) - epsilon &&
    r.x <= Math.max(p.x, q.x) + epsilon &&
    r.y >= Math.min(p.y, q.y) - epsilon &&
    r.y <= Math.max(p.y, q.y) + epsilon;
  return (
    (Math.abs(abC) <= epsilon && liesOnSegment(a, b, c)) ||
    (Math.abs(abD) <= epsilon && liesOnSegment(a, b, d)) ||
    (Math.abs(cdA) <= epsilon && liesOnSegment(c, d, a)) ||
    (Math.abs(cdB) <= epsilon && liesOnSegment(c, d, b))
  );
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const previousPoint = polygon[previous];
    const intersects =
      previousPoint.y > point.y !== current.y > point.y &&
      point.x <
        ((current.x - previousPoint.x) * (point.y - previousPoint.y)) / (current.y - previousPoint.y) + previousPoint.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}
export { isTransformableItem, pickPrimarySelection, segmentsIntersect, pointInPolygon, itemIntersectsLasso, itemIntersectsMarquee };
