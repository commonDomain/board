import { renderIdentity } from './identity.js';
import { byId } from './dom.js';
import { hasPasskeys, renderPasskeys } from './credentials.js';
import { request } from './request.js';
import { applySession } from './session.js';
import { renderSharing } from './sharing.js';
import { state } from './state.js';
import { avatarMarkup, escapeAttribute, refreshIcons, setError } from './view.js';

async function refreshProfile() {
  const payload = await request('/api/me');
  applySession(payload, false);
  renderProfile();
}

async function refreshSharing() {
  if (!state.session || state.authProviders.sharing === false) return null;
  const sharing = await request('/api/sharing');
  renderSharing(sharing);
  return sharing;
}

function acceptUpdatedUser(user) {
  if (!state.session || !user) return;
  state.session.user = user;
  for (const sharing of new Set([state.sharing, state.session.sharing])) {
    if (!sharing?.members) continue;
    sharing.members = sharing.members.map((member) => (member.id === user.id ? { ...member, ...user } : member));
  }
  renderIdentity();
}

function renderProfile() {
  const user = state.session?.user;
  if (!user) return;
  byId('profileUsername').value = user.username;
  byId('profileAccountId').textContent = user.accountId;
  if (state.pendingAvatar?.action === 'set')
    byId('profileAvatarPreview').innerHTML = `<img src="${escapeAttribute(state.pendingAvatar.previewUrl)}" alt="">`;
  else if (state.pendingAvatar?.action === 'remove')
    byId('profileAvatarPreview').innerHTML = avatarMarkup({ ...user, avatarUrl: null }, 'camera');
  else byId('profileAvatarPreview').innerHTML = avatarMarkup(user, 'camera');
  byId('profileAvatarHint').textContent = 'JPEG / PNG / WebP';
  byId('removeAvatarButton').hidden = !user.avatarUrl && state.pendingAvatar?.action !== 'set';
  const email = state.session.email;
  byId('passkeyProfileSection').hidden = state.authProviders.passkey === false;
  byId('sharingProfileSection').hidden = state.authProviders.sharing === false;
  byId('sharingDescription').textContent =
    `一个共享组最多 ${Number(state.authProviders.sharingMaxMembers) || 5} 人，共享码在重新生成前持续有效。`;
  byId('profileEmailBadge').hidden = !email;
  byId('profileEmailValue').textContent = email?.address || '未绑定邮箱';
  byId('openEmailManageButton').hidden = !state.authProviders.email;
  byId('openEmailManageButton').querySelector('span').textContent = email ? '更换邮箱' : '绑定邮箱';
  byId('profileEmailDescription').hidden = false;
  byId('profileEmailDescription').textContent = email
    ? '此邮箱已验证，可用于魔法链接登录。'
    : state.authProviders.email
      ? '绑定验证邮箱后，可随时通过魔法链接登录。'
      : '邮箱登录尚未配置。';
  renderPasskeys(state.session.passkeys || []);
  byId('passkeyDescription').textContent =
    `可使用本机认证器或安全密钥验证，最多 ${Number(state.authProviders.maxPasskeys) || state.session?.limits?.passkeys || 10} 枚。`;
  byId('sessionsDescription').textContent =
    `查看并撤销已登录设备，最多保留 ${Number(state.authProviders.maxSessions) || state.session?.limits?.sessions || 20} 个会话。`;
  renderSharing(state.session.sharing || state.sharing);
  refreshIcons(byId('profileDialog'));
}

function discardPendingAvatar() {
  if (state.pendingAvatar?.previewUrl) URL.revokeObjectURL(state.pendingAvatar.previewUrl);
  state.pendingAvatar = null;
}

function validUsername(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .trim();
  const length = Array.from(normalized).length;
  return length >= 1 && length <= 30 && !/[\p{Cc}\p{Cf}]/u.test(normalized);
}

function openEmailManager() {
  const email = state.session?.email;
  const needsRecovery = !hasPasskeys();
  byId('emailManageTitle').textContent = email ? '更换邮箱' : '绑定邮箱';
  byId('emailManageDescription').textContent = email
    ? `输入新邮箱，${needsRecovery ? '通过恢复码' : '再使用 Passkey'}确认身份后发送验证链接。`
    : `验证邮箱前将${hasPasskeys() ? '使用 Passkey' : '通过恢复码'}确认身份。`;
  byId('profileEmailInput').value = '';
  byId('emailRecoveryCode').value = '';
  byId('emailRecoveryLabel').hidden = !email && !needsRecovery;
  byId('emailRecoveryCode').hidden = !email && !needsRecovery;
  byId('removeEmailButton').hidden = !email;
  setError(byId('emailManageError'), '');
  byId('emailManageStatus').textContent = '';
  byId('emailManageDialog').hidden = false;
  refreshIcons(byId('emailManageDialog'));
  requestAnimationFrame(() => byId('profileEmailInput').focus({ preventScroll: true }));
}

function closeEmailManager() {
  byId('emailManageDialog').hidden = true;
  byId('openEmailManageButton').focus({ preventScroll: true });
}

function openDeleteAccountDialog() {
  byId('deleteAccountForm').reset();
  setError(byId('deleteAccountError'), '');
  byId('deleteAccountDialog').hidden = false;
  requestAnimationFrame(() => byId('deleteAccountId').focus({ preventScroll: true }));
}

function closeDeleteAccountDialog() {
  byId('deleteAccountDialog').hidden = true;
  byId('openDeleteAccountButton').focus({ preventScroll: true });
}
export {
  refreshProfile,
  refreshSharing,
  acceptUpdatedUser,
  renderProfile,
  discardPendingAvatar,
  validUsername,
  openEmailManager,
  closeEmailManager,
  openDeleteAccountDialog,
  closeDeleteAccountDialog
};
