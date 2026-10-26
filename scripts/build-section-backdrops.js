'use strict';

// Builds the texture tiles for the section (画框) backdrops in frontend/styles/section-backdrops.css.
//
// Each tile is a seamless RGBA overlay: one ink colour whose alpha comes from periodic Perlin noise,
// laid over the backdrop's CSS colour. Every noise octave uses a whole number of lattice cells across
// the tile, so the tiles wrap without a seam. They are baked bitmaps rather than SVG filters so the
// browser decodes each once and mipmaps it: zooming neither re-runs a filter at every scale nor makes
// fine grain shimmer. The tiles are drawn at half their pixel size (2x for sharp high-DPI screens).
//
// Usage: npm run build:section-backdrops

const path = require('node:path');
const sharp = require('sharp');
const { publishBuildOutputs } = require('./build-output');

const OUT_DIR = path.join(__dirname, '..', 'public', 'section-backdrops');

function createNoise(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const perm = Array.from({ length: 256 }, (_, index) => index);
  for (let index = 255; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [perm[index], perm[swap]] = [perm[swap], perm[index]];
  }
  const angles = Array.from({ length: 256 }, () => random() * Math.PI * 2);
  const gradient = (ix, iy) => angles[perm[(perm[ix & 255] + iy) & 255]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  // Gradient noise on a lattice that wraps every `px` x `py` cells; roughly in [-0.7, 0.7].
  return function noise(x, y, px, py) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const corner = (cx, cy) => {
      const angle = gradient(((x0 + cx) % px + px) % px, ((y0 + cy) % py + py) % py);
      return Math.cos(angle) * (fx - cx) + Math.sin(angle) * (fy - cy);
    };
    const u = fade(fx), v = fade(fy);
    const top = corner(0, 0) + u * (corner(1, 0) - corner(0, 0));
    const bottom = corner(0, 1) + u * (corner(1, 1) - corner(0, 1));
    return top + v * (bottom - top);
  };
}

// Fractal noise over the unit tile (u, v in [0, 1)), `cells` lattice cells across at the base octave.
function fbm(noise, u, v, cellsX, cellsY, octaves) {
  let sum = 0, amplitude = 1, total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const px = cellsX << octave, py = cellsY << octave;
    sum += amplitude * noise(u * px, v * py, px, py);
    total += amplitude;
    amplitude *= 0.5;
  }
  return sum / total;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Fine, soft grain (features of ~4 image px): breaks gradient banding and gives glass and paper a
// material feel without per-pixel noise that would sparkle when scaled.
function grain(u, v, n) {
  const value = fbm(n.a, u, v, 64, 64, 2);
  return clamp01(0.025 + value * 0.09);
}

// Rice paper: cloudy pulp with long, sparse fibres.
function xuan(u, v, n) {
  const cloud = fbm(n.a, u, v, 4, 6, 4);
  const fibre = Math.abs(fbm(n.b, u, v, 3, 48, 3));
  const fibres = 1 - smoothstep(0.0, 0.035, fibre);
  return clamp01(smoothstep(-0.05, 0.45, cloud) * 0.09 + fibres * 0.07 + grain(u, v, n) * 0.4);
}

// Linen: horizontal and vertical threads with slubs (thicker stretches) along them.
function linen(u, v, n) {
  const weft = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 96 + fbm(n.a, u, v, 6, 6, 2) * 3);
  const warp = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 96 + fbm(n.b, u, v, 6, 6, 2) * 3);
  const slubX = smoothstep(0.1, 0.5, fbm(n.c, u, v, 2, 48, 2));
  const slubY = smoothstep(0.1, 0.5, fbm(n.c, v, u, 2, 48, 2));
  return clamp01(weft * 0.05 + warp * 0.05 + slubX * 0.05 + slubY * 0.05 + grain(u, v, n) * 0.3);
}

// Marble: one main vein per tile, a dark core in a soft halo that strengthens and fades along its
// length, over a network of faint hairline veins and soft clouding. The main vein is |sin| of half a
// period across the tile diagonal, bent by turbulence: shifting a whole tile adds π, which |sin|
// ignores, so it tiles. The hairlines follow the zero contour of fractal noise (ridged noise).
function marble(u, v, n) {
  const distance = Math.abs(Math.sin(Math.PI * (u + v) + fbm(n.a, u, v, 2, 2, 4) * 2.6));
  const strength = smoothstep(-0.35, 0.3, fbm(n.c, u, v, 2, 2, 3));
  const core = 1 - smoothstep(0.0, 0.035, distance);
  const halo = 1 - smoothstep(0.0, 0.2, distance);
  const hairline = 1 - smoothstep(0.0, 0.012, Math.abs(fbm(n.b, u, v, 4, 4, 3)));
  const hairStrength = smoothstep(-0.1, 0.45, fbm(n.c, v, u, 3, 3, 2));
  const cloud = smoothstep(-0.15, 0.5, fbm(n.a, v, u, 3, 3, 4)) * 0.05;
  return clamp01(
    (core * 0.34 + halo * 0.07) * strength + hairline * 0.11 * hairStrength + cloud + grain(u, v, n) * 0.25
  );
}

const TEXTURES = [
  { name: 'grain', size: 256, ink: [72, 60, 44], alpha: grain, seed: 11 },
  { name: 'xuan', size: 512, ink: [150, 118, 72], alpha: xuan, seed: 4 },
  { name: 'linen', size: 384, ink: [104, 86, 60], alpha: linen, seed: 7 },
  { name: 'marble', size: 1024, ink: [98, 104, 116], alpha: marble, seed: 5 }
];

async function renderTexture({ size, ink, alpha, seed }) {
  const n = { a: createNoise(seed), b: createNoise(seed * 31 + 7), c: createNoise(seed * 97 + 13) };
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      pixels[offset] = ink[0];
      pixels[offset + 1] = ink[1];
      pixels[offset + 2] = ink[2];
      pixels[offset + 3] = Math.round(alpha(x / size, y / size, n) * 255);
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .webp({ quality: 86, alphaQuality: 90, effort: 6 })
    .toBuffer();
}

async function build() {
  const outputs = [];
  for (const texture of TEXTURES) {
    outputs.push({ path: path.join(OUT_DIR, `${texture.name}.webp`), contents: await renderTexture(texture) });
  }
  await publishBuildOutputs(outputs);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
