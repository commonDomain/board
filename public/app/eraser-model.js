function eraseInkGeometry(geometry, hitTest) {
  let changed = false;
  geometry.points.forEach((point, index) => {
    if (!geometry.removed[index] && hitTest(point, geometry.inkRadius)) {
      geometry.removed[index] = true;
      changed = true;
    }
  });
  return changed;
}

function restoreEraserInkPreview(entry) {
  entry.node.style.visibility = entry.visibility;
  entry.pieces.forEach((node) => node.remove());
}

function clearEraserPreview(eraser) {
  if (!eraser) return;
  cancelAnimationFrame(eraser.previewFrame || 0);
  eraser.previewCanvas?.remove();
  eraser.inkPreviews?.forEach(restoreEraserInkPreview);
  eraser.inkPreviews?.clear();
}
export { eraseInkGeometry, restoreEraserInkPreview, clearEraserPreview };
