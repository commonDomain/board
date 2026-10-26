import { interpolatePoint, tiltAmount, tiltAngle } from './geometry.js';
import { clamp, finite, mulberry32 } from './math.js';
import { tiledRects } from './tiled-path.js';

function visibleRange(ax, ay, bx, by, width, height, margin) {
  let lo = 0, hi = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax + margin], [dx, width + margin - ax], [-dy, ay + margin], [dy, height + margin - ay]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [lo, hi];
}

// Work is local to a segment, never redistributed over the entire stroke.
// Offscreen segments consume no particles. Each dab has its own random stream.
export function* localDabs(ctx, points, spacing, radius) {
  const m = ctx.getTransform();
  const scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  const margin = radius * scale + 2;
  // At extreme zoom-out, sample at most twice per device pixel. The phase is
  // anchored to the stroke, so panning and appending never reshuffle old dots.
  const stride = Math.max(1, Math.ceil(0.5 / Math.max(1e-8, spacing * scale)));
  let traveled = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const first = i === 0 ? 0 : Math.floor(traveled / spacing) + 1;
    const last = Math.floor((traveled + length) / spacing);
    const ax = m.a * a.x + m.c * a.y + m.e, ay = m.b * a.x + m.d * a.y + m.f;
    const bx = m.a * b.x + m.c * b.y + m.e, by = m.b * b.x + m.d * b.y + m.f;
    const visible = visibleRange(ax, ay, bx, by, ctx.canvas.width, ctx.canvas.height, margin);
    if (visible) {
      const begin = Math.max(first, Math.ceil((traveled + length * visible[0]) / spacing));
      const end = Math.min(last, Math.floor((traveled + length * visible[1]) / spacing));
      for (let n = Math.ceil(begin / stride) * stride; n <= end; n += stride) {
        const t = length ? clamp((n * spacing - traveled) / length, 0, 1) : 0;
        const p = interpolatePoint(a, b, t);
        const x = m.a * p.x + m.c * p.y + m.e, y = m.b * p.x + m.d * p.y + m.f;
        if (x < -margin || y < -margin || x > ctx.canvas.width + margin || y > ctx.canvas.height + margin) continue;
        yield { point: p, index: n, angle: Math.atan2(b.y - a.y, b.x - a.x) };
      }
    }
    traveled += length;
  }
}

export function renderStableSpray(ctx, points, env) {
  const density = clamp(finite(env.settings.density, 0.65), 0.05, 1);
  const count = Math.max(3, Math.round(5 + density * 15));
  ctx.fillStyle = env.color;
  for (const { point, index } of localDabs(ctx, points, Math.max(0.5, env.size * 0.2 * env.spacing), env.size * 1.3)) {
    const random = mulberry32((env.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const radius = env.size * (0.35 + point.pressure * 0.75);
    ctx.beginPath();
    for (let j = 0; j < count; j++) {
      const angle = random() * Math.PI * 2, r = Math.pow(random(), 0.85) * radius;
      const x = point.x + Math.cos(angle) * r, y = point.y + Math.sin(angle) * r;
      const dot = Math.max(env.size * 0.04, Math.min(0.45, env.size * 0.16)) + env.size * random() * 0.055;
      ctx.moveTo(x + dot, y); ctx.arc(x, y, dot, 0, Math.PI * 2);
    }
    ctx.globalAlpha = env.alpha * (0.38 + point.pressure * 0.32); ctx.fill();
  }
}

export function renderStableGraphite(ctx, points, env) {
  // Connected local-width capsules, filled once so joins do not darken.
  const radius = p => env.size * (0.48 + tiltAmount(p) * 0.75) *
    (0.5 + 0.72 * env.pressureAmount * (p.pressure - 0.5));
  const base = tiledRects(ctx, env.color, env.alpha * 0.3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i], r = Math.max(0.03, radius(p));
    base.circle(p.x, p.y, r);
    if (!i) continue;
    const a = points[i - 1], ar = Math.max(0.03, radius(a));
    const angle = Math.atan2(p.y - a.y, p.x - a.x), nx = -Math.sin(angle), ny = Math.cos(angle);
    base.polygon([{x:a.x + nx * ar,y:a.y + ny * ar},{x:a.x - nx * ar,y:a.y - ny * ar},
      {x:p.x - nx * r,y:p.y - ny * r},{x:p.x + nx * r,y:p.y + ny * r}]);
  }
  base.fill();
  ctx.beginPath();
  for (const { point, index, angle: direction } of localDabs(ctx, points, Math.max(0.5, env.size * 0.1 * env.spacing), env.size * 1.4)) {
    const random = mulberry32((env.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const tilt = tiltAmount(point), angle = tiltAngle(point, direction);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const hairs = 2 + Math.round(env.grain * 5 + tilt * 3);
    for (let j = 0; j < hairs; j++) {
      const r = env.size * (0.16 + tilt * 0.52) * point.pressure;
      const a = random() * Math.PI * 2, offset = Math.sqrt(random()) * r;
      const x = point.x + Math.cos(a) * offset, y = point.y + Math.sin(a) * offset;
      const length = env.size * (0.035 + random() * (0.1 + tilt * 0.28));
      ctx.moveTo(x - dx * length, y - dy * length); ctx.lineTo(x + dx * length, y + dy * length);
    }
  }
  ctx.strokeStyle = env.color; ctx.lineWidth = Math.max(0.12, env.size * 0.022);
  ctx.lineCap = 'round'; ctx.globalAlpha = env.alpha * (0.11 + env.grain * 0.13); ctx.stroke();
}
