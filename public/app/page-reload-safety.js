// A cancelled IndexedDB write cannot be assumed to have stopped. The caller keeps
// its promise and prevents duplicate saves, while this guard releases input now.
function guardPageInput(signal) {
  const previous = new Map();
  const freeze = element => {
    if (!(element instanceof HTMLElement) || element.matches('[data-app-version-ui]') || previous.has(element)) return;
    previous.set(element, element.inert);
    element.inert = true;
  };
  for (const element of document.body.children) freeze(element);
  const observer = new MutationObserver(records => {
    for (const record of records) for (const element of record.addedNodes) freeze(element);
  });
  observer.observe(document.body, { childList: true });
  const types = ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown', 'beforeinput', 'input', 'change', 'paste', 'cut', 'drop', 'dragstart', 'submit'];
  const block = event => {
    if (event.target.closest?.('[data-app-version-ui]')) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of types) window.addEventListener(type, block, true);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    observer.disconnect();
    for (const [element, inert] of previous) element.inert = inert;
    for (const type of types) window.removeEventListener(type, block, true);
    signal.removeEventListener('abort', release);
  };
  signal.addEventListener('abort', release, { once: true });
  if (signal.aborted) release();
  return release;
}

async function verifyReloadEntry({ signal }) {
  if (navigator.onLine === false) throw new Error('当前处于离线状态，请联网后重试刷新。');
  const entry = new URL(window.location.href); entry.hash = '';
  let response;
  try {
    response = await fetch(entry.href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  } catch {
    signal.throwIfAborted();
    throw new Error('暂时无法连接网页，请检查网络后重试刷新。');
  }
  signal.throwIfAborted();
  if (response.status === 503) throw new Error('网页正在更新，当前页面已保留，请稍后重试刷新。');
  if (!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new Error('网页入口暂不可用，当前页面已保留，请稍后重试刷新。');
  }
}

function saveError(error, name) {
  if (!name || error?.userFacing || ['AbortError', 'TimeoutError'].includes(error?.name)) return error;
  if (error?.name === 'QuotaExceededError') return new Error(`${name}保存失败：浏览器存储空间不足，请释放空间后重试刷新。`, { cause: error });
  if (['InvalidStateError', 'SecurityError', 'NotAllowedError'].includes(error?.name)) {
    return new Error(`${name}保存失败：浏览器本地存储不可用，请检查存储设置后重试刷新。`, { cause: error });
  }
  return new Error(`${name}保存失败：${error?.message || '请保持页面打开并稍后重试刷新。'}`, { cause: error });
}

function createSafePageReload({ getContext, checkBusy, saves, checkEntry }) {
  return async ({ signal, onStatus }) => {
    signal.throwIfAborted();
    checkBusy();
    const context = getContext();
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (context !== getContext()) throw new Error('编辑上下文已改变，请确认当前内容后重试刷新。');
    };
    if (checkEntry) { onStatus?.('正在检查网页连接…'); await checkEntry({ signal }); assertCurrent(); checkBusy(); }
    const release = guardPageInput(signal);
    try {
      onStatus?.('正在保存编辑内容…');
      const validations = [];
      for (const save of saves) {
        assertCurrent();
        let result;
        try { result = await (typeof save === 'function' ? save : save.run)({ signal }); }
        catch (error) { throw saveError(error, typeof save === 'function' ? null : save.name); }
        assertCurrent();
        if (result === false) throw new Error('编辑内容尚未安全保存，请处理后再次刷新。');
        if (typeof result === 'function') validations.push(result);
      }
      checkBusy();
      if (checkEntry) { onStatus?.('正在确认网页可用…'); await checkEntry({ signal }); assertCurrent(); }
      if (validations.some(validate => !validate())) throw new Error('保存期间内容发生变化，请再次刷新以保存最新修改。');
      assertCurrent();
      return true;
    } finally { release(); }
  };
}

export { createSafePageReload, verifyReloadEntry };
