'use strict';

// Builds the realistic section (画框) frames from CC0 ambientCG textures
// (sources and credits: public/section-frames/README.md).
//
// Each frame is a square nine-slice ring drawn at 2x its on-screen border width. The moulding is lit
// from a height profile across its width: every pixel belongs to the outer edge it is nearest to, so
// the four sides meet in 45° mitres, like a real frame. Grain runs along each
// side (the vertical sides sample the texture transposed). Along an edge everything repeats every
// 1024px — the textures are seamless at that size and carved beads and wear noise use whole periods —
// so `border-image-repeat: round` tiles the edges without a visible cut.
//
// Usage: npm run build:section-frames

const path = require('node:path');
const sharp = require('sharp');
const { publishBuildOutputs } = require('./build-output');

const OUT_DIR = path.join(__dirname, '..', 'public', 'section-frames');
const SOURCE_DIR = path.join(__dirname, '..', 'frontend', 'section-frame-sources');
const UNDERLAY_CSS = path.join(__dirname, '..', 'frontend', 'styles', 'section-frame-underlays.css');
const PERIOD = 1024; // edge repeat in image px (512 CSS px)
const LIGHT = normalize([-0.55, -0.75, 1.1]);
const HALF = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

// border: on-screen width in CSS px (the image slice is twice that).
// relief: slope multiplier, keeps each profile's apparent depth independent of its width.
const FRAMES = [
  { name: 'walnut', border: 36, profile: 'cove', texture: { file: 'wood051', contrast: 1.1 }, relief: 1.0, spec: 0.2, shine: 36, ambient: 0.46 },
  { name: 'oak', border: 28, profile: 'slab', texture: { file: 'wood049' }, relief: 0.69, spec: 0.06, shine: 30, ambient: 0.62 },
  {
    name: 'gold', border: 46, profile: 'ornate', relief: 0.53, spec: 0.2, shine: 12, ambient: 0.4, carved: true,
    texture: { file: 'metal048c', tint: [0.92, 0.78, 0.52], contrast: 1.2 }
  },
  {
    name: 'gallery', border: 18, profile: 'gallery', relief: 1.6, spec: 0.3, shine: 24, ambient: 0.55,
    texture: { file: 'paintedwood008c', contrast: 0.45, gamma: 1.8, tint: [0.4, 0.4, 0.42] }
  },
  {
    name: 'vintage', border: 42, profile: 'scoop', relief: 0.45, spec: 0.05, shine: 30, ambient: 0.6,
    texture: { file: 'paintedwood009c', contrast: 0.7, gamma: 0.55, tint: [1.04, 1, 0.92] },
    wear: { file: 'wood049', gamma: 0.75, tint: [1.06, 0.96, 0.82] }
  }
];

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

async function loadTexture({ file, contrast = 1, gamma = 1, tint = [1, 1, 1] }) {
  const { data, info } = await sharp(path.join(SOURCE_DIR, `ambientcg-${file}-color.jpg`))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== PERIOD || info.height !== PERIOD) throw new Error(`${file} must be ${PERIOD}x${PERIOD}`);
  const pixels = new Float32Array(data.length);
  const mean = [0, 0, 0];
  for (let index = 0; index < data.length; index++) {
    pixels[index] = data[index] / 255;
    mean[index % 3] += pixels[index];
  }
  for (let channel = 0; channel < 3; channel++) mean[channel] /= PERIOD * PERIOD;
  for (let index = 0; index < pixels.length; index++) {
    const channel = index % 3;
    let value = Math.min(1, Math.max(0, (pixels[index] - mean[channel]) * contrast + mean[channel]));
    value = value ** gamma * tint[channel];
    pixels[index] = Math.min(1, Math.max(0, value));
  }
  return pixels;
}

function sampleTexture(texture, u, v, out) {
  const x = ((Math.floor(u) % PERIOD) + PERIOD) % PERIOD;
  const y = ((Math.floor(v) % PERIOD) + PERIOD) % PERIOD;
  const index = (y * PERIOD + x) * 3;
  out[0] = texture[index];
  out[1] = texture[index + 1];
  out[2] = texture[index + 2];
}

