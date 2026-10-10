function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

async function inlineExportImages(clone) {
  const images = Array.from(clone.querySelectorAll('img'));
  await Promise.all(
    images.map(async (img) => {
      try {
        const src = img.currentSrc || img.src;
        if (!src || src.startsWith('data:')) {
          return;
        }
        const response = await fetch(src);
        if (!response.ok) {
          return;
        }
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) {
          img.src = dataUrl;
        }
      } catch {
        // keep the original URL; the browser may still render it
      }
    })
  );
}

async function waitForExportAssets() {
  const images = Array.from(document.querySelectorAll('.board-item img'));
  await Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...images.map((img) =>
      img.complete && img.naturalWidth
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
    )
  ]);
}

function xmlSafeHtml(html) {
  return html
    .replace(/<(img|br|hr|input|meta|link|col)((?:\s[^>]*?)?)(?<!\/)>/gi, '<$1$2 />')
    .replace(/&(?!(amp|lt|gt|quot|apos|#\d+);)/g, '&amp;');
}

function xmlSafeStyleText(cssText) {
  return String(cssText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
export { positiveModulo, inlineExportImages, waitForExportAssets, xmlSafeHtml, xmlSafeStyleText };
