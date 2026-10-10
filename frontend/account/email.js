import { byId } from './dom.js';
import { maybeOfferGuestImport } from './guest-import.js';
import { renderProfile } from './profile.js';
import { showRecoveryKit } from './recovery.js';
import { isNetworkFailure, request } from './request.js';
import { applySession } from './session.js';
import { global, state } from './state.js';
import { refreshIcons, setError } from './view.js';
import {
  stopEmailResendTimer,
  stopEmailClaimPoll,
  storeEmailClaim,
  clearEmailClaim,
  resetEmailAuthState,
  startEmailResendCountdown
} from './email-state.js';

function scheduleEmailClaimPoll(delay = 1500) {
  stopEmailClaimPoll();
  state.emailClaimTimer = setTimeout(() => {
    void pollEmailClaim();
  }, delay);
}

async function finishEmailClaim(result) {
  const intent = state.emailClaim?.intent;
  clearEmailClaim();
  stopEmailResendTimer();
  if (intent === 'bind' || result.intent === 'bind') {
    if (state.session) state.session.email = result.email;
    byId('emailManageStatus').textContent = '邮箱验证成功。';
    byId('emailManageDialog').hidden = true;
    renderProfile();
    return;
  }
  applySession(result);
  await maybeOfferGuestImport();
  global.dispatchEvent(new CustomEvent('muse:login'));
  state.resolveStartup?.({ mode: 'account', user: result.user });
  state.resolveStartup = null;
  if (result.created && result.recoveryCode) void showRecoveryKit(result.recoveryCode);
}

async function pollEmailClaim(confirmAccountSwitch = false) {
  const claim = state.emailClaim;
  if (!claim) return;
  if (Number(claim.expiresAt) <= Date.now()) {
    clearEmailClaim();
    if (claim.intent === 'bind') setError(byId('emailManageError'), '邮箱链接已过期，请重新发送。');
    else {
      setError(byId('authError'), '邮箱链接已过期，请重新发送。');
      resetEmailAuthState();
    }
    return;
  }
  try {
    const result = await request('/api/auth/email/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: claim.requestId, claimToken: claim.claimToken, confirmAccountSwitch })
    });
    if (result.status === 'pending') {
      scheduleEmailClaimPoll();
      return;
    }
    await finishEmailClaim(result);
  } catch (error) {
    if (error.code === 'ACCOUNT_SWITCH_CONFIRMATION_REQUIRED') {
      stopEmailClaimPoll();
      byId('emailSentState').hidden = true;
      byId('emailAccountSwitchState').hidden = false;
      refreshIcons(byId('emailAccountSwitchState'));
      byId('confirmEmailAccountSwitch').focus({ preventScroll: true });
      return;
    }
    if (isNetworkFailure(error) && state.emailClaim) {
      if (claim.intent === 'bind') byId('emailManageStatus').textContent = '网络中断，恢复连接后将自动继续确认。';
      else byId('emailSentTitle').textContent = '等待网络恢复';
      scheduleEmailClaimPoll(2500);
      return;
    }
    clearEmailClaim();
    if (claim.intent === 'bind') {
      setError(byId('emailManageError'), error.message || '邮箱绑定失败，请重新发送。');
    } else {
      resetEmailAuthState();
      setError(byId('authError'), error.message || '邮箱登录失败，请重新发送。');
    }
  }
}

async function sendEmailMagicLink(event) {
  event?.preventDefault?.();
  const form = byId('emailAuthForm');
  const input = byId('authEmail');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const button = byId('emailAuthSubmit');
  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  const buttonIcon = button.querySelector('i, svg');
  if (buttonIcon) {
    buttonIcon.outerHTML = '<i data-lucide="loader-circle" aria-hidden="true"></i>';
    refreshIcons(button);
  }
  setError(byId('authError'), '');
  try {
    const result = await request('/api/auth/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: input.value, intent: state.authIntent })
    });
    state.pendingEmail = input.value.trim();
    storeEmailClaim({
      requestId: result.requestId,
      claimToken: result.claimToken,
      expiresAt: result.expiresAt,
      resendAt: Date.now() + (Number(result.resendAfter) || 60) * 1000,
      email: state.pendingEmail,
      intent: state.authIntent
    });
    byId('emailSentAddress').textContent = state.pendingEmail;
    byId('emailSentTitle').textContent = '请检查你的邮箱';
    byId('emailSentDescription').innerHTML = `魔法链接已发送至 <span id="emailSentAddress"></span>，请保持此页面打开。`;
    byId('emailSentAddress').textContent = state.pendingEmail;
    form.hidden = true;
    byId('emailSentState').hidden = false;
    startEmailResendCountdown(result.resendAfter);
    scheduleEmailClaimPoll(500);
    refreshIcons(byId('emailSentState'));
  } catch (error) {
    setError(byId('authError'), error.message || '邮件暂时无法发送，请稍后重试。');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    const loadingIcon = button.querySelector('i, svg');
    if (loadingIcon) {
      loadingIcon.outerHTML = '<i data-lucide="send" aria-hidden="true"></i>';
      refreshIcons(button);
    }
  }
}

function changeEmailAddress() {
  clearEmailClaim();
  stopEmailResendTimer();
  byId('emailSentState').hidden = true;
  byId('emailAuthForm').hidden = false;
  byId('authEmail').focus({ preventScroll: true });
}

async function resendEmailMagicLink() {
  byId('authEmail').value = state.pendingEmail;
  changeEmailAddress();
  await sendEmailMagicLink();
}
export {
  scheduleEmailClaimPoll,
  finishEmailClaim,
  pollEmailClaim,
  sendEmailMagicLink,
  changeEmailAddress,
  resendEmailMagicLink
};
