'use strict';
importScripts('vendor/perfect-freehand.min.js', 'brush-engine.js', 'brush-preview.js');
const previewCanvas = new OffscreenCanvas(1, 1);
self.onmessage = ({ data }) => {
  try {
    self.WhiteboardBrushPreview.paint(previewCanvas, data.payload);
    const bitmap = previewCanvas.transferToImageBitmap();
    self.postMessage({ id: data.id, bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
self.postMessage({ ready: true });
