import { CANVAS_PREVIEW_STYLE_VERSION } from './constants.js';

function canvasPreviewIsCurrent(canvas) {
  return Number(canvas?.previewVersion) > 0 && Number(canvas?.previewStyleVersion) === CANVAS_PREVIEW_STYLE_VERSION;
}

function canvasPreviewIsAvailable(canvas) {
  const styleVersion = Number(canvas?.previewStyleVersion);
  return (
    Number(canvas?.previewVersion) > 0 &&
    Number.isSafeInteger(styleVersion) &&
    styleVersion >= 1 &&
    styleVersion <= CANVAS_PREVIEW_STYLE_VERSION
  );
}

function usesCompactCanvasMenuLayout() {
  return window.matchMedia('(max-width: 760px), (max-height: 500px) and (orientation: landscape)').matches;
}
export { canvasPreviewIsCurrent, canvasPreviewIsAvailable, usesCompactCanvasMenuLayout };
