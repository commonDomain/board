'use strict';

// Generates the small WebP previews used by the background menu swatches.
//
// The menu used to point those swatches at the full-resolution sources, so simply
// opening it pulled ~15 MB and decoded six ~20-megapixel bitmaps -- a ~0.4 s main
// thread stall locally and several seconds over a real network. The swatches are
// roughly 110x60 CSS pixels, so a 360px-wide preview is already generous on a
// high-density display.
//
// Usage: npm run build:backgrounds

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const BACKGROUND_DIR = path.join(__dirname, '..', 'public', 'backgrounds');
const PREVIEW_WIDTH = 360;
const PREVIEW_QUALITY = 74;

// Keep in sync with BACKGROUND_IMAGE_PRESETS in public/app.js.
const BACKGROUNDS = [
  'alpine-lake',
  'coastline',
  'sage-watercolor',
  'twilight-sky',
  'botanical-paper',
  'desert-dunes',
  'navy-night',
  'thousand-li',
  'lantingxu',
  'webb-deep-field',
  'great-wave',
  'water-lilies'
];

function previewName(name) {
  return `${name}.preview.webp`;
}

async function build() {
  let total = 0;
  for (const name of BACKGROUNDS) {
    const source = path.join(BACKGROUND_DIR, `${name}.webp`);
    const target = path.join(BACKGROUND_DIR, previewName(name));
    const info = await sharp(source)
      .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY, effort: 5 })
      .toFile(target);
    total += info.size;
    console.log(`${previewName(name)}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)} KiB`);
  }
  console.log(`total ${(total / 1024).toFixed(1)} KiB`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
