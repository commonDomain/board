import { showAuth } from './auth-view.js';
import { byId } from './dom.js';
import { isPhonePasskeyDevice } from './device.js';
import { maybeOfferGuestImport } from './guest-import.js';
import { showRecoveryKit } from './recovery.js';
import { isNetworkFailure, request } from './request.js';
import { applySession } from './session.js';
import { global, state, webAuthn } from './state.js';
import { setError } from './view.js';
import { stopPairingPoll } from './pairing-state.js';

function schedulePairingPoll(delay = 1500) {
  stopPairingPoll();
  if (!state.pairing) return;
  state.pairingTimer = setTimeout(() => {
    void pollPairing();
  }, delay);
}

async function finishPairedLogin(result) {
  state.pairing = null;
  byId('pairingDialog').hidden = true;
  applySession(result);
  await maybeOfferGuestImport();
  global.dispatchEvent(new CustomEvent('muse:login'));
  state.resolveStartup?.({ mode: 'account', user: result.user });
  state.resolveStartup = null;
}

async function pollPairing() {
  const pairing = state.pairing;
  if (!pairing) return;
  if (Date.now() >= pairing.expiresAt) {
    setError(byId('pairingError'), '二维码已过期，请返回后重新生成。');
    byId('pairingStatus').textContent = '授权未完成';
    state.pairing = null;
    return;
  }
  try {
    const result = await request(`/api/auth/pair/status?id=${encodeURIComponent(pairing.id)}`, {
      headers: { 'x-pair-claim-token': pairing.claimToken }
    });
    if (state.pairing !== pairing) return;
    if (result.status === 'approved') {
      byId('pairingStatus').textContent = '手机授权成功，正在进入画板…';
      await finishPairedLogin(result);
      return;
    }
    const seconds = Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
    byId('pairingStatus').textContent = `等待手机确认，二维码将在 ${seconds} 秒后失效`;
  } catch (error) {
    if (state.pairing !== pairing) return;
    if (isNetworkFailure(error)) {
      byId('pairingStatus').textContent = '网络中断，二维码仍然有效；恢复连接后会自动继续。';
      schedulePairingPoll(2500);
      return;
    }
    setError(byId('pairingError'), error.message || '无法查询手机授权状态');
    state.pairing = null;
    return;
  }
  schedulePairingPoll();
}

async function directPasskeyAuth(intent, button) {
  if (!global.isSecureContext || !global.PublicKeyCredential || !webAuthn) {
    throw new Error('当前浏览器无法使用 Passkey，请改用支持 Passkey 的安全浏览器。');
  }
  const register = intent === 'register';
  const start = await request(register ? '/api/auth/register/options' : '/api/auth/login/options', { method: 'POST' });
  const response = register
    ? await webAuthn.startRegistration({ optionsJSON: start.options })
    : await webAuthn.startAuthentication({ optionsJSON: start.options });
  const result = await request(register ? '/api/auth/register/verify' : '/api/auth/login/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowId: start.flowId, response })
  });
  if (register) {
    applySession(result);
    await showRecoveryKit(result.recoveryCode);
    await maybeOfferGuestImport();
    global.dispatchEvent(new CustomEvent('muse:login'));
    state.resolveStartup?.({ mode: 'account', user: result.user });
    state.resolveStartup = null;
  } else {
    await finishPairedLogin(result);
  }
}

async function startPasskeyAuth(intent, button) {
  if (isPhonePasskeyDevice() && intent !== 'recovery') {
    button.disabled = true;
    setError(byId('authError'), '');
    try {
      await directPasskeyAuth(intent, button);
    } catch (error) {
      setError(byId('authError'), error.name === 'NotAllowedError' ? '已取消 Passkey 验证。' : error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }
  await startPairing(intent, button);
}

async function startPairing(intent, button) {
  setError(byId('authError'), '');
  setError(byId('pairingError'), '');
  button.disabled = true;
  try {
    const result = await request('/api/auth/pair/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent })
    });
    if (isPhonePasskeyDevice()) {
      global.location.assign(result.pairUrl);
      return;
    }
    stopPairingPoll();
    state.pairing = result;
    byId('pairingQrImage').src = result.qrDataUrl;
    byId('pairingVerificationCode').textContent = result.verificationCode;
    byId('pairingStatus').textContent = '等待手机扫描并确认…';
    byId('authDialog').hidden = true;
    byId('pairingDialog').hidden = false;
    requestAnimationFrame(() => byId('cancelPairingButton').focus({ preventScroll: true }));
    void pollPairing();
  } catch (error) {
    setError(byId('authError'), error.message || '二维码生成失败，请重试。');
  } finally {
    button.disabled = false;
  }
}

async function cancelPairing() {
  const pairing = state.pairing;
  stopPairingPoll();
  state.pairing = null;
  byId('pairingDialog').hidden = true;
  if (pairing) {
    try {
      await request('/api/auth/pair/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: pairing.id, claimToken: pairing.claimToken })
      });
    } catch {}
  }
  showAuth();
}
export {
  schedulePairingPoll,
  finishPairedLogin,
  pollPairing,
  directPasskeyAuth,
  startPasskeyAuth,
  startPairing,
  cancelPairing
};
