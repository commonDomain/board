import { isGuestMode } from './account-lifecycle.js';
import { els } from './elements.js';
import { focusNavigatorTarget } from './focus.js';
import { getViewportDropPoint } from './geometry.js';
import { openAdaptiveDialog } from './interface.js';
import { refreshIcons, showToast } from './interface-model.js';

import { closePopovers } from './popovers.js';
import { renderItem } from './rendering.js';
import { selectItem, updateSelectionUI } from './selection.js';
import { state } from './state.js';
import { cssEscape } from './utilities.js';

import { xmindRequest, safeLocaleDate } from './xmind-connection-model.js';

let addMindMapItem,
  detachLinkedXmindItem,
  scheduleXmindAutoSync,
  scheduleXmindRemoteCheck;

function configureXmindConnection(callbacks) {
  ({
    addMindMapItem,
    detachLinkedXmindItem,
    scheduleXmindAutoSync,
    scheduleXmindRemoteCheck
  } = callbacks);
}

async function refreshXmindConnectionStatus() {
  if (isGuestMode()) {
    state.xmindConnection = { enabled: false, connected: false, guest: true };
    renderXmindConnectionStatus();
    return state.xmindConnection;
  }
  if (state.xmindStatusRefresh) return state.xmindStatusRefresh;
  state.xmindStatusRefresh = (async () => {
    try {
      state.xmindConnection = await xmindRequest('/api/xmind/status');
    } catch {
      state.xmindConnection = { enabled: false, connected: false };
    }
    renderXmindConnectionStatus();
    return state.xmindConnection;
  })();
  try {
    return await state.xmindStatusRefresh;
  } finally {
    state.xmindStatusRefresh = null;
    renderXmindConnectionStatus();
  }
}

function renderXmindConnectionStatus() {
  const status = state.xmindConnection || {};
  if (!els.connectXmindButton) return;
  if (state.xmindOAuthFlow) {
    els.xmindConnectionLabel.textContent = '正在连接 XMind';
    els.xmindConnectionHint.textContent = '请在授权窗口完成操作';
    els.connectXmindButton.dataset.status = 'authorizing';
  } else if (status.guest) {
    els.xmindConnectionLabel.textContent = '登录后连接 XMind';
    els.xmindConnectionHint.textContent = 'OAuth 凭证仅保存在个人账户下';
    els.connectXmindButton.dataset.status = 'guest';
  } else if (!status.enabled) {
    els.xmindConnectionLabel.textContent = 'XMind 连接未启用';
    els.xmindConnectionHint.textContent = '本地文件导入仍可正常使用';
    els.connectXmindButton.dataset.status = 'disabled';
  } else if (status.reauthorize) {
    els.xmindConnectionLabel.textContent = '需要重新授权';
    els.xmindConnectionHint.textContent = '画板内容不会丢失';
    els.connectXmindButton.dataset.status = 'reauthorize';
  } else if (status.connected) {
    els.xmindConnectionLabel.textContent = '浏览最近脑图';
    els.xmindConnectionHint.textContent = `已连接${status.providerLabel || 'XMind 账号'}`;
    els.connectXmindButton.dataset.status = 'connected';
  } else {
    els.xmindConnectionLabel.textContent = 'XMind个人账户';
    els.xmindConnectionHint.textContent = '安全授权后读取最近脑图';
    els.connectXmindButton.dataset.status = 'disconnected';
  }
  if (els.disconnectXmindButton) els.disconnectXmindButton.hidden = !status.connected && !status.reauthorize;
  els.connectXmindButton.setAttribute('aria-busy', String(Boolean(state.xmindStatusRefresh || state.xmindOAuthFlow)));
  refreshRenderedXmindAccess();
  if (status.connected && !status.reauthorize) {
    scheduleXmindRemoteCheck(1200);
    scheduleXmindAutoSync(1800);
  } else {
    if (state.xmindRemoteCheckTimer) clearTimeout(state.xmindRemoteCheckTimer);
    state.xmindRemoteCheckTimer = null;
    state.xmindRemoteCheckForceRequested = false;
  }
}

function refreshRenderedXmindAccess() {
  let selectedChanged = false;
  for (const item of state.items.values()) {
    if (item.type !== 'mindmap' || item.source?.provider !== 'xmind') continue;
    const mounted = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
    if (mounted) renderItem(item);
    if (state.selectedId === item.id || state.selectedIds.has(item.id)) selectedChanged = true;
  }
  if (selectedChanged) updateSelectionUI();
}

function openXmindProviderDialog() {
  closePopovers();
  els.xmindProviderDialog.hidden = false;
  refreshIcons(els.xmindProviderDialog);
  requestAnimationFrame(() => els.xmindProviderDialog.querySelector('[data-xmind-provider]')?.focus());
}

function closeXmindProviderDialog() {
  els.xmindProviderDialog.hidden = true;
}

