'use strict';

// Builds the eucalyptus, lavender and cherry blossom text box frames from public-domain botanical plates
// (sources and credits: public/text-borders/README.md).
//
// 1. Cut-out: each sprig is lifted from its plate along its own axis (base point, tip point, width), and
//    only the pieces the axis runs through are kept, so neighbouring leaves stay behind whole. The paper
//    is keyed out by perceptual (Lab) distance from the plate's most common colour, and edge pixels have
//    the paper colour un-mixed so no cream halo remains. The white cherries on the cherry plate are nearly
//    paper-coloured, so that frame is built from its pink double blossom and the twigs of two others.
// 2. Edges: sprigs are laid as an overlapping garland on a 1440 x 144 strip whose centre line meets the
//    corners' arms. Sprigs crossing the strip's ends are drawn at both ends, so it repeats without a seam
//    at natural size (28px tall on screen; never stretched).
// 3. Corners: a dense cluster on an L of arms 64px in from the outer edges, ending inside the image so the
//    edge strips tuck under foliage rather than a cut. The other corners are the top-left one rotated, so
//    the paintings are never mirrored.
//
// Usage: npm run build:text-border-plates

const path = require('node:path');
const sharp = require('sharp');
const { publishBuildOutputs } = require('./build-output');

const BORDER_DIR = path.join(__dirname, '..', 'public', 'text-borders');
const SOURCE_DIR = path.join(__dirname, '..', 'frontend', 'text-border-sources');
const STRIP_LENGTH = 1440;
const STRIP = 144; // 28px on screen
const CORNER = 256; // 56px on screen
const ARM = 64; // arm line, matching the strip's centre line once scaled
const CORNER_SCALE = 28 / 144 / (56 / 256); // corner px per strip px, so sprigs match on screen
const SUPERSAMPLE = 2.5; // cut-outs are kept this much larger than drawn, for crisp downscaling

// Sprigs are measured on 900px-tall previews of each plate: [base x, y], [tip x, y], half width.
const THEMES = [
  {
    label: 'eucalyptus',
    source: 'eucalyptus-maculata-minchen-1897.jpg',
    previewHeight: 900,
    key: [6, 16],
    seed: 5,
    length: [118, 150], // sprig length on the strip, in strip px
    step: [0.38, 0.5],
    sprigs: {
      leafLeft: [[168, 348], [88, 822], 50],
      leafMiddle: [[352, 402], [338, 826], 46],
      leafRight: [[382, 392], [596, 606], 40],
      flowers: [[330, 382], [440, 200], 110],
      flowersLeft: [[196, 300], [86, 214], 70],
      buds: [[440, 232], [562, 62], 60],
      capsules: [[445, 778], [520, 500], 80]
    },
    order: ['leafMiddle', 'flowers', 'leafRight', 'buds', 'leafLeft', 'flowersLeft', 'capsules'],
    // Sprig length relative to its siblings: flower heads are drawn shorter than long leaves.
    weight: { flowers: 0.72, flowersLeft: 0.62, buds: 0.66, capsules: 0.62 }
  },
  {
    label: 'lavender',
    source: 'lavandula-koehler-1887-plate-60.jpg',
    previewHeight: 900,
    key: [7, 18],
    seed: 9,
    length: [120, 150],
    step: [0.3, 0.4],
    sprigs: {
      spikeOne: [[246, 470], [238, 24], 26],
      spikeTwo: [[321, 250], [321, 30], 22],
      spikeThree: [[404, 420], [418, 40], 40],
      spikeFour: [[468, 330], [522, 48], 30]
    },
    order: ['spikeThree', 'spikeOne', 'spikeFour', 'spikeTwo'],
    weight: { spikeTwo: 0.8 }
  },
  {
    label: 'sakura',
    source: 'prunus-ishizaki-naturalis-rmnh-art-362.jpg',
    previewHeight: 900,
    key: [5, 13],
    seed: 13,
    length: [104, 128],
    step: [0.46, 0.58],
    sprigs: {
      peach: [[432, 802], [548, 688], 70],
      mountain: [[130, 796], [238, 690], 62],
      higan: [[236, 512], [122, 398], 58],
    },
    order: ['peach', 'mountain', 'peach', 'higan'],
    weight: {}
  }
];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rand, low, high) => low + rand() * (high - low);

