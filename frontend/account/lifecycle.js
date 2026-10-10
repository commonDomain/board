import { initializeAccountChannel } from './channel.js';
import { refreshAccountFromOtherTab } from './account-refresh.js';
import { setAuthIntent, showAuth } from './auth-view.js';
import { byId } from './dom.js';
import { clearEmailClaim, restoreEmailClaim, startEmailResendCountdown } from './email-state.js';
import { scheduleEmailClaimPoll } from './email.js';
import { wireUi } from './events.js';
import { wirePrivacy } from './privacy.js';
import { request } from './request.js';
import { applySession } from './session.js';
import { state } from './state.js';

async function initialize() {
  if (state.startupPromise) return state.startupPromise;
  initializeAccountChannel(refreshAccountFromOtherTab);
  wireUi();
  wirePrivacy();
  state.startupPromise = new Promise((resolve) => {
    state.resolveStartup = resolve;
  });
  try {
    const session = await request('/api/auth/session');
    // A late startup response must not replace a mode the user already chose.
    if (state.mode !== 'pending') return state.startupPromise;
    state.authProviders = session.authProviders || {
      email: false,
      passkey: true,
      registration: true,
      guest: true,
      sharing: true,
      sharingMaxMembers: 5,
      maxAvatarSize: 5242880,
      maxPasskeys: 10,
      maxSessions: 20,
      privacyLockIdleMs: 900000
    };
    setAuthIntent('login');
    const pendingEmailClaim = restoreEmailClaim();
    if (pendingEmailClaim && pendingEmailClaim.intent !== 'bind') setAuthIntent(pendingEmailClaim.intent);
    if (session.authenticated) {
      applySession(session, false);
      state.resolveStartup({ mode: 'account', user: session.user });
      state.resolveStartup = null;
      if (pendingEmailClaim?.intent === 'bind') scheduleEmailClaimPoll(250);
      else if (pendingEmailClaim) clearEmailClaim();
    } else {
      if (pendingEmailClaim && pendingEmailClaim.intent !== 'bind') {
        byId('emailSentState').hidden = false;
        byId('emailAuthForm').hidden = true;
        byId('emailSentTitle').textContent = '等待邮箱确认';
        byId('emailSentDescription').innerHTML =
          `请在邮件中确认 <span id="emailSentAddress"></span>，此浏览器将自动完成登录。`;
        byId('emailSentAddress').textContent = state.pendingEmail;
        startEmailResendCountdown(Math.max(1, Math.ceil((Number(pendingEmailClaim.resendAt) - Date.now()) / 1000)));
      }
      showAuth();
      if (pendingEmailClaim && pendingEmailClaim.intent !== 'bind') scheduleEmailClaimPoll(250);
    }
  } catch {
    if (state.mode === 'pending') showAuth('无法验证登录状态，仍可以以游客身份继续。');
  }
  return state.startupPromise;
}

export { initialize };
