'use strict';

(function installPairingPage(global) {
  const webAuthn = global.SimpleWebAuthnBrowser;
  const byId = (id) => document.getElementById(id);
  const PAIR_TOKEN_KEY = 'muse_board_pair_approval';
  const REQUEST_TIMEOUT_MS = 15_000;
  const state = { token: '', pairing: null, session: null, recoveryCode: '', passkeyAvailable: false, authenticatedForIntent: false, initializing: false };

  function closeOrReturn() {
    global.close();
    setTimeout(() => {
      if (document.visibilityState === 'hidden') return;
      byId('pairSuccessMessage').textContent = '电脑正在进入画板。浏览器未允许自动关闭，请手动关闭此标签页或在手机上进入画板。';
    }, 350);
  }

  function setError(message) {
    byId('pairError').textContent = message || '';
    byId('pairError').hidden = !message;
  }

  async function api(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const safeToRetry = method === 'GET' || options.retryNetwork === true;
    const maximumAttempts = safeToRetry ? 2 : 1;
    const { retryNetwork: _retryNetwork, timeoutMs: timeoutOption, ...fetchOptions } = options;
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (state.session?.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['x-csrf-token'] = state.session.csrfToken;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Number(timeoutOption) || REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          cache: 'no-store', credentials: 'same-origin', ...fetchOptions, headers, signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(body.error || `请求失败 (${response.status})`), { code: body.code, status: response.status });
        return body;
      } catch (error) {
        if (error?.code || !['AbortError', 'TypeError'].includes(error?.name)) throw error;
        if (attempt + 1 < maximumAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        throw Object.assign(new Error(timedOut
          ? '请求超时，请检查网络后重试。'
          : global.navigator.onLine === false ? '网络已断开，恢复后可以继续。' : '网络连接不稳定，请稍后重试。'), {
          code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE'
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error('网络连接不稳定，请稍后重试。');
  }

  const isNetworkFailure = (error) => ['REQUEST_TIMEOUT', 'NETWORK_UNAVAILABLE'].includes(error?.code);

  function renderSession() {
    const signedIn = Boolean(state.session?.authenticated);
    const mismatchedIntent = signedIn && state.pairing?.intent !== 'login' && !state.authenticatedForIntent;
    byId('accountMismatchPanel').hidden = !mismatchedIntent;
    byId('signedOutActions').hidden = signedIn || state.pairing?.intent === 'recovery';
    byId('phoneRecoveryForm').hidden = signedIn || state.pairing?.intent !== 'recovery';
    byId('approvalPanel').hidden = !signedIn || mismatchedIntent;
    if (!signedIn) return;
    const user = state.session.user;
    byId('identityAvatar').textContent = Array.from(user.username || 'M')[0].toUpperCase();
    byId('identityName').textContent = user.username;
    byId('identityAccountId').textContent = user.accountId;
    byId('mismatchAccount').textContent = `${user.username}（${user.accountId}）`;
    byId('approveComputerButton').disabled = Boolean(state.recoveryCode) && !byId('recoveryAcknowledged').checked;
  }

  function renderIntent() {
    const intent = state.pairing.intent;
    const providers = state.session?.authProviders || state.pairing?.authProviders || {};
    byId('phoneLoginButton').hidden = intent !== 'login' || providers.passkey === false;
    byId('phoneRegisterButton').hidden = intent !== 'register' || providers.passkey === false || providers.registration === false;
    byId('pairDescription').textContent = intent === 'register'
      ? '在手机上创建 Passkey 和账号，然后授权电脑进入画板。'
      : intent === 'recovery'
        ? '在手机上输入恢复资料并创建新 Passkey，然后授权电脑。'
        : '在手机上验证已有 Passkey，然后授权电脑登录。';
  }

  async function detectPasskey() {
    const supported = Boolean(global.isSecureContext && global.PublicKeyCredential && webAuthn);
    let platform = false;
    if (supported && typeof global.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      try { platform = await global.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch {}
    }
    state.passkeyAvailable = supported && platform;
    byId('phoneLoginButton').disabled = !state.passkeyAvailable;
    byId('phoneRegisterButton').disabled = !state.passkeyAvailable;
    byId('phoneRecoveryForm').querySelector('button').disabled = !state.passkeyAvailable;
    byId('compatibilityStatus').textContent = state.passkeyAvailable
      ? '此手机支持本机 Passkey，可使用指纹、面容或锁屏 PIN 验证。'
      : '当前浏览器无法使用手机 Passkey。请复制链接并用最新版 Chrome、Edge 或 Safari 打开。';
  }

  async function refreshSession() {
    state.session = await api('/api/auth/session');
    renderSession();
  }

  async function loginWithPasskey() {
    if (!state.passkeyAvailable) return;
    const button = byId('phoneLoginButton');
    button.disabled = true;
    setError('');
    try {
      const start = await api('/api/auth/login/options', { method: 'POST' });
      const response = await webAuthn.startAuthentication({ optionsJSON: start.options });
      state.session = await api('/api/auth/login/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flowId: start.flowId, response })
      });
      state.authenticatedForIntent = true;
      renderSession();
    } catch (error) {
      setError(error.name === 'NotAllowedError' ? '已取消手机 Passkey 验证。' : error.message);
    } finally { button.disabled = !state.passkeyAvailable; }
  }

  function showRecoveryKit(result) {
    state.recoveryCode = result.recoveryCode;
    byId('kitAccountId').textContent = result.user.accountId;
    byId('kitRecoveryCode').textContent = result.recoveryCode;
    byId('recoveryAcknowledged').checked = false;
    byId('recoveryKit').hidden = false;
    renderSession();
  }

  async function registerWithPasskey() {
    if (!state.passkeyAvailable) return;
    const button = byId('phoneRegisterButton');
    button.disabled = true;
    setError('');
    try {
      const start = await api('/api/auth/register/options', { method: 'POST' });
      const response = await webAuthn.startRegistration({ optionsJSON: start.options });
      const result = await api('/api/auth/register/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flowId: start.flowId, response })
      });
      state.session = result;
      state.authenticatedForIntent = true;
      showRecoveryKit(result);
    } catch (error) {
      setError(error.name === 'NotAllowedError' ? '已取消手机 Passkey 创建。' : error.message);
    } finally { button.disabled = !state.passkeyAvailable; }
  }

  async function recoverWithPasskey(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    setError('');
    try {
      const start = await api('/api/auth/recovery/start', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: byId('phoneRecoveryAccountId').value, recoveryCode: byId('phoneRecoveryCode').value })
      });
      const response = await webAuthn.startRegistration({ optionsJSON: start.options });
      const result = await api('/api/auth/recovery/finish', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flowId: start.flowId, response })
      });
      state.session = result;
      state.authenticatedForIntent = true;
      byId('phoneRecoveryForm').hidden = true;
      showRecoveryKit(result);
    } catch (error) { setError(error.message || '账号恢复失败'); }
    finally { button.disabled = !state.passkeyAvailable; }
  }

  function recoveryText() {
    return `Muse Board 账号恢复资料\n\n账号 ID：${state.session?.user?.accountId || ''}\n用户名：${state.session?.user?.username || ''}\n恢复码：${state.recoveryCode}\n\n请妥善保存，不要发送给他人。\n`;
  }

  async function approveComputer() {
    const button = byId('approveComputerButton');
    button.disabled = true;
    setError('');
    try {
      await api('/api/auth/pair/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approveToken: state.token })
      });
      sessionStorage.removeItem(PAIR_TOKEN_KEY);
      byId('approvalPanel').hidden = true;
      byId('recoveryKit').hidden = true;
      byId('successPanel').hidden = false;
      byId('successPanel').focus({ preventScroll: true });
      setTimeout(closeOrReturn, 900);
    } catch (error) {
      setError(error.message || '授权失败，请回到电脑重新生成二维码。');
      button.disabled = false;
    }
  }

  async function switchAccountForIntent() {
    const button = byId('switchPairAccountButton');
    button.disabled = true;
    setError('');
    try {
      await api('/api/auth/logout', { method: 'POST' });
      state.session = { authenticated: false, authProviders: state.session?.authProviders || state.pairing?.authProviders || {} };
      state.authenticatedForIntent = false;
      renderSession();
    } catch (error) {
      setError(error.message || '无法退出当前账号，请刷新后重试。');
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    if (state.initializing) return;
    const fragmentToken = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    if (fragmentToken) {
      sessionStorage.setItem(PAIR_TOKEN_KEY, fragmentToken);
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    }
    state.token = fragmentToken || sessionStorage.getItem(PAIR_TOKEN_KEY) || '';
    if (!state.token) { setError('二维码链接不完整，请在电脑端重新生成。'); return; }
    state.initializing = true;
    byId('retryPairButton').hidden = true;
    setError('');
    try {
      state.pairing = await api('/api/auth/pair/inspect', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approveToken: state.token }), retryNetwork: true
      });
      byId('verificationCode').textContent = state.pairing.verificationCode;
      renderIntent();
      await Promise.all([detectPasskey(), refreshSession()]);
    } catch (error) {
      setError(error.message || '二维码已失效。');
      byId('retryPairButton').hidden = !isNetworkFailure(error);
    } finally {
      state.initializing = false;
    }
  }

  byId('phoneLoginButton').addEventListener('click', loginWithPasskey);
  byId('phoneRegisterButton').addEventListener('click', registerWithPasskey);
  byId('phoneRecoveryForm').addEventListener('submit', recoverWithPasskey);
  byId('approveComputerButton').addEventListener('click', approveComputer);
  byId('closePairButton').addEventListener('click', closeOrReturn);
  byId('switchPairAccountButton').addEventListener('click', switchAccountForIntent);
  byId('retryPairButton').addEventListener('click', initialize);
  global.addEventListener('online', () => {
    if (!byId('retryPairButton').hidden) void initialize();
  });
  byId('recoveryAcknowledged').addEventListener('change', renderSession);
  byId('copyRecoveryButton').addEventListener('click', () => navigator.clipboard.writeText(recoveryText()).catch(() => setError('复制失败，请手动保存。')));
  byId('downloadRecoveryButton').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([recoveryText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `muse-board-${state.session.user.accountId}-recovery.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  void initialize();
})(window);