function toLab(r, g, b) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// The plate's paper: its most common colour, as Lab and as the average RGB of those pixels.
async function paperOf(file) {
  const { data, info } = await sharp(file).resize({ height: 600 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map();
  for (let i = 0; i < info.width * info.height; i++) {
    const [L, A, B] = toLab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    const key = `${Math.round(L / 2)},${Math.round(A / 2)},${Math.round(B / 2)}`;
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bin.count++; bin.r += data[i * 3]; bin.g += data[i * 3 + 1]; bin.b += data[i * 3 + 2];
    bins.set(key, bin);
  }
  const [key, bin] = [...bins.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  return { lab: key.split(',').map((v) => Number(v) * 2), rgb: [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count] };
}

// Lifts one sprig from the plate: an oriented band from base to tip, keyed and decontaminated.
async function cutSprig(file, meta, theme, paper, [base, tip, halfWidth]) {
  const scale = meta.height / theme.previewHeight;
  const b = base.map((v) => v * scale);
  const t = tip.map((v) => v * scale);
  const w = halfWidth * 1.3 * scale; // generous: only the piece on the axis is kept (keepAxisPiece)
  const pad = w + 8 * scale;
  const left = Math.max(0, Math.floor(Math.min(b[0], t[0]) - pad));
  const top = Math.max(0, Math.floor(Math.min(b[1], t[1]) - pad));
  const right = Math.min(meta.width, Math.ceil(Math.max(b[0], t[0]) + pad));
  const bottom = Math.min(meta.height, Math.ceil(Math.max(b[1], t[1]) + pad));
  const width = right - left;
  const height = bottom - top;
  const { data } = await sharp(file).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const axis = [t[0] - b[0], t[1] - b[1]];
  const axisLength = Math.hypot(...axis);
  const unit = [axis[0] / axisLength, axis[1] / axisLength];
  const [lo, hi] = theme.key;
  const alpha = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // Inside the band: along the axis (with a little room past base and tip) and within the width,
      // with a soft fall-off at its long sides.
      const px = x + left - b[0];
      const py = y + top - b[1];
      const along = px * unit[0] + py * unit[1];
      const across = Math.abs(-px * unit[1] + py * unit[0]);
      if (along < -6 * scale || along > axisLength + 6 * scale || across > w) continue;
      const band = Math.min(1, (w - across) / (6 * scale));
      const [L, A, B] = toLab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
      const distance = Math.hypot(L - paper.lab[0], A - paper.lab[1], B - paper.lab[2]);
      alpha[i] = Math.max(0, Math.min(1, (distance - lo) / (hi - lo))) * band;
    }
  }
  keepAxisPiece(alpha, width, height, [b[0] - left, b[1] - top], unit, axisLength, 4 * scale);

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i];
    for (let c = 0; c < 3; c++) {
      // Un-mix the paper from partly transparent edge pixels.
      const value = a > 0.02 ? (data[i * 3 + c] - (1 - a) * paper.rgb[c]) / a : data[i * 3 + c];
      rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round(value)));
    }
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  // Keep the cut-out only as large as it is drawn (times SUPERSAMPLE), then hand back base and tip.
  const targetLength = theme.length[1] * SUPERSAMPLE;
  const shrink = Math.min(1, targetLength / axisLength);
  const outWidth = Math.max(1, Math.round(width * shrink));
  const outHeight = Math.max(1, Math.round(height * shrink));
  const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).resize(outWidth, outHeight).png().toBuffer();
  return {
    png,
    width: outWidth,
    height: outHeight,
    base: [(b[0] - left) * shrink, (b[1] - top) * shrink],
    angle: (Math.atan2(axis[1], axis[0]) * 180) / Math.PI,
    length: axisLength * shrink
  };
}

