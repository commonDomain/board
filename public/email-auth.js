'use strict';

(function verifyEmailMagicLink() {
  const REQUEST_TIMEOUT_MS = 15_000;
  const ERROR_CLOSE_AFTER_MS = 3_000;
  const byId = (id) => document.getElementById(id);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get('token') || '';
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);

  function refreshIcons() {
    try { window.MuseIcons?.renderIcons(document); } catch {}
  }

  function setIcon(name, state) {
    const icon = byId('emailAuthIcon');
    icon.className = `email-auth-icon ${state || ''}`;
    icon.innerHTML = `<i data-lucide="${name}" aria-hidden="true"></i>`;
    refreshIcons();
  }

  let verifying = false;
  let closeTimer = null;

  function closeOrReturn() {
    window.close();
    setTimeout(() => {
      if (document.visibilityState === 'hidden') return;
      byId('closeEmailAuthButton').hidden = false;
      byId('emailAuthDescription').textContent = '浏览器未允许自动关闭，请手动关闭此标签页或返回上一页。';
    }, 350);
  }

  function scheduleClose(delayMs = 900) {
    clearTimeout(closeTimer);
    byId('closeEmailAuthButton').hidden = false;
    closeTimer = setTimeout(closeOrReturn, delayMs);
  }

  function showError(message, retryable = false) {
    setIcon('circle-alert', 'is-error');
    byId('emailAuthTitle').textContent = '链接无法完成验证';
    byId('emailAuthDescription').textContent = retryable
      ? '请检查网络后点击“重新验证”；本页即将关闭。'
      : '你可以返回 Muse Board 重新发送一封邮件；本页即将关闭。';
    byId('emailAuthError').textContent = message;
    byId('emailAuthError').hidden = false;
    byId('retryEmailAuthButton').hidden = !retryable;
    scheduleClose(Math.max(0, ERROR_CLOSE_AFTER_MS - performance.now()));
  }

  async function verify() {
    if (verifying) return;
    clearTimeout(closeTimer);
    if (!token) { showError('魔法链接缺少验证信息。'); return; }
    verifying = true;
    byId('retryEmailAuthButton').hidden = true;
    byId('emailAuthError').hidden = true;
    byId('emailAuthTitle').textContent = '正在验证魔法链接';
    byId('emailAuthDescription').textContent = '请稍候，不要关闭此页面。';
    setIcon('loader-circle', 'is-loading');
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('/api/auth/email/verify', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '邮箱验证失败，请重新发送链接。');
      setIcon('badge-check', 'is-success');
      byId('emailAuthTitle').textContent = body.intent === 'bind' ? '邮箱确认成功' : '登录确认成功';
      byId('emailAuthDescription').textContent = body.intent === 'bind'
        ? '邮箱绑定会自动完成，本页即将关闭。'
        : '登录确认已完成，本页即将关闭。';
      scheduleClose();
    } catch (error) {
      const networkFailure = timedOut || error?.name === 'AbortError' || error?.name === 'TypeError';
      showError(networkFailure
        ? (timedOut ? '验证请求超时，请检查网络后重试。' : '网络连接中断，请恢复网络后重试。')
        : (error.message || '邮箱验证失败，请重新发送链接。'), networkFailure);
    } finally {
      clearTimeout(timeout);
      verifying = false;
    }
  }

  byId('retryEmailAuthButton').addEventListener('click', verify);
  byId('closeEmailAuthButton').addEventListener('click', closeOrReturn);
  window.addEventListener('online', () => {
    if (!byId('retryEmailAuthButton').hidden) void verify();
  });
  refreshIcons();
  void verify();
})();
