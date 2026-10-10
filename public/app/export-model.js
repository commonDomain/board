import { EXPORT_MAX_PIXELS, EXPORT_MAX_SCALE, EXPORT_MAX_SIDE, EXPORT_TILE_PIXEL_SIDE } from './constants.js';

function safeExportFilename(value) {
  return (
    String(value || '未命名画布')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || '未命名画布'
  );
}

function formatExportTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getExportDimensions(bounds, options = {}) {
  
  const padding = 40;
  const width = Math.ceil(bounds.w + padding * 2);
  const height = Math.ceil(bounds.h + padding * 2);
  const constrainedScale = Math.max(
    0.01,
    Math.min(
      EXPORT_MAX_SCALE,
      Math.sqrt((EXPORT_MAX_PIXELS) / (width * height)),
      Math.min(EXPORT_MAX_SIDE, options.maxSide || EXPORT_MAX_SIDE) / width,
      Math.min(EXPORT_MAX_SIDE, options.maxSide || EXPORT_MAX_SIDE) / height
    )
  );
  const outputScale = constrainedScale;
  return {
    padding,
    width,
    height,
    outputScale,
    pixelWidth: Math.max(1, Math.round(width * outputScale)),
    pixelHeight: Math.max(1, Math.round(height * outputScale))
  };
}

function getExportTiles(dimensions) {
  const tiles = [];
  for (let pixelY = 0; pixelY < dimensions.pixelHeight; pixelY += EXPORT_TILE_PIXEL_SIDE) {
    for (let pixelX = 0; pixelX < dimensions.pixelWidth; pixelX += EXPORT_TILE_PIXEL_SIDE) {
      const pixelWidth = Math.min(EXPORT_TILE_PIXEL_SIDE, dimensions.pixelWidth - pixelX);
      const pixelHeight = Math.min(EXPORT_TILE_PIXEL_SIDE, dimensions.pixelHeight - pixelY);
      tiles.push({
        pixelX,
        pixelY,
        pixelWidth,
        pixelHeight,
        logicalX: pixelX / dimensions.outputScale,
        logicalY: pixelY / dimensions.outputScale,
        logicalWidth: pixelWidth / dimensions.outputScale,
        logicalHeight: pixelHeight / dimensions.outputScale
      });
    }
  }
  return tiles;
}
export { safeExportFilename, formatExportTimestamp, getExportDimensions, getExportTiles };
