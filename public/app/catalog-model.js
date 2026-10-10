import { state } from './state.js';

function clearLegacyCanvasRoute() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('board') && !url.hash) {
    return;
  }
  url.searchParams.delete('board');
  url.hash = '';
  history.replaceState(history.state, '', url);
}

function canvasCatalogSignature(canvases) {
  return JSON.stringify(
    (canvases || []).map((canvas) => [
      canvas.id,
      canvas.name,
      canvas.previewVersion,
      canvas.previewStyleVersion,
      canvas.visibility,
      canvas.ownerUserId,
      canvas.owner?.username,
      canvas.canManage
    ])
  );
}

function currentCanvas() {
  return state.canvases.find((canvas) => canvas.id === state.boardId) || null;
}
export { clearLegacyCanvasRoute, canvasCatalogSignature, currentCanvas };
