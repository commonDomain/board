import { getBackgroundImagePreset, getBackgroundPreset } from './background-model.js';
import { loadBackgroundImage } from './background.js';
import { positiveModulo, xmlSafeHtml, xmlSafeStyleText } from './export-source-model.js';
import { loadImage } from './image-upload-model.js';
import { state } from './state.js';

async function renderExportTileCanvas(source, bounds, dimensions, tile, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = tile.pixelWidth;
  canvas.height = tile.pixelHeight;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const imageBackground = options.backgroundCss ? null : getBackgroundImagePreset();
  if (imageBackground) {
    await drawImageBackgroundToExportTile(context, dimensions, tile, imageBackground);
  }
  const domBackgroundCss = imageBackground ? 'background:transparent;' : options.backgroundCss;

  let paintedBase = false;
  let domItemIds = new Set();
  const flushDomItems = async (force = false) => {
    if (!force && !domItemIds.size) return;
    const domCanvas = await renderExportDomTileCanvas(
      source,
      bounds,
      dimensions,
      tile,
      domItemIds,
      !paintedBase,
      domBackgroundCss
    );
    context.drawImage(domCanvas, 0, 0);
    domItemIds = new Set();
    paintedBase = true;
  };

  for (const paint of source.paintSequence) {
    if (paint.kind === 'dom') {
      domItemIds.add(paint.id);
      continue;
    }
    await flushDomItems(!paintedBase);
    drawOriginalImageToExportTile(context, paint, bounds, dimensions, tile);
  }
  await flushDomItems(!paintedBase);
  if (source.boardClone.querySelector('[data-internal-id]')) {
    const overlayCanvas = await renderExportDomTileCanvas(source, bounds, dimensions, tile, new Set(), false, '', true);
    context.drawImage(overlayCanvas, 0, 0);
  }
  return canvas;
}

async function drawImageBackgroundToExportTile(context, dimensions, tile, preset) {
  context.save();
  context.fillStyle = getBackgroundPreset().color;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  try {
    const image = await loadBackgroundImage(preset);
    // The on-screen background is bottom-anchored, so the exported wallpaper is
    // anchored the same way: it keeps its aspect ratio, fills the exported area
    // and crops the top rather than the bottom.
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const coverScale = Math.max(dimensions.pixelWidth / sourceWidth, dimensions.pixelHeight / sourceHeight);
    const width = sourceWidth * coverScale;
    const height = sourceHeight * coverScale;
    const x = (dimensions.pixelWidth - width) / 2 - tile.pixelX;
    const y = dimensions.pixelHeight - height - tile.pixelY;
    context.drawImage(image, x, y, width, height);
    if (preset.wash) {
      context.fillStyle = preset.wash;
      context.fillRect(x, y, width, height);
    }
  } catch (error) {
    console.warn('Could not render the image background for export.', error);
  } finally {
    context.restore();
  }
}

async function renderExportDomTileCanvas(
  source,
  bounds,
  dimensions,
  tile,
  keepItemIds,
  includeBase,
  backgroundCss = '',
  includeConnections = false
) {
  const tileBoard = source.boardClone.cloneNode(true);
  if (!includeConnections) tileBoard.querySelectorAll('.connection-internal-layer').forEach((node) => node.remove());
  tileBoard.querySelectorAll('.board-item').forEach((node) => {
    if (!keepItemIds.has(node.dataset.itemId)) node.remove();
  });
  if (!includeBase) {
    tileBoard.querySelectorAll('.section-frame').forEach((node) => node.remove());
  }
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    `position:absolute;left:0;top:0;width:${tile.logicalWidth}px;height:${tile.logicalHeight}px;overflow:hidden;`,
    includeBase
      ? backgroundCss || getExportBackgroundCss(bounds, dimensions.padding, tile.logicalX, tile.logicalY)
      : 'background:transparent;'
  ].join('');
  tileBoard.style.transform = 'none';
  tileBoard.style.left = `${dimensions.padding - bounds.x - tile.logicalX}px`;
  tileBoard.style.top = `${dimensions.padding - bounds.y - tile.logicalY}px`;
  wrapper.appendChild(tileBoard);

  const innerHtml = `<style>${xmlSafeStyleText(source.cssText)}</style>${wrapper.outerHTML}`;
  const html = `<div xmlns="http://www.w3.org/1999/xhtml">${innerHtml}</div>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile.pixelWidth}" height="${tile.pixelHeight}" ` +
    `viewBox="0 0 ${tile.logicalWidth} ${tile.logicalHeight}">` +
    `<foreignObject width="${tile.logicalWidth}" height="${tile.logicalHeight}">${xmlSafeHtml(html)}</foreignObject></svg>`;
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = tile.pixelWidth;
  canvas.height = tile.pixelHeight;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, tile.pixelWidth, tile.pixelHeight);
  return canvas;
}

