import { showAuth } from './auth-view.js';
import { chooseAvatarCrop } from './avatar.js';
import { byId } from './dom.js';
import { addPasskey, hasPasskeys, obtainRecentAuth, sensitiveAction } from './credentials.js';
import { scheduleEmailClaimPoll } from './email.js';
import { storeEmailClaim } from './email-state.js';
import {
  acceptUpdatedUser,
  closeEmailManager,
  discardPendingAvatar,
  openEmailManager,
  refreshProfile,
  renderProfile,
  validUsername
} from './profile.js';
import { closeAccountMenu } from './account-menu.js';
import { copyText, showRecoveryKit } from './recovery.js';
import { request } from './request.js';
import { refreshSessions } from './sessions.js';
import { state } from './state.js';
import { avatarMarkup, escapeAttribute, refreshIcons, setError } from './view.js';

function wireProfileEvents() {
  byId('openProfileButton').addEventListener('click', async () => {
    closeAccountMenu();
    if (!state.session) {
      showAuth();
      return;
    }
    discardPendingAvatar();
    byId('profileDialog').hidden = false;
    renderProfile();
    requestAnimationFrame(() => byId('closeProfileButton').focus({ preventScroll: true }));
    try {
      await Promise.all([refreshProfile(), refreshSessions()]);
    } catch (error) {
      setError(byId('profileError'), error.message);
    }
  });
  byId('closeProfileButton').addEventListener('click', () => {
    discardPendingAvatar();
    byId('profileDialog').hidden = true;
    byId('accountButton').focus();
  });
  byId('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(byId('profileError'), '');
    const username = byId('profileUsername').value;
    if (!validUsername(username)) {
      byId('profileUsernameHint').classList.add('is-invalid');
      byId('profileUsername').setAttribute('aria-invalid', 'true');
      byId('profileUsername').focus();
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await request('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username })
      });
      acceptUpdatedUser(result.user);
      if (state.pendingAvatar?.action === 'set') {
        const avatarResult = await request('/api/me/avatar', {
          method: 'POST',
          headers: { 'content-type': state.pendingAvatar.blob.type },
          body: state.pendingAvatar.blob
        });
        acceptUpdatedUser(avatarResult.user);
      } else if (state.pendingAvatar?.action === 'remove') {
        const avatarResult = await request('/api/me/avatar', { method: 'DELETE' });
        acceptUpdatedUser(avatarResult.user);
      }
      discardPendingAvatar();
      renderProfile();
    } catch (error) {
      setError(byId('profileError'), error.message);
    } finally {
      button.disabled = false;
    }
  });
  byId('profileUsername').addEventListener('input', () => {
    byId('profileUsernameHint').classList.remove('is-invalid');
    byId('profileUsername').removeAttribute('aria-invalid');
  });
  byId('emailBindForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = byId('profileEmailInput').value.trim();
    const recoveryCode = byId('emailRecoveryCode').value.trim();
    setError(byId('emailManageError'), '');
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(byId('emailManageError'), '请输入有效的邮箱地址。');
      byId('profileEmailInput').focus();
      return;
    }
    if (!hasPasskeys() && !recoveryCode) {
      setError(byId('emailManageError'), '绑定或更换邮箱需要输入恢复码。');
      byId('emailRecoveryCode').focus();
      return;
    }
    const button = byId('bindEmailButton');
    button.disabled = true;
    byId('emailManageStatus').textContent = '';
    try {
      const authorization = await obtainRecentAuth('bind-email', recoveryCode);
      const result = await request('/api/me/email/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, recoveryCode, recentAuthToken: authorization.recentAuthToken })
      });
      storeEmailClaim({
        requestId: result.requestId,
        claimToken: result.claimToken,
        expiresAt: result.expiresAt,
        resendAt: Date.now() + (Number(result.resendAfter) || 60) * 1000,
        email,
        intent: 'bind'
      });
      byId('emailManageStatus').textContent = '验证链接已发送，请保持此页面打开并前往邮箱确认。';
      scheduleEmailClaimPoll(500);
    } catch (error) {
      setError(byId('emailManageError'), error.message || '验证邮件发送失败。');
    } finally {
      button.disabled = false;
    }
  });
  byId('profileAvatarInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(byId('profileError'), '');
    try {
      const maxBytes = Number(state.authProviders.maxAvatarSize) || 5 * 1024 * 1024;
      if (file.size > maxBytes) throw new Error(`头像不能超过 ${Math.max(1, Math.floor(maxBytes / 1024 / 1024))} MB`);
      const cropped = await chooseAvatarCrop(file);
      if (!cropped) {
        event.target.value = '';
        return;
      }
      discardPendingAvatar();
      state.pendingAvatar = { action: 'set', blob: cropped, previewUrl: URL.createObjectURL(cropped) };
      byId('profileAvatarPreview').innerHTML = `<img src="${escapeAttribute(state.pendingAvatar.previewUrl)}" alt="">`;
      byId('removeAvatarButton').hidden = false;
    } catch (error) {
      setError(byId('profileError'), error.message);
    }
    event.target.value = '';
  });
  byId('removeAvatarButton').addEventListener('click', () => {
    discardPendingAvatar();
    state.pendingAvatar = { action: 'remove' };
    byId('profileAvatarPreview').innerHTML = avatarMarkup({ ...state.session.user, avatarUrl: null }, 'camera');
    byId('removeAvatarButton').hidden = true;
    refreshIcons(byId('profileAvatarPreview'));
  });
  byId('copyAccountIdButton').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const label = button.querySelector('span');
    try {
      await copyText(state.session.user.accountId);
      label.textContent = '已复制';
      button.classList.add('is-copied');
      setTimeout(() => {
        label.textContent = '复制';
        button.classList.remove('is-copied');
      }, 1500);
    } catch {
      setError(byId('profileError'), '复制失败，请手动选择账号 ID。');
    }
  });
  byId('openEmailManageButton').addEventListener('click', openEmailManager);
  byId('closeEmailManageButton').addEventListener('click', closeEmailManager);
  byId('cancelEmailManageButton').addEventListener('click', closeEmailManager);
  byId('removeEmailButton').addEventListener('click', async () => {
    const recoveryCode = byId('emailRecoveryCode').value.trim();
    setError(byId('emailManageError'), '');
    if (!recoveryCode) {
      setError(byId('emailManageError'), '请输入恢复码后再解绑邮箱。');
      byId('emailRecoveryCode').focus();
      return;
    }
    try {
      const result = await request('/api/me/email', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recoveryCode })
      });
      state.session.email = result.email;
      closeEmailManager();
      renderProfile();
    } catch (error) {
      setError(byId('emailManageError'), error.message);
    }
  });
  byId('addPasskeyButton').addEventListener('click', () =>
    addPasskey().catch((error) => setError(byId('profileError'), error.message))
  );
  byId('rotateRecoveryButton').addEventListener('click', async () => {
    try {
      const result = await sensitiveAction('rotate-recovery');
      await showRecoveryKit(result.recoveryCode);
    } catch (error) {
      setError(byId('profileError'), error.message);
    }
  });
}
export { wireProfileEvents };
