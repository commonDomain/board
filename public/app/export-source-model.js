import { cssEscape, staticAssetUrl } from './utilities.js';

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

async function fetchDataUrl(src) {
  try {
    const response = await fetch(src);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function inlineExportImages(clone) {
  const images = Array.from(clone.querySelectorAll('img'));
  await Promise.all(
    images.map(async (img) => {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) {
        return;
      }
      const dataUrl = await fetchDataUrl(src);
      if (dataUrl) {
        img.src = dataUrl;
      }
      // otherwise keep the original URL; the browser may still render it
    })
  );
}

// The SVG foreignObject export does not load external border images, so realistic section frames
// take their moulding (resolved from the live frame's computed style) as a data URL.
async function inlineSectionFrameImages(clone, liveRoot) {
  const pending = new Map();
  await Promise.all(
    Array.from(clone.querySelectorAll('.section-frame[data-frame-style]')).map(async (node) => {
      const live = liveRoot.querySelector(`.section-frame[data-section-id="${cssEscape(node.dataset.sectionId)}"]`);
      const src = live && /url\("?([^")]+)"?\)/.exec(getComputedStyle(live).borderImageSource)?.[1];
      if (!src) {
        return;
      }
      if (!pending.has(src)) {
        pending.set(src, fetchDataUrl(src));
      }
      const dataUrl = await pending.get(src);
      if (dataUrl) {
        node.style.borderImageSource = `url("${dataUrl}")`;
      }
    })
  );
  // Backdrop textures are --backdrop-tex-* variables on the section layer (section-backdrops.css);
  // the clone's layer gets data URLs for the ones its frames use.
  const layer = clone.querySelector('.section-layer') || clone;
  const textures = new Set(
    Array.from(clone.querySelectorAll('.section-frame[data-frame-backdrop]')).flatMap(
      (node) => SECTION_BACKDROP_TEXTURES[node.dataset.frameBackdrop] || []
    )
  );
  await Promise.all(
    Array.from(textures, async (name) => {
      const dataUrl = await fetchDataUrl(staticAssetUrl(`section-backdrops/${name}.webp`));
      if (dataUrl) layer.style.setProperty(`--backdrop-tex-${name}`, `url("${dataUrl}")`);
    })
  );
}

// Texture tiles each section backdrop draws (public/section-backdrops).
const SECTION_BACKDROP_TEXTURES = {
  xuan: ['xuan'],
  linen: ['linen'],
  marble: ['marble'],
  mist: ['grain'],
  frosted: ['grain']
};

async function waitForExportAssets() {
  const images = Array.from(document.querySelectorAll('.board-item img'));
  const loading = images.map(img => [img, img.loading]);
  const restoreLoading = () => { for (const [img, value] of loading) img.loading = value; };
  try {
  await Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...images.map((img) => {
      // Export mounts offscreen images too. Native lazy loading may never
      // request them, so waiting for their load event would hang indefinitely.
      img.loading = 'eager';
      // A failed image is complete with naturalWidth=0; its error event has
      // already fired. The export's original-image path handles fallback.
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        const finish = () => {
          img.removeEventListener('load', finish);
          img.removeEventListener('error', finish);
          resolve();
        };
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
      });
    })
  ]);
  } catch (error) {
    restoreLoading();
    throw error;
  }
  return restoreLoading;
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
export { positiveModulo, inlineExportImages, inlineSectionFrameImages, waitForExportAssets, xmlSafeHtml, xmlSafeStyleText };
