// Use a disposable rendering document so another canvas can be captured without
// touching the active canvas, its selection, history, camera or pending writes.
export async function renderNoteRegion(snapshot) {
  const controller = new AbortController();
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1440px;height:900px;border:0;pointer-events:none';
  let timer;
  try {
    const response = await fetch('/', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw new Error('无法加载预览工具');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const allowed = new Set(['api-transport.js', 'app-security.js', 'perfect-freehand.min.js', 'icons.min.js', 'gsap.min.js', 'mindmap-layout.js', 'connector-core.js', 'sync-queue.js', 'history.js', 'brush-engine.js', 'brush-preview.js', 'spatial-index.js', 'mindmap-markdown.js', 'canvas-interaction.js', 'connector-router.js', 'font-families.js', 'sheet-protocol.js', 'sheet-formula.js', 'sheet-core.js', 'sheet-view.js']);
    for (const script of doc.querySelectorAll('script')) if (!allowed.has(script.getAttribute('src')?.split('/').at(-1)?.split('?')[0])) script.remove();
    const base = doc.createElement('base'); base.href = new URL('/', location.href).href; doc.head.prepend(base);
    const script = doc.createElement('script'); script.type = 'module'; script.src = new URL('./note-region-renderer.js', import.meta.url).href; doc.body.append(script);
    const ready = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('预览生成超时，请重试')), 25000);
      frame.addEventListener('load', () => frame.contentWindow.MuseRegionRenderer ? resolve() : reject(new Error('预览工具加载失败')), { once: true });
    });
    frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML; document.body.append(frame);
    await ready;
    return await Promise.race([
      frame.contentWindow.MuseRegionRenderer(structuredClone(snapshot)),
      new Promise((resolve, reject) => { clearTimeout(timer); timer = setTimeout(() => reject(new Error('预览生成超时，请重试')), 25000); })
    ]);
  } finally { clearTimeout(timer); controller.abort(); frame.remove(); }
}
