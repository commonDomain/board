// Finding an update is terminal: only loading a new page restarts detection.
import { createUpdatePrompt } from './app-version-prompt.js';
const CHECK_INTERVAL = 60000;
const CHECK_THROTTLE = 10000;
const MAX_RETRY_INTERVAL = 15 * 60000;
const SAVE_TIMEOUT = 15000;
let started = false, updateFound = false, checking = false, suspended = false;
let lastCheck = -Infinity, retryAt = 0, failures = 0;
let timer = null, requestController = null, prepareReload = null;
let dialog, notice, feedback, pendingPreparation = null, reloadController = null;
let updatePrompt;
const listeners = [['visibilitychange', document], ['online', window], ['offline', window], ['pageshow', window], ['pagehide', window]];

function paused() { return suspended || document.hidden || navigator.onLine === false; }
function clearTimer() { clearTimeout(timer); timer = null; }
function stopChecking() {
  clearTimer();
  for (const [type, target] of listeners) target.removeEventListener(type, onLifecycle);
}
function onLifecycle(event) {
  if (updateFound) return;
  if (event.type === 'pagehide') suspended = true;
  if (event.type === 'pageshow') suspended = false;
  if (paused()) { clearTimer(); requestController?.abort(); }
  else void checkAppVersion();
}
function scheduleCheck(delay = CHECK_INTERVAL * (1 + Math.random() * .25)) {
  clearTimer();
  if (!started || updateFound || paused()) return;
  timer = setTimeout(() => { timer = null; void checkAppVersion(); }, Math.max(0, delay));
}

function setRefreshBusy(busy) {
  for (const element of [dialog, notice]) {
    element?.querySelectorAll('[data-version-refresh]').forEach(button => { button.disabled = busy; });
    element?.querySelectorAll('[data-version-cancel]').forEach(button => { button.hidden = !reloadController || reloadController.signal.aborted; });
  }
}