async function openXmindConnection() {
  closePopovers();
  if (isGuestMode()) {
    window.MuseAccount?.showAuth?.();
    showToast('登录后才能连接 XMind');
    return;
  }
  els.connectXmindButton.dataset.loading = 'true';
  const latestStatus = await refreshXmindConnectionStatus();
  delete els.connectXmindButton.dataset.loading;
  if (!latestStatus?.enabled) {
    showToast('XMind MCP 尚未在服务器启用');
    return;
  }
  if (!latestStatus.connected || latestStatus.reauthorize) {
    openXmindProviderDialog();
    return;
  }
  await openXmindBrowser();
}

async function startXmindOAuth(provider = state.xmindConnection?.provider || 'global') {
  if (state.xmindOAuthFlow) {
    state.xmindOAuthFlow.popup?.focus?.();
    showToast('XMind 授权窗口已打开');
    return;
  }
  try {
    closeXmindProviderDialog();
    const { authorizationUrl, providerLabel } = await xmindRequest('/api/xmind/oauth/start', {
      method: 'POST',
      body: { provider }
    });
    let settled = false;
    let closePoll = null;
    let timeout = null;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (closePoll) clearInterval(closePoll);
      if (timeout) clearTimeout(timeout);
      state.xmindOAuthFlow = null;
    };
    const complete = async (reportedOk = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      const status = await refreshXmindConnectionStatus();
      if (status?.connected && !status.reauthorize) {
        state.xmindAutoSyncFailures.clear();
        scheduleXmindAutoSync(250);
        showToast(`${providerLabel || 'XMind'}已连接`);
        await openXmindBrowser();
      } else {
        showToast(reportedOk ? '授权已返回，但连接状态尚未生效，请重试' : 'XMind 授权未完成');
      }
    };
    const onMessage = (event) => {
      if (event.origin !== location.origin || event.data?.type !== 'muse:xmind-oauth') return;
      void complete(Boolean(event.data.ok));
    };
    window.addEventListener('message', onMessage);
    const popup = window.open(authorizationUrl, 'muse-xmind-oauth', 'popup=yes,width=720,height=760');
    if (!popup) {
      cleanup();
      throw new Error('浏览器阻止了授权窗口，请允许本站打开弹窗');
    }
    closePoll = setInterval(() => {
      if (popup.closed) void complete(false);
    }, 750);
    timeout = setTimeout(() => void complete(false), 10 * 60_000);
    state.xmindOAuthFlow = { popup, cleanup };
    renderXmindConnectionStatus();
  } catch (error) {
    showToast(error.message || '无法开始 XMind 授权');
  }
}

async function openXmindBrowser(options = {}) {
  els.xmindBrowserDialog.hidden = false;
  els.xmindBrowserStatus.textContent = '正在读取最近脑图…';
  els.xmindRecentMaps.replaceChildren();
  els.reauthorizeXmindButton.hidden = !state.xmindConnection.reauthorize;
  els.xmindBrowserLoading.hidden = false;
  if (els.xmindConnectionSummary) {
    const connectedAt = safeLocaleDate(state.xmindConnection.connectedAt);
    const providerLabel = state.xmindConnection.providerLabel || 'XMind';
    els.xmindConnectionSummary.textContent = connectedAt
      ? `${providerLabel} · 授权于 ${connectedAt}`
      : `已连接${providerLabel}`;
  }
  els.refreshXmindMapsButton.disabled = true;
  const slowTimer = setTimeout(() => {
    if (!els.xmindBrowserDialog.hidden) els.xmindBrowserStatus.textContent = '仍在连接 XMind，首次读取可能需要十几秒…';
  }, 2_000);
  try {
    const result = await xmindRequest(`/api/xmind/maps${options.force ? '?refresh=1' : ''}`);
    state.xmindMaps = Array.isArray(result.maps) ? result.maps : [];
    renderXmindMaps();
  } catch (error) {
    els.xmindBrowserStatus.textContent = `${error.message || '读取失败'}；可点击刷新重试`;
    if (error.code === 'XMIND_REAUTH_REQUIRED') {
      state.xmindConnection.reauthorize = true;
      els.reauthorizeXmindButton.hidden = false;
      renderXmindConnectionStatus();
    }
  } finally {
    clearTimeout(slowTimer);
    els.xmindBrowserLoading.hidden = true;
    els.refreshXmindMapsButton.disabled = false;
  }
}

function closeXmindBrowser() {
  els.xmindBrowserDialog.hidden = true;
  els.xmindSearchInput.value = '';
  els.xmindRecentMaps.replaceChildren();
}

function renderXmindMaps() {
  const query = String(els.xmindSearchInput?.value || '')
    .trim()
    .toLocaleLowerCase();
  const maps = (state.xmindMaps || []).filter(
    (map) =>
      !query ||
      String(map.name || map.title || '')
        .toLocaleLowerCase()
        .includes(query)
  );
  els.xmindRecentMaps.replaceChildren();
  maps.forEach((map) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'xmind-map-choice';
    button.setAttribute('role', 'option');
    const preview = document.createElement('span');
    preview.className = 'xmind-map-preview';
    preview.textContent = 'XM';
    if (map.thumbnailAvailable) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = `/api/xmind/maps/${encodeURIComponent(map.id)}/thumbnail`;
      image.addEventListener(
        'load',
        () => {
          preview.textContent = '';
          preview.appendChild(image);
        },
        { once: true }
      );
    }
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = map.name || map.title || '未命名脑图';
    const detail = document.createElement('small');
    const openedAt = safeLocaleDate(map.lastOpenedAt);
    detail.textContent = openedAt ? `最近打开 · ${openedAt}` : 'XMind 最近脑图';
    copy.append(title, detail);
    const action = document.createElement('small');
    action.textContent = '读取';
    button.append(preview, copy, action);
    button.addEventListener('click', () => readXmindMap(map, button));
    els.xmindRecentMaps.appendChild(button);
  });
  els.xmindBrowserStatus.textContent = maps.length ? `显示 ${maps.length} 个最近脑图` : '最近脑图中没有匹配项';
}

