import { byId } from './dom.js';
import { EMAIL_CLAIM_STORAGE_KEY, global, state } from './state.js';

function stopEmailResendTimer() {
  if (state.emailResendTimer) clearInterval(state.emailResendTimer);
  state.emailResendTimer = null;
}

function stopEmailClaimPoll() {
  if (state.emailClaimTimer) clearTimeout(state.emailClaimTimer);
  state.emailClaimTimer = null;
}

function storeEmailClaim(claim) {
  state.emailClaim = claim;
  try {
    global.sessionStorage.setItem(EMAIL_CLAIM_STORAGE_KEY, JSON.stringify(claim));
  } catch {}
}

function restoreEmailClaim() {
  try {
    const claim = JSON.parse(global.sessionStorage.getItem(EMAIL_CLAIM_STORAGE_KEY) || 'null');
    if (!claim?.requestId || !claim?.claimToken || Number(claim.expiresAt) <= Date.now()) {
      global.sessionStorage.removeItem(EMAIL_CLAIM_STORAGE_KEY);
      return null;
    }
    state.emailClaim = claim;
    state.pendingEmail = String(claim.email || '');
    return claim;
  } catch {
    try {
      global.sessionStorage.removeItem(EMAIL_CLAIM_STORAGE_KEY);
    } catch {}
    return null;
  }
}

function clearEmailClaim() {
  stopEmailClaimPoll();
  state.emailClaim = null;
  try {
    global.sessionStorage.removeItem(EMAIL_CLAIM_STORAGE_KEY);
  } catch {}
}

function resetEmailAuthState() {
  clearEmailClaim();
  stopEmailResendTimer();
  state.pendingEmail = '';
  byId('emailAccountSwitchState').hidden = true;
  byId('emailSentState').hidden = true;
  byId('emailAuthForm').hidden = !state.authProviders.email;
}

function startEmailResendCountdown(seconds) {
  stopEmailResendTimer();
  let remaining = Math.max(1, Number(seconds) || 60);
  const button = byId('resendEmailButton');
  const render = () => {
    button.disabled = remaining > 0;
    button.textContent = remaining > 0 ? `${remaining} 秒后可重新发送` : '重新发送';
  };
  render();
  state.emailResendTimer = setInterval(() => {
    remaining -= 1;
    render();
    if (remaining <= 0) stopEmailResendTimer();
  }, 1000);
}
export {
  stopEmailResendTimer,
  stopEmailClaimPoll,
  storeEmailClaim,
  restoreEmailClaim,
  clearEmailClaim,
  resetEmailAuthState,
  startEmailResendCountdown
};
