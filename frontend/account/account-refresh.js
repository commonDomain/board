import { showAuth } from './auth-view.js';
import { request } from './request.js';
import { applySession, expireSession } from './session.js';
import { global, state } from './state.js';

let accountRefreshSerial = 0;

async function refreshAccountFromOtherTab() {
  if (state.mode === 'guest' || (!state.session && !state.refreshingAccount)) return;
  const serial = ++accountRefreshSerial;
  state.refreshingAccount = true;
  expireSession();
  try {
    const session = await request('/api/auth/session');
    if (serial !== accountRefreshSerial || state.mode === 'guest') return;
    if (session.authenticated) {
      applySession(session, false);
      global.dispatchEvent(new CustomEvent('muse:login'));
      state.resolveStartup?.({ mode: 'account', user: session.user });
      state.resolveStartup = null;
    }
  } catch (error) {
    if (serial === accountRefreshSerial && error.code !== 'STALE_ACCOUNT')
      showAuth('其他标签页的账号状态已变化，请重新登录。');
  } finally {
    if (serial === accountRefreshSerial) state.refreshingAccount = false;
  }
}
export { refreshAccountFromOtherTab, accountRefreshSerial };
