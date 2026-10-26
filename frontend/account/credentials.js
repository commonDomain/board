import { byId } from './dom.js';
import { request } from './request.js';
import { state, webAuthn } from './state.js';
import { escapeAttribute, escapeHtml, refreshIcons, setError } from './view.js';

function renderPasskeys(passkeys) {
  state.session.passkeys = passkeys;
  const list = byId('passkeyList');
  list.textContent = '';
  for (const passkey of passkeys) {
    const row = document.createElement('div');
    row.className = 'passkey-row';
    row.innerHTML = `<i data-lucide="key-round" aria-hidden="true"></i><div><strong>${escapeHtml(passkey.name || 'Passkey')}</strong><small>${passkey.backedUp ? '已同步' : '当前设备'} · ${new Date(passkey.createdAt).toLocaleDateString()}</small></div><button class="rename-passkey" type="button" title="命名 Passkey" aria-label="命名 ${escapeAttribute(passkey.name || 'Passkey')}"><i data-lucide="pencil" aria-hidden="true"></i></button><button class="delete-passkey" type="button" title="删除 Passkey" aria-label="删除 ${escapeAttribute(passkey.name || 'Passkey')}" ${passkeys.length <= 1 ? 'disabled' : ''}><i data-lucide="trash-2" aria-hidden="true"></i></button>`;
    row.querySelector('.rename-passkey').addEventListener('click', () => beginRenamePasskey(row, passkey));
    row.querySelector('.delete-passkey').addEventListener('click', () => deletePasskey(passkey.id));
    list.appendChild(row);
  }
  refreshIcons(list);
}

function beginRenamePasskey(row, passkey) {
  const container = row.querySelector('div');
  const input = document.createElement('input');
  input.value = passkey.name || 'Passkey';
  input.maxLength = 40;
  input.setAttribute('aria-label', 'Passkey 名称');
  container.querySelector('strong').replaceWith(input);
  input.focus();
  input.select();
  let saving = false;
  const save = async () => {
    if (saving) return;
    saving = true;
    try {
      const result = await request(`/api/me/passkeys/${encodeURIComponent(passkey.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: input.value })
      });
      renderPasskeys(result.passkeys);
    } catch (error) {
      setError(byId('profileError'), error.message);
      renderPasskeys(state.session.passkeys);
    }
  };
  input.addEventListener('blur', save, { once: true });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      saving = true;
      renderPasskeys(state.session.passkeys);
    }
  });
}

async function addPasskey() {
  if (!webAuthn) throw new Error('当前浏览器不支持 Passkey。');
  const authorization = await obtainRecentAuth('add-passkey');
  const start = await request('/api/me/passkeys/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recentAuthToken: authorization.recentAuthToken })
  });
  const response = await webAuthn.startRegistration({ optionsJSON: start.options });
  const result = await request('/api/me/passkeys/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowId: start.flowId, response })
  });
  state.session.passkeys = result.passkeys || [];
  renderPasskeys(result.passkeys);
}

async function sensitiveAction(action, targetId = null) {
  if (!webAuthn) throw new Error('当前浏览器不支持 Passkey。');
  const start = await request('/api/me/security/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, targetId })
  });
  const response = await webAuthn.startAuthentication({ optionsJSON: start.options });
  return request('/api/me/security/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowId: start.flowId, response })
  });
}

function hasPasskeys() {
  return Boolean(state.session?.passkeys?.length);
}

function closeRecentAuth(error = null) {
  const pending = state.recentAuth;
  state.recentAuth = null;
  byId('recentAuthDialog').hidden = true;
  if (error) pending?.reject?.(error);
}

function requestRecoveryAuthorization(action) {
  return new Promise((resolve, reject) => {
    state.recentAuth = { action, resolve, reject };
    byId('recentAuthForm').reset();
    setError(byId('recentAuthError'), '');
    byId('recentAuthDescription').textContent =
      action === 'add-passkey'
        ? '添加新的 Passkey 会扩大账号登录权限，请输入恢复码继续。'
        : '绑定或更换邮箱会新增登录方式，请输入恢复码继续。';
    byId('recentAuthDialog').hidden = false;
    requestAnimationFrame(() => byId('recentAuthRecoveryCode').focus({ preventScroll: true }));
  });
}

async function obtainRecentAuth(action, recoveryCode = '') {
  if (hasPasskeys()) return sensitiveAction(`authorize-${action}`);
  const code = recoveryCode || (await requestRecoveryAuthorization(action));
  return request('/api/me/security/recovery', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, recoveryCode: code })
  });
}

async function deletePasskey(id) {
  try {
    const result = await sensitiveAction('delete-passkey', id);
    state.session.passkeys = result.passkeys || [];
    renderPasskeys(result.passkeys);
  } catch (error) {
    setError(byId('profileError'), error.message || '删除 Passkey 失败');
  }
}

export {
  addPasskey,
  beginRenamePasskey,
  closeRecentAuth,
  deletePasskey,
  hasPasskeys,
  obtainRecentAuth,
  renderPasskeys,
  requestRecoveryAuthorization,
  sensitiveAction
};