function waitForSave(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

async function reloadPage() {
  if (pendingPreparation || reloadController) return;
  updatePrompt?.cancel();
  const controller = new AbortController();
  reloadController = controller;
  setRefreshBusy(true);
  (dialog?.open ? dialog.querySelector('[data-version-later]') : notice.querySelector('[data-version-cancel]'))?.focus({ preventScroll: true });
  feedback.textContent = '正在保存编辑内容…';
  const work = Promise.resolve().then(() => prepareReload({ signal: controller.signal,
    onStatus: message => { if (!controller.signal.aborted) feedback.textContent = message; } }));
  pendingPreparation = work;
  const settled = () => {
    if (pendingPreparation === work) {
      pendingPreparation = null;
      setRefreshBusy(Boolean(reloadController));
      if (controller.signal.aborted) feedback.textContent = '保存等待已结束，可以重试刷新。';
    }
  };
  work.then(settled, settled);
  const timeout = setTimeout(() => controller.abort(new DOMException('保存等待超时，已恢复编辑。正在进行的保存结束后可重试刷新。', 'TimeoutError')), SAVE_TIMEOUT);
  try {
    if (await waitForSave(work, controller.signal) === false) throw new Error('编辑内容尚未安全保存，请处理后再次刷新。');
    controller.signal.throwIfAborted();
    window.location.reload();
  } catch (error) {
    if (error?.name === 'AbortError') feedback.textContent = pendingPreparation ? '已取消刷新，正在等待已有保存结束。' : '已取消刷新，可以继续编辑。';
    else feedback.textContent = error?.message || '暂时无法保存编辑内容，请稍后重试刷新。';
  } finally {
    clearTimeout(timeout);
    if (reloadController === controller) reloadController = null;
    setRefreshBusy(Boolean(pendingPreparation));
  }
}

function button(label, run, refresh = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (refresh) element.dataset.versionRefresh = '';
  element.addEventListener('click', run);
  return element;
}
function isolate(element) {
  element.dataset.appVersionUi = '';
  for (const type of ['keydown', 'pointerdown', 'wheel', 'paste', 'copy', 'cut']) {
    element.addEventListener(type, event => event.stopPropagation());
  }
}

function showUpdate() {
  updateFound = true;
  stopChecking();
  // Mount the persistent fallback before attempting any modal operation.
  notice = document.createElement('aside');
  notice.className = 'app-version-notice';
  notice.setAttribute('aria-label', '网页更新');
  const message = document.createElement('p');
  message.textContent = '网页已有新版本，请刷新';
  const refresh = button('刷新网页', reloadPage, true);
  const cancel = button('取消刷新', () => {
    reloadController?.abort(new DOMException('用户取消刷新', 'AbortError'));
    setRefreshBusy(Boolean(pendingPreparation));
  });
  cancel.dataset.versionCancel = ''; cancel.hidden = true;
  feedback = document.createElement('p');
  feedback.className = 'app-version-feedback';
  feedback.setAttribute('role', 'status');
  notice.append(message, refresh, cancel, feedback);
  notice.addEventListener('keydown', event => {
    if (event.key === 'Escape' && reloadController) { event.preventDefault(); cancel.click(); }
  });
  isolate(notice);
  document.body.append(notice);
  updatePrompt.request(restoreFocus => {
    try {
      dialog = document.createElement('dialog');
      dialog.className = 'app-version-dialog';
      dialog.setAttribute('aria-labelledby', 'appVersionTitle');
      dialog.setAttribute('aria-describedby', 'appVersionDescription');
      const title = document.createElement('h2');
      title.id = 'appVersionTitle';
      title.textContent = '网页已有新版本';
      const description = document.createElement('p');
      description.id = 'appVersionDescription';
      description.textContent = '请刷新网页以使用最新版本。刷新前会检查并保存当前编辑内容，也可以稍后自行刷新。';
      const actions = document.createElement('div');
      actions.className = 'app-version-actions';
      const later = () => {
        reloadController?.abort(new DOMException('用户选择稍后刷新', 'AbortError'));
        dialog.close();
        restoreFocus();
      };
      const laterButton = button('稍后自行刷新', later);
      laterButton.dataset.versionLater = '';
      actions.append(laterButton, button('立即刷新', reloadPage, true));
      dialog.append(title, description, actions);
      dialog.addEventListener('close', () => {
        reloadController?.abort(new DOMException('刷新提示已关闭', 'AbortError'));
        notice.append(feedback);
        notice.hidden = false;
      });
      dialog.addEventListener('cancel', event => { event.preventDefault(); later(); });
      isolate(dialog);
      document.body.append(dialog);
      dialog.showModal();
      notice.hidden = true;
      dialog.append(feedback);
    } catch (error) {
      console.error('Unable to display app version dialog; persistent notice remains available.', error);
      dialog?.remove();
      dialog = null;
      notice.append(feedback);
      notice.hidden = false;
    }
  });
}

async function checkAppVersion() {
  if (!started || updateFound || checking || paused()) return;
  const remaining = Math.max(lastCheck + CHECK_THROTTLE, retryAt) - performance.now();
  if (remaining > 0) { scheduleCheck(remaining); return; }
  clearTimer();
  checking = true;
  lastCheck = performance.now();
  const controller = new AbortController();
  requestController = controller;
  let found = false;
  try {
    const response = await fetch('/api/app-version', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
    if (!response.ok) throw new Error(`Version check returned ${response.status}`);
    const { buildId } = await response.json();
    if (typeof buildId !== 'string' || !/^[a-f0-9]{24}$/.test(buildId)) throw new Error('Invalid app version');
    found = buildId !== document.documentElement.dataset.staticBuild;
    failures = 0;
    retryAt = 0;
  } catch {
    if (!controller.signal.aborted) {
      failures = Math.min(failures + 1, 5);
      retryAt = performance.now() + Math.min(MAX_RETRY_INTERVAL, CHECK_INTERVAL * 2 ** (failures - 1) * (1 + Math.random() * .25));
    }
  } finally {
    checking = false;
    requestController = null;
  }
  if (found) {
    // UI failures are distinct from fetch failures and never restart checking.
    try { showUpdate(); } catch (error) { console.error('Unable to mount app version notice.', error); }
  } else scheduleCheck(retryAt ? retryAt - performance.now() : undefined);
}

function initializeAppVersion(options) {
  if (started || !/^[a-f0-9]{24}$/.test(document.documentElement.dataset.staticBuild || '')) return;
  started = true;
  prepareReload = options.prepareReload;
  updatePrompt = createUpdatePrompt();
  for (const [type, target] of listeners) target.addEventListener(type, onLifecycle);
  void checkAppVersion();
}

export { initializeAppVersion, checkAppVersion };
