import { renderIdentity } from './identity.js';
import { showAuth } from './auth-view.js';
import { accountChannel } from './channel.js';
import { byId } from './dom.js';
import { stopPairingPoll } from './pairing-state.js';
import { global, state } from './state.js';
import { refreshIcons } from './view.js';

function applySession(payload, announce = true) {
  if (state.session?.user?.id !== payload.user.id) {
    global.MuseBoardLifecycle?.journalAccountExit?.();
    global.dispatchEvent(new CustomEvent('muse:account-changing'));
  }
  stopPairingPoll();
  state.mode = 'account';
  state.session = payload;
  state.sharing = payload.sharing || null;
  global.WhiteboardStorage?.setScope(`user:${payload.user.id}`);
  renderIdentity();
  byId('authDialog').hidden = true;
  document.documentElement.dataset.accountMode = 'account';
  if (announce) accountChannel.publish();
}

async function enterGuest() {
  await global.WhiteboardStorage?.listGuestCanvases();
  state.mode = 'guest';
  state.session = null;
  state.sharing = null;
  global.WhiteboardStorage?.setScope('guest');
  document.documentElement.dataset.accountMode = 'guest';
  byId('authDialog').hidden = true;
  renderIdentity();
  if (global.WhiteboardStorage?.guestStorageIsDurable?.() === false) showGuestStorageWarning();
  state.resolveStartup?.({ mode: 'guest', user: null });
  state.resolveStartup = null;
}

function showGuestStorageWarning() {
  if (byId('guestStorageWarning')) return;
  const warning = document.createElement('div');
  warning.id = 'guestStorageWarning';
  warning.className = 'guest-storage-warning';
  warning.setAttribute('role', 'status');
  warning.innerHTML =
    '<i data-lucide="triangle-alert" aria-hidden="true"></i><span>当前浏览器禁用了 IndexedDB，画布只会临时保留。</span><button type="button">导出当前画布</button>';
  warning.querySelector('button').addEventListener('click', () => byId('exportPngButton')?.click());
  document.body.appendChild(warning);
  refreshIcons(warning);
}

function expireSession() {
  if (!state.session) return;
  global.MuseBoardLifecycle?.journalAccountExit?.();
  state.session = null;
  state.mode = 'pending';
  global.WhiteboardStorage?.setScope('expired');
  state.sharing = null;
  for (const dialog of document.querySelectorAll('.account-overlay')) {
    if (dialog.id !== 'authDialog') dialog.hidden = true;
  }
  renderIdentity();
  global.dispatchEvent(new CustomEvent('muse:auth-expired'));
  showAuth('会话已过期或被撤销，请重新登录。');
}

export { applySession, enterGuest, expireSession, showGuestStorageWarning };
