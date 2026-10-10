import { adjustColor } from './color.js';
import { MAX_PARTICLES, MAX_TEXTURE_DABS, TAU } from './constants.js';
import { directionAt, resampleByDistance, tiltAmount, tiltAngle } from './geometry.js';
import { clamp, finite } from './math.js';
import { addRotatedRect, drawPerfectStroke, perfectOptions, traceCenterline } from './paths.js';

function renderPen(ctx, points, env) {
  drawPerfectStroke(
    ctx,
    points,
    perfectOptions(env.size, env.settings, env.complete, {
      thinning: 0.58 * env.pressureAmount,
      smoothing: 0.72,
      streamline: 0.2 + env.smooth * 0.62
    }),
    env.color,
    env.alpha
  );
}

function renderInk(ctx, points, env) {
  drawPerfectStroke(
    ctx,
    points,
    perfectOptions(env.size * 1.22, env.settings, env.complete, {
      thinning: 0.88 * env.pressureAmount,
      smoothing: 0.78,
      streamline: 0.3 + env.smooth * 0.58
    }),
    env.color,
    env.alpha * 0.9
  );
  drawPerfectStroke(
    ctx,
    points,
    perfectOptions(env.size * 0.48, env.settings, env.complete, {
      thinning: 0.65 * env.pressureAmount,
      smoothing: 0.7,
      streamline: 0.25 + env.smooth * 0.5
    }),
    env.color,
    env.alpha * 0.3
  );

  const dabs = resampleByDistance(points, env.size * 0.22 * env.spacing, MAX_TEXTURE_DABS);
  ctx.beginPath();
  for (let index = 0; index < dabs.length; index += 1) {
    const point = dabs[index];
    if (env.random() > 0.32 + env.grain * 0.45) {
      continue;
    }
    const direction = directionAt(dabs, index);
    const normalX = -direction.y;
    const normalY = direction.x;
    const offset = (env.random() * 2 - 1) * env.size * 0.46 * point.pressure;
    const length = env.size * (0.1 + env.random() * 0.28);
    const x = point.x + normalX * offset;
    const y = point.y + normalY * offset;
    ctx.moveTo(x - direction.x * length, y - direction.y * length);
    ctx.lineTo(x + direction.x * length, y + direction.y * length);
  }
  ctx.strokeStyle = env.color;
  ctx.lineWidth = Math.max(0.2, env.size * 0.035);
  ctx.lineCap = 'round';
  ctx.globalAlpha = env.alpha * (0.08 + env.grain * 0.12);
  ctx.stroke();
}

function renderCalligraphy(ctx, points, env) {
  const dabs = resampleByDistance(points, env.size * 0.105 * env.spacing, MAX_TEXTURE_DABS);
  const fixedAngle = (finite(env.settings.nibAngle, -55) * Math.PI) / 180;
  ctx.fillStyle = env.color;
  for (let index = 0; index < dabs.length; index += 1) {
    const point = dabs[index];
    const direction = directionAt(dabs, index);
    const angleMode = env.settings.angleMode || 'fixed';
    const angle =
      angleMode === 'tilt' ? tiltAngle(point, fixedAngle) : angleMode === 'direction' ? direction.angle : fixedAngle;
    const pressureScale = 0.25 + point.pressure * 0.9;
    const tilt = tiltAmount(point);
    const radiusX = env.size * 0.62 * pressureScale;
    const radiusY = radiusX * clamp(0.18 + tilt * 0.12, 0.16, 0.34);
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, radiusX, radiusY, angle, 0, TAU);
    ctx.globalAlpha = env.alpha * 0.34;
    ctx.fill();
  }
}