// The band also catches bits of neighbouring leaves and flowers. Keep only the connected pieces that lie
// on the sprig's own axis (plus their soft edge pixels), so nothing arrives cut along a straight line.
function keepAxisPiece(alpha, width, height, base, unit, length, reach) {
  const label = new Int32Array(width * height).fill(-1);
  const kept = new Set();
  let next = 0;
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== -1 || alpha[start] <= 0.3) continue;
    const stack = [start];
    label[start] = next;
    while (stack.length) {
      const i = stack.pop();
      const x = i % width, y = (i / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (label[j] === -1 && alpha[j] > 0.3) { label[j] = next; stack.push(j); }
        }
      }
    }
    next++;
  }
  // Sample the axis (skipping the very tip, where a neighbour may touch) and keep what it passes through.
  for (let along = 0; along <= length * 0.92; along += 1) {
    const cx = base[0] + unit[0] * along, cy = base[1] + unit[1] * along;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const l = label[y * width + x];
        if (l >= 0) kept.add(l);
      }
    }
  }
  // Soft edge pixels survive only next to a kept piece.
  const near = new Uint8Array(width * height);
  for (let i = 0; i < label.length; i++) {
    if (!kept.has(label[i])) continue;
    const x = i % width, y = (i / width) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) near[ny * width + nx] = 1;
      }
    }
  }
  for (let i = 0; i < alpha.length; i++) {
    if (label[i] >= 0 ? !kept.has(label[i]) : !near[i]) alpha[i] = 0;
  }
}

