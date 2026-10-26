// Bound raster memory independently of the number of items on the board.
function getCanvasRenderPolicy({ exporting = false } = {}) {
  const phone = !exporting && document.documentElement.dataset.formFactor === 'phone';
  const tablet = !exporting && document.documentElement.dataset.formFactor === 'tablet';
  return phone
    ? { phone, tablet, bounded: true, renderMargin: 80, retainMargin: 160, mountLimit: 4, mountBudgetMs: 3, maxRasterSide: 2048, maxRasterPixels: 1_000_000, totalInkPixels: 12_000_000 }
    : tablet
      ? { phone, tablet, bounded: true, renderMargin: 180, retainMargin: 300, mountLimit: 8, mountBudgetMs: 4, maxRasterSide: 3072, maxRasterPixels: 2_000_000, totalInkPixels: 24_000_000 }
      : { phone, tablet, bounded: false, renderMargin: 300, retainMargin: 450, mountLimit: 120, mountBudgetMs: 6, maxRasterSide: 4096, maxRasterPixels: 4_000_000 };
}

function getInkPixelRatio(width, height, deviceRatio, policy = getCanvasRenderPolicy(), { inkCount = 1, zoom = 1 } = {}) {
  const pixels = policy.bounded
    ? Math.min(policy.maxRasterPixels, policy.totalInkPixels / Math.max(1, inkCount))
    : policy.maxRasterPixels;
  const viewScale = policy.bounded ? Math.min(1, Math.max(0.01, zoom)) : 1;
  const ratio = Math.min(
    2.5,
    Math.max(1, Number(deviceRatio) || 1) * viewScale,
    policy.maxRasterSide / width,
    policy.maxRasterSide / height,
    Math.sqrt(pixels / (width * height))
  );
  return policy.bounded ? ratio : Math.max(0.05, ratio);
}

function releaseItemSurfaces(node) {
  if (!node) return;
  // Detached Canvas2D buffers can otherwise survive until a later GC cycle.
  for (const canvas of node.querySelectorAll('canvas')) {
    canvas.width = 1;
    canvas.height = 1;
  }
  for (const image of node.querySelectorAll('img')) {
    image.removeAttribute('srcset');
    image.removeAttribute('src');
  }
}

function shrinkInkSurfaces(maxPixels) {
  for (const canvas of document.querySelectorAll(getCanvasRenderPolicy().tablet ? '.ink-canvas,.nt-ink-canvas' : '.ink-canvas')) {
    if (canvas.width * canvas.height <= maxPixels * 1.01) continue;
    const ratio = Math.sqrt(maxPixels / (canvas.width * canvas.height));
    const temporary = document.createElement('canvas');
    temporary.width = Math.max(1, Math.floor(canvas.width * ratio));
    temporary.height = Math.max(1, Math.floor(canvas.height * ratio));
    const context = temporary.getContext('2d');
    const target = canvas.getContext('2d');
    if (!context || !target) { temporary.width = 1; temporary.height = 1; continue; }
    context.drawImage(canvas, 0, 0, temporary.width, temporary.height);
    canvas.width = temporary.width;
    canvas.height = temporary.height;
    target.drawImage(temporary, 0, 0);
    temporary.width = 1;
    temporary.height = 1;
  }
}

export { getCanvasRenderPolicy, getInkPixelRatio, releaseItemSurfaces, shrinkInkSurfaces };