function renderSpray(ctx, points, env) {
  const dabs = resampleByDistance(points, env.size * 0.2 * env.spacing, MAX_TEXTURE_DABS);
  const density = clamp(finite(env.settings.density, 0.65), 0.05, 1);
  const desiredPerDab = Math.max(3, Math.round(5 + density * 15));
  const particlesPerDab = Math.max(1, Math.min(desiredPerDab, Math.floor(MAX_PARTICLES / Math.max(1, dabs.length))));
  ctx.fillStyle = env.color;
  for (const point of dabs) {
    ctx.beginPath();
    const radius = env.size * (0.35 + point.pressure * 0.75);
    for (let particle = 0; particle < particlesPerDab; particle += 1) {
      const angle = env.random() * TAU;
      const radial = Math.pow(env.random(), 0.85) * radius;
      const x = point.x + Math.cos(angle) * radial;
      const y = point.y + Math.sin(angle) * radial;
      const dotRadius = Math.max(env.size * 0.04, Math.min(0.45, env.size * 0.16)) + env.size * env.random() * 0.055;
      ctx.moveTo(x + dotRadius, y);
      ctx.arc(x, y, dotRadius, 0, TAU);
    }
    ctx.globalAlpha = env.alpha * (0.38 + point.pressure * 0.32);
    ctx.fill();
  }
}

function renderOil(ctx, points, env) {
  drawPerfectStroke(
    ctx,
    points,
    perfectOptions(env.size * 1.45, env.settings, env.complete, {
      thinning: 0.36 * env.pressureAmount,
      smoothing: 0.68,
      streamline: 0.18 + env.smooth * 0.45
    }),
    env.color,
    env.alpha * 0.48
  );
  const dabs = resampleByDistance(points, env.size * 0.15 * env.spacing, MAX_TEXTURE_DABS);
  const colors = [adjustColor(env.color, -28), env.color, adjustColor(env.color, 34)];
  for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
    ctx.beginPath();
    for (let index = 0; index < dabs.length; index += 1) {
      const point = dabs[index];
      const direction = directionAt(dabs, index);
      const normalX = -direction.y;
      const normalY = direction.x;
      const bristles = 1 + Math.round(env.grain * 2);
      for (let bristle = 0; bristle < bristles; bristle += 1) {
        const offset = (env.random() * 2 - 1) * env.size * 0.55 * point.pressure;
        const jitter = (env.random() * 2 - 1) * env.jitter * env.size * 0.18;
        const length = env.size * (0.18 + env.random() * 0.55);
        const x = point.x + normalX * (offset + jitter);
        const y = point.y + normalY * (offset + jitter);
        ctx.moveTo(x - direction.x * length * 0.35, y - direction.y * length * 0.35);
        ctx.lineTo(x + direction.x * length * 0.65, y + direction.y * length * 0.65);
      }
    }
    ctx.strokeStyle = colors[colorIndex];
    ctx.lineWidth = Math.max(0.25, env.size * (0.035 + colorIndex * 0.018));
    ctx.lineCap = 'round';
    ctx.globalAlpha = env.alpha * (colorIndex === 1 ? 0.28 : 0.16);
    ctx.stroke();
  }
}

function renderCrayon(ctx, points, env) {
  drawPerfectStroke(
    ctx,
    points,
    perfectOptions(env.size * 1.08, env.settings, env.complete, {
      thinning: 0.24 * env.pressureAmount,
      smoothing: 0.58,
      streamline: 0.12 + env.smooth * 0.35
    }),
    env.color,
    env.alpha * 0.2
  );
  const dabs = resampleByDistance(points, env.size * 0.12 * env.spacing, MAX_TEXTURE_DABS);
  ctx.beginPath();
  for (let index = 0; index < dabs.length; index += 1) {
    const point = dabs[index];
    const direction = directionAt(dabs, index);
    const flecks = 3 + Math.round(env.grain * 7);
    for (let fleck = 0; fleck < flecks; fleck += 1) {
      if (env.random() < 0.12) {
        continue;
      }
      const across = (env.random() * 2 - 1) * env.size * 0.5 * point.pressure;
      const along = (env.random() * 2 - 1) * env.size * 0.1;
      const x = point.x - direction.y * across + direction.x * along;
      const y = point.y + direction.x * across + direction.y * along;
      addRotatedRect(
        ctx,
        x,
        y,
        env.size * (0.025 + env.random() * 0.065),
        env.size * (0.01 + env.random() * 0.025),
        direction.angle + (env.random() * 2 - 1) * 0.55
      );
    }
  }
  ctx.fillStyle = env.color;
  ctx.globalAlpha = env.alpha * (0.2 + env.grain * 0.22);
  ctx.fill();
}

