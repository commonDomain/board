function staticAssetUrl(relativePath) {
  const buildId = document.documentElement.dataset.staticBuild;
  return buildId ? `static/${encodeURIComponent(buildId)}/${relativePath}` : relativePath;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function createSvg(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function normalizeAngle(value) {
  return ((value % 360) + 360) % 360;
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, '\\$&');
}

function isImeEvent(event) {
  // During CJK/IME composition the Escape key belongs to the candidate
  // window, not to the board: never let it cancel an edit or close a dialog.
  return Boolean(event && (event.isComposing === true || event.keyCode === 229));
}

function isEditableTarget(target) {
  return Boolean(target && target.closest && target.closest('[contenteditable="true"], input, textarea, select'));
}

function placeCursorAtEnd(element) {
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCursorAtPoint(element, point) {
  if (!element || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  let range = null;
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(point.x, point.y);
    if (position?.offsetNode) {
      range = document.createRange();
      try {
        range.setStart(position.offsetNode, position.offset);
      } catch {
        range = null;
      }
    }
  }
  if (!range && typeof document.caretRangeFromPoint === 'function') {
    try {
      range = document.caretRangeFromPoint(point.x, point.y);
    } catch {
      range = null;
    }
  }
  if (!range || !element.contains(range.startContainer)) return false;
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const blocked = startElement?.closest?.('[contenteditable="false"]');
  if (blocked && blocked !== element && element.contains(blocked)) return false;
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function debounce(fn, wait) {
  let timer;
  let pendingArgs = null;
  const wrapped = (...args) => {
    pendingArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const argsToRun = pendingArgs;
      pendingArgs = null;
      fn(...argsToRun);
    }, wait);
  };
  wrapped.flush = () => {
    if (!pendingArgs) {
      return;
    }
    clearTimeout(timer);
    timer = null;
    const argsToRun = pendingArgs;
    pendingArgs = null;
    fn(...argsToRun);
  };
  return wrapped;
}

function waitForCanvasPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}
export {
  staticAssetUrl,
  makeId,
  createSvg,
  clamp,
  round,
  distance,
  radiansToDegrees,
  normalizeAngle,
  cssEscape,
  isImeEvent,
  isEditableTarget,
  placeCursorAtEnd,
  placeCursorAtPoint,
  debounce,
  waitForCanvasPaint
};