function setMindmapPlacementLoading(visible, text = '正在读取并放置脑图…') {
  if (!els.mindmapPlacementLoading) return;
  els.mindmapPlacementLoading.hidden = !visible;
  const label = els.mindmapPlacementLoading.querySelector('strong');
  if (label) label.textContent = text;
}

async function readXmindMap(map, button) {
  button.disabled = true;
  button.dataset.loading = 'true';
  setMindmapPlacementLoading(true);
  els.xmindBrowserStatus.textContent = '正在读取 XMind 最新内容…';
  try {
    const existing = Array.from(state.items.values()).find(
      (item) =>
        item.type === 'mindmap' &&
        item.source?.provider === 'xmind' &&
        item.source.remoteMapId === map.id &&
        item.source.accountProvider === (state.xmindConnection?.provider || 'global')
    );
    if (existing) {
      closeXmindBrowser();
      selectItem(existing.id);
      focusNavigatorTarget(existing);
      showToast('当前画布已连接该 XMind 脑图');
      return;
    }
    const result = await xmindRequest(`/api/xmind/maps/${encodeURIComponent(map.id)}/read`, {
      method: 'POST',
      body: { boardId: state.boardId }
    });
    const source = {
      provider: 'xmind',
      remoteMapId: result.remoteMapId || map.id,
      remoteName: result.title || map.name || map.title || 'XMind 脑图',
      connectedUserId: window.MuseAccount?.session?.user?.id || '',
      accountProvider: state.xmindConnection?.provider || 'global',
      remoteHash: result.hash || '',
      syncFidelity: result.fidelity || 'hierarchy-fallback',
      localOnlyFields: ['note', 'status'].filter((field) => result.syncCapabilities?.[field] !== true),
      syncState: 'synced',
      syncedAt: Date.now()
    };
    const created = addMindMapItem(getViewportDropPoint(520, 300), result.tree, {
      branchStyle: result.branchStyle || 'curve',
      layoutMode: result.layoutMode || 'mindmap',
      relations: result.relations || [],
      source
    });
    if (created) {
      closeXmindBrowser();
      selectItem(created.id);
      requestAnimationFrame(() => focusNavigatorTarget(created));
      showToast(
        result.fidelity === 'native-structured'
          ? '已读取 XMind 原生结构与可用样式；修改后需确认同步'
          : '已读取 XMind 结构；未返回完整原生样式'
      );
    }
  } catch (error) {
    els.xmindBrowserStatus.textContent = error.message;
  } finally {
    button.disabled = false;
    delete button.dataset.loading;
    setMindmapPlacementLoading(false);
  }
}

async function disconnectXmind() {
  const confirmed = await openAdaptiveDialog({
    mode: 'confirm',
    title: '断开 XMind 连接？',
    message:
      '只会删除本站保存的授权凭证，不会撤销 XMind 账号侧授权，也不会删除原图。画板中的连接脑图会保存为可继续编辑的普通本地副本。',
    confirmLabel: '删除本站凭证',
    danger: true
  });
  if (!confirmed) return;
  try {
    const userId = window.MuseAccount?.session?.user?.id || '';
    const linkedItems = Array.from(state.items.values()).filter(
      (item) =>
        item.type === 'mindmap' &&
        item.source?.provider === 'xmind' &&
        String(item.source.connectedUserId || '') === String(userId)
    );
    for (const item of linkedItems) {
      const detached = await detachLinkedXmindItem(item, { confirmed: true, silent: true });
      if (!detached) throw new Error('脑图副本保存失败，未删除本站凭证');
    }
    await xmindRequest('/api/xmind/connection', { method: 'DELETE' });
    closeXmindBrowser();
    await refreshXmindConnectionStatus();
    showToast(
      linkedItems.length ? `已断开 XMind 连接，${linkedItems.length} 个脑图已保存为可编辑副本` : '已断开 XMind 连接'
    );
  } catch (error) {
    showToast(error.message);
  }
}
export {
  refreshXmindConnectionStatus,
  renderXmindConnectionStatus,
  refreshRenderedXmindAccess,
  openXmindProviderDialog,
  closeXmindProviderDialog,
  openXmindConnection,
  startXmindOAuth,
  openXmindBrowser,
  closeXmindBrowser,
  renderXmindMaps,
  setMindmapPlacementLoading,
  readXmindMap,
  disconnectXmind
};

export { configureXmindConnection };