// Moulding height across its width, t = 0 at the outer edge and 1 at the sight edge.
function profileHeight(kind, t) {
  const sinPi = (value) => Math.sin(Math.min(1, Math.max(0, value)) * Math.PI);
  const sinHalf = (value) => Math.sin(Math.min(1, Math.max(0, value)) * Math.PI / 2);
  switch (kind) {
    case 'cove': // outer roundover, hollow, inner bead
      return 0.55 * sinHalf(t / 0.25) - (t > 0.25 ? 0.35 * Math.max(0, Math.sin((t - 0.25) / 0.55 * Math.PI)) : 0) +
        (t > 0.8 ? 0.25 * sinPi((t - 0.8) / 0.2) : 0);
    case 'slab': // flat face with a soft outer arris
      return 0.3 * sinHalf(t / 0.12) - 0.12 * Math.min(1, Math.max(0, (t - 0.88) / 0.12));
    case 'ornate': // bead, deep cove, raised flat, sight-edge bead
      if (t < 0.16) return 0.45 * sinPi(t / 0.16);
      if (t < 0.52) return -0.5 * sinPi((t - 0.16) / 0.36);
      if (t < 0.8) return 0.35 * sinHalf((t - 0.52) / 0.28);
      return 0.35 - 0.15 * (t - 0.8) / 0.2 + 0.2 * sinPi((t - 0.8) / 0.2);
    case 'gallery': // thin box frame with crisp edges
      return 0.25 * Math.min(1, t / 0.08) - 0.25 * Math.min(1, Math.max(0, (t - 0.92) / 0.08));
    case 'scoop': // wide reverse scoop rising to the outer edge
      return 0.6 * (1 - t) ** 1.6 + 0.12 * sinPi((t - 0.85) / 0.15);
    default:
      throw new Error(`Unknown profile ${kind}`);
  }
}

// Smooth value noise that repeats every PERIOD px along the edge.
function periodicNoise(along, depth, side) {
  const cells = 170;
  const cell = PERIOD / cells;
  const gx = along / cell;
  const gy = depth / 6;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const hash = (x, y) => {
    let h = (((x % cells) + cells) % cells) * 374761393 + y * 668265263 + side * 2246822519;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (value) => value * value * (3 - 2 * value);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * smooth(fx);
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * smooth(fx);
  return top + (bottom - top) * smooth(fy);
}

async function renderFrame(frame) {
  const slice = frame.border * 2;
  const size = PERIOD + slice * 2;
  const texture = await loadTexture(frame.texture);
  const wearTexture = frame.wear ? await loadTexture(frame.wear) : null;
  const heights = new Float32Array(slice);
  for (let d = 0; d < slice; d++) heights[d] = profileHeight(frame.profile, d / (slice - 1));
  const slopes = new Float32Array(slice);
  for (let d = 0; d < slice; d++) {
    const before = heights[Math.max(0, d - 1)];
    const after = heights[Math.min(slice - 1, d + 1)];
    slopes[d] = ((after - before) / ((Math.min(slice - 1, d + 1) - Math.max(0, d - 1)) / (slice - 1))) * frame.relief;
  }
  const inward = [[0, 1], [0, -1], [1, 0], [-1, 0]]; // top, bottom, left, right
  const pixels = Buffer.alloc(size * size * 4);
  const color = [0, 0, 0];
  const wood = [0, 0, 0];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distances = [y, size - 1 - y, x, size - 1 - x];
      let side = 0;
      for (let index = 1; index < 4; index++) if (distances[index] < distances[side]) side = index;
      const d = distances[side];
      if (d >= slice) continue;

      const horizontal = side < 2;
      const along = horizontal ? x : y;
      // Distinct phases per side so the four pieces don't show the same figure.
      if (horizontal) sampleTexture(texture, along + side * 173, d + side * 311, color);
      else sampleTexture(texture, PERIOD - 1 - (along + side * 229), d + side * 97, color);

      const slope = slopes[d];
      const [ix, iy] = inward[side];
      let nx = -slope * ix;
      let ny = -slope * iy;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz);
      nx /= length; ny /= length; nz /= length;
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const specular = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** frame.shine * frame.spec;
      const shade = frame.ambient + (1 - frame.ambient) * lambert / LIGHT[2] * 0.85;
      // The mitre shows only where the grain turns; a drawn joint line read as a seam.
      let factor = 1;

      // Crisp arrises: the outer edge and the sight edge catch a thin shadow line.
      if (d < 2) factor *= 0.7;
      else if (d >= slice - 2) factor *= 0.6;

      if (frame.carved) {
        const t = d / slice;
        if (t > 0.02 && t < 0.15) factor *= 1 + 0.16 * Math.sin(2 * Math.PI * 51 * along / PERIOD) * Math.sin(t / 0.15 * Math.PI);
        if (t > 0.55 && t < 0.78) {
          const egg = Math.sin(Math.PI * 46 * along / PERIOD) ** 2 * Math.sin((t - 0.55) / 0.23 * Math.PI);
          factor *= 1 + 0.14 * (egg - 0.5);
        }
      }

      let r = color[0] * shade * factor + specular;
      let g = color[1] * shade * factor + specular;
      let b = color[2] * shade * factor + specular;

      if (wearTexture) {
        // Paint chipped off the outer arris and the sight-edge bead, showing bare wood inside a
        // slightly darker rim where the paint edge is.
        const exposed = d < 7 || (d > slice * 0.86 && d < slice * 0.97);
        const noise = exposed ? periodicNoise(along, d, side) : 0;
        if (noise > 0.75) {
          sampleTexture(wearTexture, along, d, wood);
          const mix = 0.8;
          r = r * (1 - mix) + wood[0] * shade * mix;
          g = g * (1 - mix) + wood[1] * shade * mix;
          b = b * (1 - mix) + wood[2] * shade * mix;
        } else if (noise > 0.72) {
          r *= 0.82; g *= 0.82; b *= 0.82;
        }
      }

      const index = (y * size + x) * 4;
      pixels[index] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      pixels[index + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      pixels[index + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      pixels[index + 3] = 255;
    }
  }
  const result = await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .webp({ quality: 86, alphaQuality: 100, effort: 6 })
    .toBuffer({ resolveWithObject: true });
  return { ...result, underlays: profileGradients(pixels, size, slice) };
}

