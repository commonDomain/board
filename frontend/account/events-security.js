import { renderIdentity } from './identity.js';
import { closeAccountMenu } from './account-menu.js';
import { showAuth } from './auth-view.js';
import { byId } from './dom.js';
import { closeRecentAuth } from './credentials.js';
import { closeDeleteAccountDialog, openDeleteAccountDialog } from './profile.js';
import { request } from './request.js';
import {
  closeSessionConfirmation,
  confirmSessionAction,
  openSessionConfirmation,
  refreshSessions
} from './sessions.js';
import { global, state } from './state.js';
import { setError } from './view.js';

function wireSecurityEvents() {
  byId('logoutButton').addEventListener('click', () => {
    closeAccountMenu();
    openSessionConfirmation(null, 'logout');
  });
  byId('refreshSessionsButton').addEventListener('click', () =>
    refreshSessions({ showFeedback: true }).catch((error) => setError(byId('profileError'), error.message))
  );
  byId('logoutOtherSessionsButton').addEventListener('click', () => openSessionConfirmation(null, 'others'));
  byId('cancelSessionConfirmButton').addEventListener('click', closeSessionConfirmation);
  byId('confirmSessionButton').addEventListener('click', () => {
    void confirmSessionAction();
  });
  byId('cancelRecentAuthButton').addEventListener('click', () => closeRecentAuth(new Error('已取消身份确认')));
  byId('recentAuthForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = byId('recentAuthRecoveryCode').value.trim();
    if (!code) {
      setError(byId('recentAuthError'), '请输入恢复码。');
      byId('recentAuthRecoveryCode').focus();
      return;
    }
    const pending = state.recentAuth;
    state.recentAuth = null;
    byId('recentAuthDialog').hidden = true;
    pending?.resolve?.(code);
  });
  byId('openDeleteAccountButton').addEventListener('click', openDeleteAccountDialog);
  byId('cancelDeleteAccountButton').addEventListener('click', closeDeleteAccountDialog);
  byId('deleteAccountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const accountId = byId('deleteAccountId').value.trim();
    const recoveryCode = byId('deleteAccountRecoveryCode').value.trim();
    setError(byId('deleteAccountError'), '');
    if (!accountId || !recoveryCode) {
      setError(byId('deleteAccountError'), '请输入账号 ID 和恢复码。');
      (!accountId ? byId('deleteAccountId') : byId('deleteAccountRecoveryCode')).focus();
      return;
    }
    const button = byId('confirmDeleteAccountButton');
    button.disabled = true;
    try {
      await request('/api/me/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId, recoveryCode })
      });
      await global.MuseNotebook?.clearAccount?.(state.session?.user?.id);
      await global.WhiteboardStorage?.clearScope?.(`user:${state.session?.user?.id || ''}`);
      state.session = null;
      state.mode = 'pending';
      byId('deleteAccountDialog').hidden = true;
      byId('profileDialog').hidden = true;
      global.dispatchEvent(new CustomEvent('muse:logout'));
      global.WhiteboardStorage?.setScope('expired');
      renderIdentity();
      showAuth('账号已删除。');
    } catch (error) {
      setError(byId('deleteAccountError'), error.message || '账号删除失败');
    } finally {
      button.disabled = false;
    }
  });
}
export { wireSecurityEvents };
