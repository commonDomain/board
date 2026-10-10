import { state } from './state.js';
import { clamp, createSvg } from './utilities.js';

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeBrushPoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }
  return points
    .filter((point) => point && typeof point === 'object' && !Array.isArray(point))
    .map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
      pressure: Number.isFinite(Number(point.pressure)) ? clamp(Number(point.pressure), 0, 1) : 0.5,
      tiltX: Number.isFinite(Number(point.tiltX)) ? Number(point.tiltX) : 0,
      tiltY: Number.isFinite(Number(point.tiltY)) ? Number(point.tiltY) : 0,
      time: Number.isFinite(Number(point.time)) ? Number(point.time) : 0,
      pointerType: typeof point.pointerType === 'string' ? point.pointerType : 'mouse',
      twist: Number.isFinite(Number(point.twist)) ? Number(point.twist) : 0,
      tangentialPressure: Number.isFinite(Number(point.tangentialPressure)) ? Number(point.tangentialPressure) : 0,
      altitudeAngle: Number.isFinite(Number(point.altitudeAngle)) ? Number(point.altitudeAngle) : undefined,
      azimuthAngle: Number.isFinite(Number(point.azimuthAngle)) ? Number(point.azimuthAngle) : undefined
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function renderInk(item) {
  const engine = window.WhiteboardBrushEngine;
  if (!engine?.render) {
    console.warn('[render] Brush engine is unavailable; ink items render blank.');
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'ink-canvas';
  canvas.dataset.inkCanvas = item.id;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  const points = normalizeBrushPoints(item.pts);
  const width = Math.max(1, Number(item.baseW || item.w) || 1);
  const height = Math.max(1, Number(item.baseH || item.h) || 1);
  const pixelRatio = Math.max(
    0.05,
    Math.min(
      2.5,
      Math.max(1, window.devicePixelRatio || 1),
      4096 / width,
      4096 / height,
      Math.sqrt(4_000_000 / (width * height))
    )
  );
  if (!engine?.render || !points.length) {
    return canvas;
  }
  try {
    engine.render(canvas, {
      points,
      brushId: item.brushType || 'brush',
      color: item.stroke || '#111111',
      size: Math.max(0.1, Number(item.strokeWidth) || 4),
      opacity: Number.isFinite(Number(item.opacity)) ? clamp(Number(item.opacity), 0, 1) : 1,
      settings: item.brushOpts || {},
      seed: Number.isFinite(Number(item.seed)) ? Number(item.seed) : hashString(String(item.id || 'ink')),
      complete: true,
      pixelRatio,
      bounds: { x: 0, y: 0, width, height },
      resize: true,
      clear: true
    });
  } catch (error) {
    console.error('Canvas brush render failed.', error);
  }
  return canvas;
}

function renderConnector(item) {
  if (window.ConnectorUI) return window.ConnectorUI.render(item);
  const endpoints = connectorEndpoints(item);
  const start = endpoints.start;
  const end = endpoints.end;
  const padding = 10;
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const width = Math.max(20, Math.abs(end.x - start.x) + padding * 2);
  const height = Math.max(20, Math.abs(end.y - start.y) + padding * 2);
  item.x = minX - padding;
  item.y = minY - padding;
  item.w = width;
  item.h = height;

  const svg = createSvg('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const defs = createSvg('defs');
  const marker = createSvg('marker');
  marker.setAttribute('id', `arrow-${item.id}`);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '10');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = createSvg('path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('fill', item.stroke || '#111111');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const line = createSvg('line');
  line.setAttribute('x1', start.x - item.x);
  line.setAttribute('y1', start.y - item.y);
  line.setAttribute('x2', end.x - item.x);
  line.setAttribute('y2', end.y - item.y);
  line.setAttribute('stroke', item.stroke || '#111111');
  line.setAttribute('stroke-width', item.strokeWidth || 3);
  if (item.dasharray) {
    line.setAttribute('stroke-dasharray', item.dasharray);
  }
  if (item.arrowEnd) {
    line.setAttribute('marker-end', `url(#arrow-${item.id})`);
  }
  if (item.arrowStart) {
    line.setAttribute('marker-start', `url(#arrow-${item.id})`);
  }
  svg.appendChild(line);
  return svg;
}

function connectorEndpoints(item) {
  if (window.ConnectorUI) return window.ConnectorUI.endpoints(item);
  const startFallback = { x: item.startX ?? 0, y: item.startY ?? 0 };
  const endFallback = { x: item.endX ?? 0, y: item.endY ?? 0 };
  const start = connectorAnchor(item, item.startId, startFallback, endFallback);
  const end = connectorAnchor(item, item.endId, endFallback, start);
  return { start, end };
}

function connectorAnchor(item, id, fallback, otherPoint) {
  if (id) {
    const target = state.items.get(id);
    if (target) {
      const section = target.sectionId ? state.sections.get(target.sectionId) : null;
      if (section?.collapsed) return itemEdgePoint({ ...section, h: 44 }, otherPoint);
      return itemEdgePoint(target, otherPoint);
    }
  }
  return { x: fallback.x, y: fallback.y };
}

function itemEdgePoint(item, towardPoint) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const dx = towardPoint.x - cx;
  const dy = towardPoint.y - cy;
  if (!dx && !dy) {
    return { x: cx, y: cy };
  }
  const halfWidth = Math.max(1, item.w / 2);
  const halfHeight = Math.max(1, item.h / 2);
  const scale = Math.min(halfWidth / Math.abs(dx || 1e-6), halfHeight / Math.abs(dy || 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function renderImage(item) {
  const img = document.createElement('img');
  img.alt = '粘贴图片';
  img.draggable = false;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.fetchPriority = state.selectedIds.has(item.id) ? 'high' : 'low';
  img.src = getImageLodSource(item);
  img.dataset.source = img.src;
  return img;
}

function getImageLodSource(item) {
  if (state.exporting || !item.assetId || !/^[a-f0-9]{64}$/.test(item.assetId)) return item.src;
  const naturalWidth = Math.max(1, Number(item.naturalWidth) || Number(item.w) || 1);
  const naturalHeight = Math.max(1, Number(item.naturalHeight) || Number(item.h) || 1);
  const projected =
    Math.max(Number(item.w) || 1, Number(item.h) || 1) * state.zoom * Math.max(1, window.devicePixelRatio || 1);
  if (Math.max(naturalWidth, naturalHeight) > 320 && projected <= 320) {
    return `/assets/${item.assetId}.thumb.webp`;
  }
  if (Math.max(naturalWidth, naturalHeight) > 1600 && projected <= 1600) {
    return `/assets/${item.assetId}.medium.webp`;
  }
  return item.src;
}
export {
  hashString,
  normalizeBrushPoints,
  renderInk,
  itemEdgePoint,
  getImageLodSource,
  connectorAnchor,
  renderImage,
  connectorEndpoints,
  renderConnector
};
