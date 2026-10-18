// Image display geometry and decoded bitmap geometry are separate resources.
// Phone rendering uses only bounded previews; export retains the stored source.
const PHONE_IMAGE_PIXELS = 12_000_000;
const PHONE_IMAGE_CONCURRENCY = 2;
const TABLET_IMAGE_PIXELS = 24_000_000;

function imageAssetId(item) {
  const match = String(item.src || '').match(/^\/assets\/([a-f0-9]{64})\.(?:png|jpg|webp)$/i);
  return match?.[1].toLowerCase() || (/^[a-f0-9]{64}$/i.test(item.assetId || '') ? item.assetId.toLowerCase() : null);
}

function planImageSources(items, zoom, deviceRatio, { tablet = false } = {}) {
  const share = (tablet ? TABLET_IMAGE_PIXELS : PHONE_IMAGE_PIXELS) / Math.max(1, items.length);
  return items.map(item => {
    const knownSize = Number(item.naturalWidth) > 0 && Number(item.naturalHeight) > 0;
    const width = Math.max(1, Number(item.naturalWidth) || Number(item.w) || 1);
    const height = Math.max(1, Number(item.naturalHeight) || Number(item.h) || 1);
    const longest = Math.max(width, height);
    // Unknown metadata is budgeted as a square, never as a tiny display card.
    const aspect = knownSize ? width * height / longest ** 2 : 1;
    const viewZoom = Number.isFinite(item.viewZoom) ? item.viewZoom : zoom;
    const projected = Math.max(Number(item.w) || 1, Number(item.h) || 1) * viewZoom * Math.max(1, deviceRatio || 1);
    // Tablets may display a higher-resolution source, but a very large or
    // unknown original stays on the server preview to bound transient decode.
    const highResolution = tablet && knownSize && width * height <= 16_000_000;
    const renderSide = Math.max(1, Math.min(highResolution ? 2560 : 1600, Math.ceil(projected / 128) * 128, Math.sqrt(share / aspect), knownSize ? longest : Infinity));
    const side = renderSide <= 320 ? 320 : 1600;
    const assetId = imageAssetId(item);
    // Only a verified small original can bypass the preview path. Missing
    // previews must not silently reopen a multi-megapixel original.
    const original = knownSize && (longest <= side || highResolution && renderSide > 1600);
    const source = assetId && !original ? `/assets/${assetId}.${side === 320 ? 'thumb' : 'medium'}.webp` : item.src;
    return {
      id: item.id, source,
      fallback: assetId && side > 320 && (!original || tablet) ? `/assets/${assetId}.${original ? 'medium' : 'thumb'}.webp` : null,
      fullDecode: original || !assetId,
      // Stored metadata may come from old copies. Always bound an original's
      // actual decoded output rather than trusting the claimed intrinsic size.
      resize: original || !assetId || renderSide < side,
      width: Math.max(1, Math.floor(renderSide * width / longest)),
      height: Math.max(1, Math.floor(renderSide * height / longest)),
      pixels: Math.ceil(renderSide ** 2 * aspect)
    };
  });
}

function planPhoneImageSources(items, zoom, deviceRatio) { return planImageSources(items, zoom, deviceRatio); }

export { PHONE_IMAGE_PIXELS, TABLET_IMAGE_PIXELS, PHONE_IMAGE_CONCURRENCY, imageAssetId, planPhoneImageSources, planImageSources };
