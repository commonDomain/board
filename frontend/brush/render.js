import {
  renderCalligraphy,
  renderCrayon,
  renderGraphite,
  renderInk,
  renderMarker,
  renderOil,
  renderPen,
  renderSpray,
  renderWatercolor
} from './brushes.js';
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, MAX_CENTERLINE_POINTS, MAX_PIXEL_RATIO, global } from './constants.js';
import {
  applyPressureDynamics,
  getBrushStrokeBounds,
  getStrokeBounds,
  normalizePoints,
  resampleByDistance
} from './geometry.js';
import { clamp, finite, mulberry32, normalizeBrushId, normalizeSeed } from './math.js';

const RENDERERS = Object.freeze({
  pen: renderPen,
  ink: renderInk,
  calligraphy: renderCalligraphy,
  spray: renderSpray,
  oil: renderOil,
  crayon: renderCrayon,
  marker: renderMarker,
  graphite: renderGraphite,
  watercolor: renderWatercolor
});

function normalizeBounds(bounds, fallback) {
  if (!bounds || typeof bounds !== 'object') {
    return fallback;
  }
  const x = finite(bounds.x !== undefined ? bounds.x : bounds.left, fallback.x);
  const y = finite(bounds.y !== undefined ? bounds.y : bounds.top, fallback.y);
  const width = Math.max(1, finite(bounds.width !== undefined ? bounds.width : bounds.w, fallback.width));
  const height = Math.max(1, finite(bounds.height !== undefined ? bounds.height : bounds.h, fallback.height));
  return {
    x,
    y,
    width,
    height,
    w: width,
    h: height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height
  };
}

function fitPixelRatio(logicalWidth, logicalHeight, requestedRatio) {
  let ratio = clamp(finite(requestedRatio, 1), 1e-8, MAX_PIXEL_RATIO);
  ratio = Math.min(
    ratio,
    MAX_CANVAS_SIDE / Math.max(1, logicalWidth),
    MAX_CANVAS_SIDE / Math.max(1, logicalHeight),
    Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, logicalWidth * logicalHeight))
  );
  return Math.max(1e-8, ratio);
}

function clearCanvas(ctx, canvas) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function render(canvas, options) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('WhiteboardBrushEngine.render requires a Canvas or OffscreenCanvas.');
  }
  const opts = options && typeof options === 'object' ? options : {};
  const settings = opts.settings && typeof opts.settings === 'object' ? opts.settings : {};
  const rawPoints = normalizePoints(opts.points);
  if (!rawPoints.length) {
    return {
      brushId: normalizeBrushId(opts.brushId),
      bounds: getStrokeBounds([], opts.size, 0),
      pixelRatio: 1,
      canvasWidth: canvas.width || 0,
      canvasHeight: canvas.height || 0,
      rendered: false
    };
  }

  const brushId = normalizeBrushId(opts.brushId);
  const size = clamp(finite(opts.size, 4), 0.1, 2048);
  const opacity = clamp(finite(opts.opacity, 1), 0, 1);
  const pressureAmount = clamp(finite(settings.pressure, 1), 0, 1);
  const smooth = clamp(finite(settings.smooth, 0.35), 0, 1);
  const grain = clamp(finite(settings.grain, 0.55), 0, 1);
  const jitter = clamp(finite(settings.jitter, 0.12), 0, 1);
  const spacing = clamp(finite(settings.spacing, 1), 0.2, 3);
  const flow = clamp(finite(settings.flow, 1), 0.01, 1);
  const complete = opts.complete !== false;
  const color = String(opts.color || '#111111');
  const dynamicPoints = applyPressureDynamics(rawPoints, settings);
  const centerlineSpacing = Math.max(0.12, size * 0.035);
  const centerline = resampleByDistance(dynamicPoints, centerlineSpacing, MAX_CENTERLINE_POINTS);
  const calculatedBounds = getBrushStrokeBounds(centerline, size, brushId, settings);
  const bounds = normalizeBounds(opts.bounds, calculatedBounds);
  const resize = opts.resize !== false;
  const shouldClear = opts.clear !== undefined ? Boolean(opts.clear) : resize;
  const requestedPixelRatio = finite(opts.pixelRatio, global.devicePixelRatio || 1);
  const effectivePixelRatio = resize
    ? fitPixelRatio(bounds.width, bounds.height, requestedPixelRatio)
    : clamp(requestedPixelRatio, 1e-8, MAX_PIXEL_RATIO);

  if (resize) {
    const nextWidth = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.ceil(bounds.width * effectivePixelRatio)));
    const nextHeight = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.ceil(bounds.height * effectivePixelRatio)));
    if (canvas.width !== nextWidth) {
      canvas.width = nextWidth;
    }
    if (canvas.height !== nextHeight) {
      canvas.height = nextHeight;
    }
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    throw new Error('Canvas2D is not available.');
  }
  if (shouldClear) {
    clearCanvas(ctx, canvas);
  }

  const eraser = opts.eraser === true || settings.eraser === true || opts.compositeOperation === 'destination-out';
  const requestedComposite = String(opts.compositeOperation || settings.compositeOperation || 'source-over');
  const compositeOperation = eraser ? 'destination-out' : requestedComposite;
  const allowedComposite = new Set([
    'source-over',
    'destination-out',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light'
  ]);
  const originX = resize ? bounds.x : finite(opts.originX, 0);
  const originY = resize ? bounds.y : finite(opts.originY, 0);

  ctx.save();
  ctx.setTransform(
    effectivePixelRatio,
    0,
    0,
    effectivePixelRatio,
    -originX * effectivePixelRatio,
    -originY * effectivePixelRatio
  );
  if (Array.isArray(opts.transform) && opts.transform.length === 6 && opts.transform.every(Number.isFinite)) {
    ctx.setTransform(...opts.transform.map((value) => value * effectivePixelRatio));
  }
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.globalCompositeOperation = allowedComposite.has(compositeOperation) ? compositeOperation : 'source-over';

  const random = mulberry32(normalizeSeed(opts.seed, `${brushId}:${color}`));
  const environment = {
    color,
    size,
    alpha: opacity * flow,
    settings,
    complete,
    pressureAmount,
    smooth,
    grain,
    jitter,
    spacing,
    random
  };
  RENDERERS[brushId](ctx, centerline, environment);
  ctx.restore();

  return {
    brushId,
    bounds,
    pixelRatio: effectivePixelRatio,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    pointCount: centerline.length,
    compositeOperation: allowedComposite.has(compositeOperation) ? compositeOperation : 'source-over',
    rendered: true
  };
}

export { RENDERERS, clearCanvas, fitPixelRatio, normalizeBounds, render };
