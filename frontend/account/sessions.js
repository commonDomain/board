import { renderIdentity } from './identity.js';
import { showAuth } from './auth-view.js';
import { byId } from './dom.js';
import { clearEmailClaim } from './email-state.js';
import { closeAccountMenu } from './account-menu.js';
import { request } from './request.js';
import { global, state } from './state.js';
import { escapeHtml, refreshIcons, setError } from './view.js';

function renderSessions(sessions) {
  const list = byId('sessionList');
  list.textContent = '';
  byId('logoutOtherSessionsButton').hidden = !sessions.some((session) => !session.current);
  for (const session of sessions) {
    const row = document.createElement('div');
    row.className = 'passkey-row session-row';
    const mobile = session.deviceClass === 'mobile';
    const deviceLabel = mobile ? '移动端' : '桌面端';
    const systemName = session.systemName || '未知系统';
    const appName = session.appName || '未知 APP';
    row.innerHTML = `<span class="session-device-icon" role="img" aria-label="${deviceLabel}" title="${deviceLabel}"><i data-lucide="${mobile ? 'smartphone' : 'monitor-smartphone'}" aria-hidden="true"></i></span><div><strong>${escapeHtml(systemName)}${session.current ? '<span class="current-session-badge">当前</span>' : ''}</strong><small>${escapeHtml(appName)} · ${new Date(session.createdAt).toLocaleString()} 登录 · ${new Date(session.expiresAt).toLocaleDateString()} 到期</small></div><button type="button" class="revoke-session">${session.current ? '退出' : '撤销'}</button>`;
    row.querySelector('.revoke-session').addEventListener('click', () => openSessionConfirmation(session));
    list.appendChild(row);
  }
  refreshIcons(list);
}

function openSessionConfirmation(session = null, mode = 'session') {
  state.pendingSession = { session, mode };
  const current = mode === 'logout' || session?.current;
  const others = mode === 'others';
  byId('sessionConfirmTitle').textContent = others
    ? '确认退出其他设备？'
    : current
      ? '确认退出当前会话？'
      : '确认撤销此会话？';
  byId('sessionConfirmDescription').textContent = others
    ? '除当前设备外，所有已登录设备都会立即退出。'
    : current
      ? '退出后需要重新验证身份才能访问账号和画布。'
      : '该设备将立即退出，之后需要重新验证身份。';
  byId('confirmSessionButton').textContent = others ? '退出其他设备' : current ? '确认退出' : '确认撤销';
  setError(byId('sessionConfirmError'), '');
  byId('sessionConfirmDialog').hidden = false;
  requestAnimationFrame(() => byId('cancelSessionConfirmButton').focus({ preventScroll: true }));
}

function closeSessionConfirmation() {
  state.pendingSession = null;
  byId('sessionConfirmDialog').hidden = true;
}

async function performLogout() {
  await global.MuseBoardLifecycle?.prepareAccountExit?.();
  await request('/api/auth/logout', { method: 'POST' });
  clearEmailClaim();
  state.session = null;
  state.mode = 'pending';
  closeAccountMenu();
  closeSessionConfirmation();
  byId('profileDialog').hidden = true;
  global.dispatchEvent(new CustomEvent('muse:logout'));
  global.WhiteboardStorage?.setScope('expired');
  showAuth();
  renderIdentity();
}

async function confirmSessionAction() {
  const pending = state.pendingSession;
  if (!pending) return;
  const button = byId('confirmSessionButton');
  button.disabled = true;
  setError(byId('sessionConfirmError'), '');
  try {
    if (pending.mode === 'logout') {
      await performLogout();
      return;
    }
    if (pending.mode === 'others') {
      const result = await request('/api/me/sessions', { method: 'DELETE' });
      closeSessionConfirmation();
      renderSessions(result.sessions || []);
      return;
    }
    const result = await request(`/api/me/sessions/${pending.session.id}`, { method: 'DELETE' });
    closeSessionConfirmation();
    if (result.currentRevoked) {
      state.session = null;
      state.mode = 'pending';
      byId('profileDialog').hidden = true;
      global.dispatchEvent(new CustomEvent('muse:logout'));
      global.WhiteboardStorage?.setScope('expired');
      showAuth('当前会话已退出。');
      renderIdentity();
    } else renderSessions(result.sessions || []);
  } catch (error) {
    setError(byId('sessionConfirmError'), error.message || '会话操作失败');
  } finally {
    button.disabled = false;
  }
}

async function refreshSessions({ showFeedback = false } = {}) {
  const button = byId('refreshSessionsButton');
  if (showFeedback && button.disabled) return;
  if (showFeedback) {
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
  }
  try {
    const [result] = await Promise.all([
      request('/api/me/sessions'),
      ...(showFeedback ? [new Promise((resolve) => setTimeout(resolve, 360))] : [])
    ]);
    renderSessions(result.sessions || []);
  } finally {
    if (showFeedback) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    }
  }
}

export {
  closeSessionConfirmation,
  confirmSessionAction,
  openSessionConfirmation,
  performLogout,
  refreshSessions,
  renderSessions
};
