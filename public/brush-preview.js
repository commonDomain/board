'use strict';
(function (root) {
  function paint(canvas, payload) {
    if (canvas.width !== payload.width) canvas.width = payload.width;
    if (canvas.height !== payload.height) canvas.height = payload.height;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of payload.strokes) {
      root.WhiteboardBrushEngine.render(canvas, {
        ...stroke, complete: true, resize: false, clear: false,
        pixelRatio: payload.pixelRatio,
        transform: payload.transform.map((value, index) => index === 4
          ? value + payload.transform[0] * stroke.x + payload.transform[2] * stroke.y
          : index === 5 ? value + payload.transform[1] * stroke.x + payload.transform[3] * stroke.y : value)
      });
    }
  }

  let worker = null, ready = false, busy = null, active = null, serial = 0, watchdog = null;
  function failWorker() {
    root.clearTimeout(watchdog); watchdog = null;
    worker?.terminate(); worker = null; ready = false; busy = null;
    if (active?.factory) active.pending = true;
    active?.schedule();
  }
  function warm() {
    if (worker || !root.Worker || !root.OffscreenCanvas) return;
    try {
      const build = root.document.documentElement.dataset.staticBuild;
      const url = build ? `static/${encodeURIComponent(build)}/brush-preview-worker.js` : 'brush-preview-worker.js';
      worker = new root.Worker(url);
      worker.onerror = failWorker;
      worker.onmessage = ({ data }) => {
        if (data.ready) { ready = true; return; }
        root.clearTimeout(watchdog); watchdog = null;
        const request = busy;
        busy = null;
        if (request && active === request.controller && !active.disposed) {
          if (data.bitmap && data.id === request.id) {
            const ctx = active.canvas.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, active.canvas.width, active.canvas.height);
            ctx.drawImage(data.bitmap, 0, 0);
          }
          if (data.error) { active.pending = true; failWorker(); }
        }
        data.bitmap?.close();
        active?.schedule();
      };
    } catch { failWorker(); }
  }

  function create(canvas) {
    active?.dispose();
    const controller = {
      canvas, disposed: false, pending: false, factory: null, timer: null, lastAt: 0, interval: 32,
      update(factory) { this.factory = factory; this.pending = true; this.schedule(); },
      schedule() {
        if (this.disposed || !this.pending || this.timer || busy) return;
        this.timer = root.setTimeout(() => {
          this.timer = null;
          if (this.disposed || !this.pending || busy) return;
          const payload = this.factory();
          if (!payload) { this.pending = false; return; }
          this.pending = false;
          this.lastAt = performance.now();
          if (worker && ready) {
            busy = { id: ++serial, controller: this };
            try {
              worker.postMessage({ id: serial, payload });
              watchdog = root.setTimeout(failWorker, 3000);
            }
            catch { this.pending = true; failWorker(); }
          } else {
            paint(canvas, payload);
            this.interval = Math.max(32, Math.min(200, (performance.now() - this.lastAt) * 2));
          }
        }, Math.max(0, this.interval - (performance.now() - this.lastAt)));
      },
      dispose() {
        this.disposed = true; this.factory = null; this.pending = false;
        root.clearTimeout(this.timer); this.timer = null;
        if (active === this) active = null;
      }
    };
    active = controller;
    return controller;
  }
  root.WhiteboardBrushPreview = Object.freeze({ paint, create });
  if (root.document) warm();
})(typeof window === 'undefined' ? globalThis : window);
