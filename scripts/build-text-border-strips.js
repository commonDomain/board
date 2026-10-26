'use strict';

// Generates seamless edge strips for the realistic text box frames.
//
// The source strips are not seamless: where one repeat meets the next, leaves, shells and animals are
// sliced by a straight cut, which shows along every frame edge. Two treatments fix that:
// - Horizontal strips become the source followed by its own reflection, so both joins meet
//   mirror-image artwork and continue naturally.
// - Vertical strips can't be reflected (animals would stand upside down), so the script finds two rows
//   far apart whose artwork nearly matches, crops the strip between them and blends a few rows across
//   the join. The repeat then runs on without a visible cut, with every motif still upright.
//
// Usage: npm run build:text-borders

const path = require('node:path');
const sharp = require('sharp');
const { publishBuildOutputs } = require('./build-output');

const BORDER_DIR = path.join(__dirname, '..', 'public', 'text-borders');
const SETS = ['ivy', 'wildflower', 'shells', 'woodland'];
// A vertical repeat spans at least this many source rows, so it still holds several motifs.
const MIN_VERTICAL_REPEAT = 380;
// Source rows blended across the vertical join (about 2px once the strip is drawn 28px wide).
const BLEND_ROWS = 12;

async function mirroredHorizontal(source) {
  const image = sharp(source);
  const { width, height } = await image.metadata();
  const original = await image.png().toBuffer();
  const reflection = await sharp(source).flop().png().toBuffer();
  return sharp({ create: { width: width * 2, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: original, left: 0, top: 0 },
      { input: reflection, left: width, top: 0 }
    ])
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toBuffer({ resolveWithObject: true });
}

// Visual difference between source rows a and b (alpha everywhere, colour where both are painted),
// averaged over a three-row band so a join must match in shape and not just along one line.
function rowDifference(pixels, width, a, b) {
  let sum = 0;
  let count = 0;
  for (let offset = -1; offset <= 1; offset++) {
    for (let x = 0; x < width; x += 2) {
      const p = ((a + offset) * width + x) * 4;
      const q = ((b + offset) * width + x) * 4;
      sum += Math.abs(pixels[p + 3] - pixels[q + 3]);
      if (pixels[p + 3] > 40 && pixels[q + 3] > 40) {
        sum += (Math.abs(pixels[p] - pixels[q]) + Math.abs(pixels[p + 1] - pixels[q + 1]) + Math.abs(pixels[p + 2] - pixels[q + 2])) / 3;
      }
      count++;
    }
  }
  return sum / count;
}

function rowCoverage(pixels, width, y) {
  let painted = 0;
  for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 40) painted++;
  return painted / width;
}

// Best pair of rows to repeat between: matching artwork, preferably where little is painted.
function bestVerticalRepeat(pixels, width, height) {
  let best = null;
  const margin = BLEND_ROWS + 2;
  for (let a = 2; a < height - margin; a += 2) {
    for (let b = a + MIN_VERTICAL_REPEAT; b < height - margin; b += 2) {
      const score = rowDifference(pixels, width, a, b) + 60 * (rowCoverage(pixels, width, a) + rowCoverage(pixels, width, b));
      if (!best || score < best.score) best = { a, b, score };
    }
  }
  return best;
}

async function seamlessVertical(source) {
  const { data: pixels, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const { a, b } = bestVerticalRepeat(pixels, width, height);
  const rows = b - a;
  const tile = Buffer.alloc(rows * width * 4);
  pixels.copy(tile, 0, a * width * 4, b * width * 4);
  // The repeat ends at row b and starts again at row a: ease the first rows from the artwork that
  // naturally follows row b into the artwork at row a, so the join has no edge.
  for (let row = 0; row < BLEND_ROWS; row++) {
    const weight = 1 - (row + 0.5) / BLEND_ROWS;
    for (let x = 0; x < width; x++) {
      const target = (row * width + x) * 4;
      const follow = ((b + row) * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        tile[target + channel] = Math.round(tile[target + channel] * (1 - weight) + pixels[follow + channel] * weight);
      }
    }
  }
  const result = await sharp(tile, { raw: { width, height: rows, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toBuffer({ resolveWithObject: true });
  return { ...result, crop: [a, b] };
}

async function build() {
  const outputs = [];
  for (const set of SETS) {
    const horizontalName = `${set}-uniform-mirrored.webp`;
    const horizontal = await mirroredHorizontal(path.join(BORDER_DIR, `${set}-uniform.webp`));
    outputs.push({ path: path.join(BORDER_DIR, horizontalName), contents: horizontal.data });
    console.log(`${horizontalName}  ${horizontal.info.width}x${horizontal.info.height}  ${(horizontal.info.size / 1024).toFixed(1)} KiB`);

    const verticalName = `${set}-vertical-uniform-seamless.webp`;
    const vertical = await seamlessVertical(path.join(BORDER_DIR, `${set}-vertical-uniform.webp`));
    outputs.push({ path: path.join(BORDER_DIR, verticalName), contents: vertical.data });
    console.log(
      `${verticalName}  ${vertical.info.width}x${vertical.info.height}  rows ${vertical.crop.join('-')}  ${(vertical.info.size / 1024).toFixed(1)} KiB`
    );
  }
  await publishBuildOutputs(outputs);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
