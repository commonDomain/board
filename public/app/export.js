import { getContentBounds } from './camera.js';
import { currentCanvas } from './catalog-model.js';
import { renderExportTileCanvas } from './export-rendering.js';
import { withPreparedExportSource } from './export-source.js';
import { blobToDataUrl, canvasToBlob } from './image-upload-model.js';
import { isWechatWebView, showToast } from './interface-model.js';
import { setExportEffect } from './interface.js';

import { state } from './state.js';
import { safeExportFilename, formatExportTimestamp, getExportDimensions, getExportTiles } from './export-model.js';

async function downloadBlob(blob, filename) {
  if (isWechatWebView()) {
    await showWechatExportPreview(blob, filename);
    return 'preview';
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'download';
}

async function showWechatExportPreview(blob, filename) {
  document.querySelector('.export-preview')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'export-preview';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '导出图片预览');

  const card = document.createElement('div');
  card.className = 'export-preview-card';
  const heading = document.createElement('div');
  heading.className = 'export-preview-heading';
  const title = document.createElement('strong');
  title.textContent = '图片已生成';
  const hint = document.createElement('span');
  hint.textContent = '在微信中长按图片，选择“保存图片”';
  heading.append(title, hint);

  const image = document.createElement('img');
  image.className = 'export-preview-image';
  image.alt = filename;
  image.src = await blobToDataUrl(blob);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'export-preview-close';
  close.textContent = '完成';
  const dismiss = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      dismiss();
    }
  };
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });
  document.addEventListener('keydown', onKeyDown);
  card.append(heading, image, close);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => close.focus());
}

async function exportBoardPng() {
  const bounds = getContentBounds();
  if (!bounds || !bounds.w || !bounds.h) {
    showToast('画板为空，没有可导出的内容');
    return;
  }
  setExportEffect(true);
  try {
    const name = currentCanvas()?.name || '未命名画布';
    const baseName = `${safeExportFilename(name)}-${formatExportTimestamp(new Date())}`;
    const keepIds = null;
    const blob = await buildExportPngBlob(
      bounds,
      keepIds,
      null,
      {}
    );
    if (!blob) {
      showToast('导出失败，请重试');
      return;
    }
    const downloadMode = await downloadBlob(blob, `${baseName}.png`);
    showToast(
      downloadMode === 'preview' ? '已打开图片预览，请长按保存' : 'PNG 已导出'
    );
  } finally {
    setExportEffect(false);
  }
}

async function buildExportPngBlob(bounds, keepIds, keepSectionId = null, options = {}) {
  const dimensions = getExportDimensions(bounds, options);
  return withPreparedExportSource(
    keepIds,
    keepSectionId,
    async (source) => {
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.pixelWidth;
      canvas.height = dimensions.pixelHeight;
      const context = canvas.getContext('2d');
      for (const tile of getExportTiles(dimensions)) {
        const tileCanvas = await renderExportTileCanvas(source, bounds, dimensions, tile, options);
        context.drawImage(tileCanvas, tile.pixelX, tile.pixelY);
      }
      const blob = await canvasToBlob(canvas, 'image/png');
      if (!blob) throw new Error('PNG export failed');
      return blob;
    },
    options
  );
}
export { downloadBlob, showWechatExportPreview, exportBoardPng, buildExportPngBlob };
