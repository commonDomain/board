'use strict';

(() => {
  const noop = () => {};
  const consoleMethods = [
    'assert', 'clear', 'count', 'countReset', 'debug', 'dir', 'dirxml',
    'error', 'group', 'groupCollapsed', 'groupEnd', 'info', 'log', 'profile',
    'profileEnd', 'table', 'time', 'timeEnd', 'timeLog', 'timeStamp', 'trace',
    'warn'
  ];

  // Keep application and third-party diagnostics out of the browser console.
  // These methods are locked before any deferred application bundle executes.
  for (const method of consoleMethods) {
    try {
      Object.defineProperty(globalThis.console, method, {
        configurable: false,
        enumerable: false,
        value: noop,
        writable: false
      });
    } catch {
      try { globalThis.console[method] = noop; } catch { /* read-only console */ }
    }
  }

  // Prevent the browser's own menu without consuming the event. Project-owned
  // context-menu handlers still run later in the capture/bubble path.
  document.addEventListener('contextmenu', (event) => {
    // Notebook input fields need native clipboard, spelling and IME actions.
    if (event.target.closest?.('.nt-app input,.nt-app textarea,.nt-app select,.nt-owned-dialog input,.nt-owned-dialog textarea,.nt-owned-dialog select')) return;
    event.preventDefault();
  }, { capture: true });

  // Browser developer tools cannot be disabled by page code. Blocking their
  // common keyboard entry points is the strongest non-invasive browser guard.
  document.addEventListener('keydown', (event) => {
    const key = String(event.key || '').toLowerCase();
    const functionKey = key === 'f12';
    const chromiumShortcut = (event.ctrlKey || event.metaKey)
      && event.shiftKey
      && ['c', 'i', 'j', 'k'].includes(key);
    const macShortcut = event.metaKey && event.altKey && ['c', 'i', 'j', 'k'].includes(key);
    if (!functionKey && !chromiumShortcut && !macShortcut) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });

  // Stop uncaught application failures from being echoed by the browser.
  globalThis.addEventListener('error', (event) => event.preventDefault());
  globalThis.addEventListener('unhandledrejection', (event) => event.preventDefault());
})();