// Sprigs are scaled and turned one by one with sharp, then laid onto one canvas in order.
async function placedLayer(sprig, x, y, direction, length) {
  const scale = length / sprig.length;
  const width = Math.max(1, Math.round(sprig.width * scale));
  const height = Math.max(1, Math.round(sprig.height * scale));
  const sized = await sharp(sprig.png).resize(width, height).png().toBuffer();
  const turn = direction - sprig.angle;
  const { data, info } = await sharp(sized)
    .rotate(turn, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const radians = (turn * Math.PI) / 180;
  const px = sprig.base[0] * scale - width / 2;
  const py = sprig.base[1] * scale - height / 2;
  const bx = px * Math.cos(radians) - py * Math.sin(radians) + info.width / 2;
  const by = px * Math.sin(radians) + py * Math.cos(radians) + info.height / 2;
  return { input: data, left: Math.round(x - bx), top: Math.round(y - by) };
}

// Lays the sprigs (with a margin so none is cut at the canvas edge), adds a soft drop shadow, then keeps
// the window [left, top, width, height] of it.
async function compose(canvasWidth, canvasHeight, layers, window) {
  const margin = 400;
  const shifted = layers.map((layer) => ({ ...layer, left: layer.left + margin, top: layer.top + margin }));
  const fullWidth = canvasWidth + margin * 2;
  const fullHeight = canvasHeight + margin * 2;
  const art = await sharp({ create: { width: fullWidth, height: fullHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(shifted)
    .raw()
    .toBuffer();
  const blurred = await sharp(art, { raw: { width: fullWidth, height: fullHeight, channels: 4 } }).extractChannel(3).blur(1.6).raw().toBuffer();
  const [dx, dy] = [1, 2];
  const out = Buffer.alloc(fullWidth * fullHeight * 4);
  for (let y = 0; y < fullHeight; y++) {
    for (let x = 0; x < fullWidth; x++) {
      const i = y * fullWidth + x;
      const sx = x - dx, sy = y - dy;
      const shade = sx >= 0 && sy >= 0 ? (blurred[sy * fullWidth + sx] / 255) * 0.3 : 0;
      const a = art[i * 4 + 3] / 255;
      const total = a + shade * (1 - a);
      for (let c = 0; c < 3; c++) out[i * 4 + c] = total > 0 ? Math.round((art[i * 4 + c] * a) / total) : 0;
      out[i * 4 + 3] = Math.round(total * 255);
    }
  }
  return sharp(out, { raw: { width: fullWidth, height: fullHeight, channels: 4 } }).extract({
    left: window[0] + margin,
    top: window[1] + margin,
    width: window[2],
    height: window[3]
  });
}

// Garland along x: alternate up/down tilts, overlapping. It is laid three times end to end and the
// middle copy kept, so sprigs (and their shadows) crossing either end continue on the other side.
async function strip(theme, sprigs, seed) {
  const rand = random(seed);
  const centre = STRIP / 2;
  const plan = [];
  let side = -1;
  for (let x = 0, index = 0; x < STRIP_LENGTH; index++) {
    const name = theme.order[index % theme.order.length];
    const length = between(rand, ...theme.length) * (theme.weight[name] || 1);
    // Keep the whole sprig inside the strip: its sideways reach plus half its width must stay < 66px.
    const [base, tip, half] = theme.sprigs[name];
    const halfWidth = (half / Math.hypot(base[0] - tip[0], base[1] - tip[1])) * length;
    const room = Math.max(0, 64 - halfWidth - 2);
    const tilt = Math.min(between(rand, 10, 22), (Math.asin(Math.min(1, room / length)) * 180) / Math.PI);
    plan.push({ name, x, y: centre + between(rand, -3, 3), direction: side * tilt, length });
    x += length * between(rand, ...theme.step);
    side = -side;
  }
  const layers = [];
  for (const shift of [0, STRIP_LENGTH, STRIP_LENGTH * 2]) {
    for (const step of plan) layers.push(await placedLayer(sprigs[step.name], step.x + shift, step.y, step.direction, step.length));
  }
  return compose(STRIP_LENGTH * 3, STRIP, layers, [STRIP_LENGTH, 0, STRIP_LENGTH, STRIP]);
}

// Top-left corner: sprigs run along both arms from near the bend (tips toward the arm ends, ending
// inside the image) and a fuller cluster on the bend reaches out of the frame's corner.
async function corner(theme, sprigs) {
  const rand = random(theme.seed * 31);
  const names = theme.order;
  const lengthOf = (name, k = 1) => between(rand, ...theme.length) * (theme.weight[name] || 1) * CORNER_SCALE * k;
  const layers = [];
  for (let i = 0; i < 4; i++) {
    const name = names[(i + 1) % names.length];
    layers.push(await placedLayer(sprigs[name], ARM + 4, ARM + 4, 225 + between(rand, -36, 36), lengthOf(name, 0.55)));
  }
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    let at = ARM * 0.6;
    let side = -1;
    for (let i = 0; i < 8; i++) {
      const name = names[(i + (dy ? 2 : 0)) % names.length];
      let length = lengthOf(name);
      const end = CORNER - 10;
      if (at + length > end) length = end - at;
      if (length < 34) break;
      const tilt = side * between(rand, 5, 12);
      const x = dx ? at : ARM + between(rand, -2, 2);
      const y = dy ? at : ARM + between(rand, -2, 2);
      layers.push(await placedLayer(sprigs[name], x, y, (dx ? 0 : 90) + tilt, length));
      at += length * between(rand, ...theme.step);
      side = -side;
    }
  }
  return (await compose(CORNER, CORNER, layers, [0, 0, CORNER, CORNER])).png().toBuffer();
}

const webp = (image) => image.webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer({ resolveWithObject: true });

async function build() {
  const outputs = [];
  for (const theme of THEMES) {
    const file = path.join(SOURCE_DIR, theme.source);
    const meta = await sharp(file).metadata();
    const paper = await paperOf(file);
    const sprigs = {};
    for (const [name, spec] of Object.entries(theme.sprigs)) sprigs[name] = await cutSprig(file, meta, theme, paper, spec);
    const across = await (await strip(theme, sprigs, theme.seed)).png().toBuffer();
    const down = await (await strip(theme, sprigs, theme.seed + 100)).png().toBuffer();
    const topLeft = await corner(theme, sprigs);
    // Other corners are the top-left turned, so the painting is never mirrored.
    const files = [
      [`${theme.label}-uniform.webp`, await webp(sharp(across))],
      [`${theme.label}-vertical-uniform.webp`, await webp(sharp(down).rotate(90))],
      [`${theme.label}-corner-tl.webp`, await webp(sharp(topLeft))],
      [`${theme.label}-corner-tr.webp`, await webp(sharp(topLeft).rotate(90))],
      [`${theme.label}-corner-br.webp`, await webp(sharp(topLeft).rotate(180))],
      [`${theme.label}-corner-bl.webp`, await webp(sharp(topLeft).rotate(270))]
    ];
    for (const [name, { data, info }] of files) {
      outputs.push({ path: path.join(BORDER_DIR, name), contents: data });
      console.log(`${name}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)} KiB`);
    }
  }
  await publishBuildOutputs(outputs);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