function drawOriginalImageToExportTile(context, paint, bounds, dimensions, tile) {
  const { item, image } = paint;
  const scale = dimensions.outputScale;
  const width = Math.max(1, Number(item.w) * scale);
  const height = Math.max(1, Number(item.h) * scale);
  const centerX = (dimensions.padding - bounds.x - tile.logicalX + Number(item.x) + Number(item.w) / 2) * scale;
  const centerY = (dimensions.padding - bounds.y - tile.logicalY + Number(item.y) + Number(item.h) / 2) * scale;
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const targetRatio = width / height;
  const sourceRatio = naturalWidth / naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = naturalWidth;
  let sourceHeight = naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = naturalHeight * targetRatio;
    sourceX = (naturalWidth - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = naturalWidth / targetRatio;
    sourceY = (naturalHeight - sourceHeight) / 2;
  }

  context.save();
  context.globalAlpha = paint.opacity;
  context.globalCompositeOperation = paint.blendMode === 'normal' ? 'source-over' : paint.blendMode;
  context.translate(centerX, centerY);
  context.rotate(((Number(item.rotation) || 0) * Math.PI) / 180);
  context.beginPath();
  context.roundRect(-width / 2, -height / 2, width, height, Math.min(8 * scale, width / 2, height / 2));
  context.clip();
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, -width / 2, -height / 2, width, height);
  context.restore();
}

function getExportBackgroundCss(bounds, padding, offsetX = 0, offsetY = 0) {
  const position = (sizeX, sizeY = sizeX) =>
    `${positiveModulo(padding - bounds.x - offsetX, sizeX)}px ${positiveModulo(padding - bounds.y - offsetY, sizeY)}px`;
  if (getBackgroundImagePreset()) {
    return `background:${getBackgroundPreset().color};`;
  }
  switch (state.background) {
    case 'blank':
      return 'background:#ffffff;';
    case 'grid':
      return `background:#ffffff;background-image:linear-gradient(#dfe4ea 1px,transparent 1px),linear-gradient(90deg,#dfe4ea 1px,transparent 1px);background-size:18px 18px;background-position:${position(18)};`;
    case 'lines':
      return `background:#ffffff;background-image:repeating-linear-gradient(0deg,#dfe4ea 0 1px,transparent 1px 36px);background-size:100% 36px;background-position:0 ${positiveModulo(padding - bounds.y - offsetY, 36)}px;`;
    case 'dark':
      return `background:#1e232e;background-image:radial-gradient(circle,rgba(255,255,255,0.14) 1px,transparent 1.3px);background-size:18px 18px;background-position:${position(18)};`;
    case 'warm':
      return `background:#faf2e5;background-image:radial-gradient(circle,rgba(137,104,67,.2) 1px,transparent 1.2px);background-size:22px 22px;background-position:${position(22)};`;
    case 'blueprint':
      return `background:#183d65;background-image:linear-gradient(rgba(255,255,255,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.13) 1px,transparent 1px);background-size:20px 20px;background-position:${position(20)};`;
    case 'isometric':
      return `background:#fbfcfe;background-image:linear-gradient(30deg,rgba(102,112,132,.18) 1px,transparent 1px),linear-gradient(150deg,rgba(102,112,132,.18) 1px,transparent 1px);background-size:18px 10px;background-position:${position(18, 10)};`;
    case 'paper':
      return `background:#f8f6f0;background-image:radial-gradient(circle at 20% 30%,rgba(84,67,43,.05) 0 1px,transparent 1.2px),radial-gradient(circle at 75% 65%,rgba(84,67,43,.04) 0 1px,transparent 1.3px);background-size:13px 17px,19px 23px;background-position:${position(13, 17)},${position(19, 23)};`;
    case 'cross':
      return `background:#fbfcfe;background-image:radial-gradient(ellipse 4px .7px at center,rgba(93,105,128,.22) 98%,transparent),radial-gradient(ellipse .7px 4px at center,rgba(93,105,128,.22) 98%,transparent);background-size:24px 24px;background-position:${position(24)};`;
    case 'graph':
      return `background:#f8fbff;background-image:linear-gradient(rgba(96,145,184,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(96,145,184,.12) 1px,transparent 1px),linear-gradient(rgba(65,118,161,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(65,118,161,.22) 1px,transparent 1px);background-size:16px 16px,16px 16px,80px 80px,80px 80px;background-position:${position(16)},${position(16)},${position(80)},${position(80)};`;
    case 'rice':
      return `background:#fffdf8;background-image:linear-gradient(rgba(190,102,94,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(190,102,94,.22) 1px,transparent 1px),linear-gradient(45deg,transparent calc(50% - .5px),rgba(190,102,94,.13) 50%,transparent calc(50% + .5px)),linear-gradient(-45deg,transparent calc(50% - .5px),rgba(190,102,94,.13) 50%,transparent calc(50% + .5px));background-size:72px 72px;background-position:${position(72)};`;
    case 'mist':
      return `background:#edf4f8;background-image:radial-gradient(circle,rgba(65,103,126,.2) 1px,transparent 1.3px);background-size:20px 20px;background-position:${position(20)};`;
    case 'sage':
      return `background:#edf2ea;background-image:radial-gradient(circle,rgba(77,102,74,.2) 1px,transparent 1.3px);background-size:20px 20px;background-position:${position(20)};`;
    case 'dawn':
      return `background:#fff6f2;background-image:radial-gradient(circle at 20% 25%,rgba(245,181,151,.32),transparent 38%),radial-gradient(circle at 80% 72%,rgba(178,190,239,.28),transparent 40%);background-size:240px 180px;background-position:${position(240, 180)};`;
    default: {
      return `background:#ffffff;background-image:radial-gradient(circle,#dfe4ea 1px,transparent 1.3px);background-size:18px 18px;background-position:${position(18)};`;
    }
  }
}

export {
  drawImageBackgroundToExportTile,
  drawOriginalImageToExportTile,
  getExportBackgroundCss,
  renderExportDomTileCanvas,
  renderExportTileCanvas
};
