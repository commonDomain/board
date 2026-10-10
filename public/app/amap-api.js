import { isGuestMode } from './account-lifecycle.js';
import { els } from './elements.js';
import { state } from './state.js';

async function refreshAmapCapabilities() {
  if (isGuestMode()) {
    state.amapCapabilities = { enabled: false, reason: 'AUTH_REQUIRED', itemLimit: 3 };
    updateAmapAvailability();
    return;
  }
  try {
    const response = await fetch('/api/navigation/capabilities', { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    state.amapCapabilities = response.ok ? body : { enabled: false, reason: body.code || 'UNAVAILABLE', itemLimit: 3 };
  } catch {
    state.amapCapabilities = { enabled: false, reason: 'NETWORK_UNAVAILABLE', itemLimit: 3 };
  }
  updateAmapAvailability();
}

function updateAmapAvailability() {
  if (!els.navigationButton) return;
  const guest = isGuestMode();
  const enabled = state.amapCapabilities?.enabled === true;
  els.navigationButton.classList.toggle('is-unavailable', !enabled);
  els.navigationButton.title = guest
    ? '登录后使用地图、搜索和路线规划'
    : enabled
      ? '地图、搜索和路线规划'
      : '导航服务尚未配置或暂时不可用';
  if (els.navigationMenuStatus) {
    els.navigationMenuStatus.textContent = guest
      ? '登录后可使用导航工具'
      : enabled
        ? `每类最多创建 ${state.amapCapabilities.itemLimit || 3} 个`
        : '管理员尚未启用高德地图服务';
  }
}

async function amapRequest(pathname, body) {
  const response = await fetch(pathname, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(window.MuseAccount?.csrfToken() ? { 'x-csrf-token': window.MuseAccount.csrfToken() } : {})
    },
    body: JSON.stringify({ boardId: state.boardId, ...body })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || '导航服务请求失败');
    error.code = result.code;
    error.resetAt = result.resetAt;
    throw error;
  }
  return result;
}

export { amapRequest, refreshAmapCapabilities, updateAmapAvailability };
