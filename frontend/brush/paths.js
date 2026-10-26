import { global } from './constants.js';
import { clamp, finite } from './math.js';

function traceCenterline(ctx, points) {
  if (!points.length) {
    return;
  }
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    ctx.lineTo(points[0].x + 0.01, points[0].y);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function fillOutline(ctx, outline, color, alpha) {
  if (!Array.isArray(outline) || outline.length < 3) {
    return false;
  }
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length - 1; index += 1) {
    const current = outline[index];
    const next = outline[index + 1];
    ctx.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }
  const last = outline[outline.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fill();
  return true;
}

function drawPerfectStroke(ctx, points, options, color, alpha) {
  const perfectFreehand = global.PerfectFreehand;
  if (perfectFreehand && typeof perfectFreehand.getStroke === 'function') {
    try {
      const input = points.map((point) => [point.x, point.y, point.pressure]);
      const outline = perfectFreehand.getStroke(input, options);
      if (fillOutline(ctx, outline, color, alpha)) {
        return;
      }
    } catch {
      // Fall back to a regular Canvas path if the optional dependency rejects input.
    }
  }
  ctx.beginPath();
  traceCenterline(ctx, points);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.1, options.size || 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.stroke();
}

function perfectOptions(size, settings, complete, overrides) {
  const smooth = clamp(finite(settings.smooth, 0.35), 0, 1);
  const endTaper = complete === false ? 0 : Math.max(0, finite(settings.endTaper, 0));
  return {
    size: Math.max(0.1, size),
    thinning: clamp(finite(overrides.thinning, 0.5), -1, 1),
    smoothing: clamp(finite(overrides.smoothing, 0.45 + smooth * 0.45), 0, 1),
    streamline: clamp(finite(overrides.streamline, 0.15 + smooth * 0.72), 0, 1),
    simulatePressure: false,
    last: complete !== false,
    start: {
      cap: overrides.startCap !== false,
      taper: Math.max(0, finite(settings.startTaper, 0))
    },
    end: {
      cap: overrides.endCap !== false,
      taper: endTaper
    }
  };
}

function addRotatedRect(ctx, x, y, halfWidth, halfHeight, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight]
  ];
  const firstX = x + points[0][0] * cos - points[0][1] * sin;
  const firstY = y + points[0][0] * sin + points[0][1] * cos;
  ctx.moveTo(firstX, firstY);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(
      x + points[index][0] * cos - points[index][1] * sin,
      y + points[index][0] * sin + points[index][1] * cos
    );
  }
  ctx.closePath();
}

export { addRotatedRect, drawPerfectStroke, fillOutline, perfectOptions, traceCenterline };
