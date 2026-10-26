// Bottom-right "exporting" indicator shared by every export path.
// The board app and the bundled notebook / sheet editors each get their own copy
// of this module, so the active-task count lives on the single DOM node instead
// of module state: overlapping exports from any bundle keep it visible until the
// last one settles.
const INDICATOR_ID = 'muse-export-progress';
const HIDE_DELAY_MS = 180;

function ensureIndicator() {
  let node = document.getElementById(INDICATOR_ID);
  if (node) return node;
  node = document.createElement('div');
  node.id = INDICATOR_ID;
  node.className = 'export-progress';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.hidden = true;
  node.dataset.count = '0';
  const spinner = document.createElement('span');
  spinner.className = 'export-progress-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'export-progress-label';
  node.append(spinner, label);
  document.body.appendChild(node);
  return node;
}

function beginExportProgress(message = '正在导出…') {
  const node = ensureIndicator();
  clearTimeout(Number(node.dataset.hideTimer));
  node.dataset.count = String(Number(node.dataset.count || 0) + 1);
  node.querySelector('.export-progress-label').textContent = message;
  node.classList.remove('is-leaving');
  node.hidden = false;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    const remaining = Math.max(0, Number(node.dataset.count || 0) - 1);
    node.dataset.count = String(remaining);
    if (remaining) return;
    node.classList.add('is-leaving');
    node.dataset.hideTimer = String(setTimeout(() => {
      if (node.dataset.count !== '0') return;
      node.hidden = true;
      node.classList.remove('is-leaving');
    }, HIDE_DELAY_MS));
  };
}

async function withExportProgress(task, message) {
  const finish = beginExportProgress(message);
  try {
    // Let the indicator paint before synchronous encoding work blocks the main thread.
    // The timeout covers background tabs, where animation frames never fire.
    await new Promise((resolve) => {
      const fallback = setTimeout(resolve, 60);
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        setTimeout(resolve, 0);
      });
    });
    return await task();
  } finally {
    finish();
  }
}

export { beginExportProgress, withExportProgress };