// The moulding's cross-section with the grain averaged out, as one gradient per side.
// section-frames.css paints these under the border so the hairline gaps browsers leave between
// nine-slice pieces at fractional zoom show the moulding's own colour, not the canvas.
function profileGradients(pixels, size, slice) {
  const stops = 24;
  const sides = [
    ['top', 'to bottom', (along, d) => [along, d]],
    ['bottom', 'to top', (along, d) => [along, size - 1 - d]],
    ['left', 'to right', (along, d) => [d, along]],
    ['right', 'to left', (along, d) => [size - 1 - d, along]]
  ];
  return sides.map(([name, direction, point]) => {
    const colors = [];
    for (let stop = 0; stop < stops; stop++) {
      const sum = [0, 0, 0];
      let count = 0;
      for (let d = Math.floor((stop * slice) / stops); d < Math.floor(((stop + 1) * slice) / stops); d++) {
        for (let along = slice; along < slice + PERIOD; along += 4) {
          const [x, y] = point(along, d);
          const index = (y * size + x) * 4;
          for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[index + channel];
          count++;
        }
      }
      const hex = sum.map((value) => Math.round(value / count).toString(16).padStart(2, '0')).join('');
      colors.push(`#${hex} ${(((stop + 0.5) / stops) * 100).toFixed(1)}%`);
    }
    return `  --frame-under-${name}: linear-gradient(${direction}, ${colors.join(', ')});`;
  });
}

async function build() {
  const outputs = [];
  const underlayRules = [];
  for (const frame of FRAMES) {
    const { data, info, underlays } = await renderFrame(frame);
    outputs.push({ path: path.join(OUT_DIR, `${frame.name}.webp`), contents: data });
    underlayRules.push(`.section-frame[data-frame-style='${frame.name}'] {\n${underlays.join('\n')}\n}\n`);
    console.log(`${frame.name}.webp  ${info.width}x${info.height}  slice ${frame.border * 2}  ${(info.size / 1024).toFixed(1)} KiB`);
  }
  outputs.push({
    path: UNDERLAY_CSS,
    contents: `/* Generated by npm run build:section-frames. Moulding cross-sections painted under each frame. */\n${underlayRules.join('\n')}`
  });
  await publishBuildOutputs(outputs);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