function renderMarker(ctx, points, env) {
  drawPerfectStroke(
    ctx,
    points,
    perfectOptions(env.size * 1.55, env.settings, env.complete, {
      thinning: 0.06 * env.pressureAmount,
      smoothing: 0.82,
      streamline: 0.28 + env.smooth * 0.48,
      startCap: false,
      endCap: false
    }),
    env.color,
    env.alpha * 0.48
  );
  ctx.beginPath();
  traceCenterline(ctx, points);
  ctx.strokeStyle = env.color;
  ctx.lineWidth = env.size * 0.72;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = env.alpha * 0.16;
  ctx.stroke();
}

function renderGraphite(ctx, points, env) {
  const averageTilt = points.reduce((sum, point) => sum + tiltAmount(point), 0) / Math.max(1, points.length);
  drawPerfectStroke(
    ctx,
    points,
    perfectOptions(env.size * (0.48 + averageTilt * 0.75), env.settings, env.complete, {
      thinning: 0.72 * env.pressureAmount,
      smoothing: 0.64,
      streamline: 0.16 + env.smooth * 0.5
    }),
    env.color,
    env.alpha * 0.3
  );
  const dabs = resampleByDistance(points, env.size * 0.1 * env.spacing, MAX_TEXTURE_DABS);
  ctx.beginPath();
  for (let index = 0; index < dabs.length; index += 1) {
    const point = dabs[index];
    const direction = directionAt(dabs, index);
    const tilt = tiltAmount(point);
    const angle = tiltAngle(point, direction.angle);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const hairs = 2 + Math.round(env.grain * 5 + tilt * 3);
    for (let hair = 0; hair < hairs; hair += 1) {
      const radius = env.size * (0.16 + tilt * 0.52) * point.pressure;
      const offsetAngle = env.random() * TAU;
      const offsetRadius = Math.sqrt(env.random()) * radius;
      const x = point.x + Math.cos(offsetAngle) * offsetRadius;
      const y = point.y + Math.sin(offsetAngle) * offsetRadius;
      const length = env.size * (0.035 + env.random() * (0.1 + tilt * 0.28));
      ctx.moveTo(x - dirX * length, y - dirY * length);
      ctx.lineTo(x + dirX * length, y + dirY * length);
    }
  }
  ctx.strokeStyle = env.color;
  ctx.lineWidth = Math.max(0.12, env.size * 0.022);
  ctx.lineCap = 'round';
  ctx.globalAlpha = env.alpha * (0.11 + env.grain * 0.13);
  ctx.stroke();
}

function renderWatercolor(ctx, points, env) {
  const layers = [
    { scale: 1.75, alpha: 0.1, thinning: 0.22 },
    { scale: 1.3, alpha: 0.16, thinning: 0.42 },
    { scale: 0.84, alpha: 0.13, thinning: 0.58 }
  ];
  for (const layer of layers) {
    drawPerfectStroke(
      ctx,
      points,
      perfectOptions(env.size * layer.scale, env.settings, env.complete, {
        thinning: layer.thinning * env.pressureAmount,
        smoothing: 0.9,
        streamline: 0.42 + env.smooth * 0.42
      }),
      env.color,
      env.alpha * layer.alpha
    );
  }

  const blooms = resampleByDistance(points, env.size * 0.58 * env.spacing, 1200);
  ctx.beginPath();
  for (const point of blooms) {
    const angle = env.random() * TAU;
    const offset = env.size * env.jitter * env.random() * 0.35;
    const radius = env.size * (0.2 + env.random() * 0.48) * (0.65 + point.pressure * 0.5);
    const x = point.x + Math.cos(angle) * offset;
    const y = point.y + Math.sin(angle) * offset;
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, TAU);
  }
  ctx.fillStyle = env.color;
  ctx.globalAlpha = env.alpha * 0.035;
  ctx.fill();

  ctx.beginPath();
  traceCenterline(ctx, points);
  ctx.strokeStyle = env.color;
  ctx.lineWidth = env.size * 1.65;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = env.alpha * 0.055;
  ctx.stroke();
}

export {
  renderCalligraphy,
  renderCrayon,
  renderGraphite,
  renderInk,
  renderMarker,
  renderOil,
  renderPen,
  renderSpray,
  renderWatercolor
};
