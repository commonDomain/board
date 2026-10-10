import { isGuestMode } from './account-lifecycle.js';
import { openAdaptiveDialog } from './interface.js';
import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { ensureMindNodeIds, fitMindMapItem } from './mindmap-model.js';
import { renderItem } from './rendering.js';
import { state } from './state.js';
import { cssEscape } from './utilities.js';
import { refreshXmindConnectionStatus, setMindmapPlacementLoading } from './xmind-connection.js';
import { rememberXmindContent, xmindContentFingerprint, xmindRequest } from './xmind-connection-model.js';

async function syncLinkedXmindItem(item) {
  if (!item?.source || item.source.connectedUserId !== window.MuseAccount?.session?.user?.id) return;
  if (!state.xmindConnection?.connected) {
    showToast('请先连接或重新授权 XMind');
    return;
  }
  if (item.source.syncState === 'remote-changed') {
    const boardId = state.boardId;
    if (!(await confirmRemoteXmindLoad(item, false))) return;
    if (state.boardId !== boardId || state.items.get(item.id) !== item || state.syncQueue.length) return;
    const fingerprint = xmindContentFingerprint(item);
    setMindmapPlacementLoading(true, '正在载入 XMind 最新版本…');
    try {
      const latest = await xmindRequest(`/api/xmind/links/${encodeURIComponent(item.id)}/refresh`, {
        method: 'POST',
        body: { boardId }
      });
      if (
        state.boardId !== boardId ||
        state.items.get(item.id) !== item ||
        xmindContentFingerprint(item) !== fingerprint ||
        state.syncQueue.length
      )
        return;
      applyRemoteXmindResult(item, latest);
    } catch (error) {
      showToast(error.message || 'XMind 最新版本读取失败');
    } finally {
      if (state.boardId === boardId) setMindmapPlacementLoading(false);
    }
    return;
  }
  if (state.xmindRemoteAlerts.has(item.id)) {
    await resolveXmindSyncConflict(item);
    return;
  }
  if (!state.joined || state.syncQueue.length || state.resyncing) {
    if (state.syncQueue.blockedReason) {
      showToast('画布同步已暂停，请先处理待同步修改');
      return;
    }
  }
  const boardId = state.boardId;
  clearTimeout(state.xmindAutoSyncTimer);
  state.xmindAutoSyncTimer = null;
  setMindmapPlacementLoading(true, '正在同步到 XMind…');
  try {
    const deadline = Date.now() + 15000;
    while (
      state.boardId === boardId &&
      (!state.joined ||
        state.resyncing ||
        state.syncQueue.length ||
        state.xmindRemoteCheckInFlight ||
        state.xmindAutoSyncInFlight.size)
    ) {
      if (state.syncQueue.blockedReason || Date.now() >= deadline) {
        showToast('画布修改尚未提交，XMind 同步未开始，请稍后重试');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (state.boardId !== boardId) return;
    if (state.xmindRemoteAlerts.has(item.id)) {
      showToast('XMind 远端也有更新，请再次点击同步处理');
      return;
    }
    state.xmindAutoSyncFailures.delete(item.id);
    await syncPendingXmindItems({ itemId: item.id, manual: true });
  } finally {
    if (state.boardId === boardId) setMindmapPlacementLoading(false);
  }
}

function confirmRemoteXmindLoad(item, hadLocalChanges) {
  return openAdaptiveDialog({
    mode: 'confirm',
    title: 'XMind 远端内容已更新',
    message: hadLocalChanges
      ? `「${item.source.remoteName || item.tree?.text || '脑图'}」在 XMind 和画板中都有修改。载入最新版会替换画板结构；取消可保留当前草稿，稍后再处理。`
      : `「${item.source.remoteName || item.tree?.text || '脑图'}」在 XMind 中有新修改。是否现在载入最新版？`,
    confirmLabel: '载入 XMind 最新版本',
    cancelLabel: '稍后处理',
    danger: hadLocalChanges
  });
}

function setXmindBadgeLoading(itemId, loading) {
  const badge = document.querySelector(`.mindmap-card[data-item-id="${cssEscape(itemId)}"] .mindmap-source-badge`);
  if (!badge) return;
  badge.dataset.loading = String(loading);
  badge.disabled =
    loading || state.items.get(itemId)?.source?.connectedUserId !== window.MuseAccount?.session?.user?.id;
  badge.setAttribute('aria-busy', String(loading));
}

function scheduleXmindAutoSync(delay = 1800) {
  clearTimeout(state.xmindAutoSyncTimer);
  if (isGuestMode() || !state.xmindConnection?.connected || state.xmindConnection?.reauthorize) return;
  state.xmindAutoSyncTimer = setTimeout(() => {
    state.xmindAutoSyncTimer = null;
    void syncPendingXmindItems();
  }, delay);
}

async function syncPendingXmindItems(options = {}) {
  if (
    !state.joined ||
    state.resyncing ||
    state.syncQueue.length ||
    !state.xmindConnection?.connected ||
    state.xmindAutoSyncInFlight.size
  )
    return;
  if (state.xmindRemoteCheckInFlight) {
    scheduleXmindAutoSync(1200);
    if (options.manual) showToast('正在检查 XMind 更新，稍后自动同步');
    return;
  }
  const userId = window.MuseAccount?.session?.user?.id;
  const item = Array.from(state.items.values()).find((candidate) => {
    if (
      candidate.type !== 'mindmap' ||
      candidate.source?.provider !== 'xmind' ||
      candidate.source.syncState !== 'pending' ||
      candidate.source.connectedUserId !== userId ||
      state.xmindRemoteAlerts.has(candidate.id) ||
      (options.itemId && candidate.id !== options.itemId)
    )
      return false;
    const failure = state.xmindAutoSyncFailures.get(candidate.id);
    return (
      options.manual ||
      !failure ||
      failure.fingerprint !== xmindContentFingerprint(candidate) ||
      failure.retryAt <= Date.now()
    );
  });
  if (!item) {
    if (options.manual) return;
    const nextRetry = Math.min(
      ...Array.from(state.items.values())
        .filter((candidate) => candidate.source?.provider === 'xmind' && candidate.source.syncState === 'pending')
        .map((candidate) => state.xmindAutoSyncFailures.get(candidate.id)?.retryAt || Infinity)
    );
    if (Number.isFinite(nextRetry)) scheduleXmindAutoSync(Math.max(250, nextRetry - Date.now()));
    return;
  }
  const boardId = state.boardId;
  const fingerprint = xmindContentFingerprint(item);
  state.xmindAutoSyncInFlight.add(item.id);
  setXmindBadgeLoading(item.id, true);
  try {
    const result = await xmindRequest(`/api/xmind/links/${encodeURIComponent(item.id)}/sync`, {
      method: 'POST',
      body: { boardId, expectedHash: item.source.remoteHash }
    });
    if (boardId !== state.boardId) return;
    const current = state.items.get(item.id);
    if (!current || current.source?.provider !== 'xmind') return;
    state.xmindAutoSyncFailures.delete(item.id);
    if (
      xmindContentFingerprint(current) === fingerprint &&
      current.source.syncState === 'pending' &&
      !state.xmindRemoteAlerts.has(item.id)
    ) {
      applyXmindSyncResult(current, result);
    } else {
      current.source.remoteHash = result.hash;
      current.source.syncState = 'pending';
      upsertItem(current, { history: false });
    }
  } catch (error) {
    if (boardId !== state.boardId) return;
    const current = state.items.get(item.id);
    if (!current || current.source?.provider !== 'xmind') return;
    if (error.code === 'XMIND_REAUTH_REQUIRED') void refreshXmindConnectionStatus();
    const previous = state.xmindAutoSyncFailures.get(item.id);
    const attempts = previous?.fingerprint === fingerprint ? previous.attempts + 1 : 1;
    const conflict = error.code === 'XMIND_REMOTE_CONFLICT' || error.code === 'XMIND_VERIFICATION_FAILED';
    state.xmindAutoSyncFailures.set(item.id, {
      fingerprint,
      attempts,
      retryAt: conflict ? Infinity : Date.now() + Math.min(300_000, 15_000 * 2 ** (attempts - 1))
    });
    if (conflict) {
      state.xmindRemoteAlerts.set(item.id, error.details?.remoteHash || 'conflict');
      showToast('XMind 两端都有修改，请点击脑图上的同步按钮处理');
    } else if (attempts === 1) {
      showToast(error.message || 'XMind 自动同步暂时失败，将稍后重试');
    }
  } finally {
    state.xmindAutoSyncInFlight.delete(item.id);
    if (boardId === state.boardId) {
      setXmindBadgeLoading(item.id, false);
      if (!state.xmindAutoSyncTimer) scheduleXmindAutoSync(1800);
    }
  }
}

function applyXmindSyncResult(item, result) {
  item.source.remoteHash = result.hash;
  if (result.syncCapabilities)
    item.source.localOnlyFields = ['note', 'status'].filter((field) => result.syncCapabilities[field] !== true);
  item.source.syncState = 'synced';
  item.source.syncedAt = result.syncedAt || Date.now();
  state.xmindRemoteAlerts.delete(item.id);
  state.xmindAutoSyncFailures.delete(item.id);
  rememberXmindContent(item);
  state.xmindCleanBroadcastIds.add(item.id);
  upsertItem(item, { history: false });
}

function applyRemoteXmindResult(item, result) {
  const localOnlyFields = new Set(
    Array.isArray(item.source?.localOnlyFields) ? item.source.localOnlyFields : ['note', 'status']
  );
  const localValues = new Map();
  const oldStack = item.tree ? [item.tree] : [];
  while (oldStack.length) {
    const node = oldStack.pop();
    localValues.set(
      String(node.id || ''),
      Object.fromEntries(
        [...localOnlyFields].filter((field) => Object.hasOwn(node, field)).map((field) => [field, node[field]])
      )
    );
    oldStack.push(...(Array.isArray(node.children) ? node.children : []));
  }
  item.tree = ensureMindNodeIds(result.tree);
  item.source.localOnlyFields = ['note', 'status'].filter((field) => result.syncCapabilities?.[field] !== true);
  const newLocalOnlyFields = new Set(item.source.localOnlyFields);
  const newStack = item.tree ? [item.tree] : [];
  while (newStack.length) {
    const node = newStack.pop();
    const preserved = localValues.get(String(node.id || '')) || {};
    for (const field of newLocalOnlyFields) {
      if (Object.hasOwn(preserved, field)) node[field] = preserved[field];
    }
    newStack.push(...(Array.isArray(node.children) ? node.children : []));
  }
  item.relations = Array.isArray(result.relations) ? result.relations : [];
  item.layoutMode = result.layoutMode || item.layoutMode || 'mindmap';
  item.branchStyle = result.branchStyle || item.branchStyle || 'curve';
  fitMindMapItem(item);
  applyXmindSyncResult(item, result);
}

function scheduleXmindRemoteCheck(delay = 30_000, force = false) {
  // A focus/visibility return must bypass the short server cache.  Refreshing
  // connection status also schedules a normal check; do not let that later
  // render replace the pending forced check with a cached one.
  if (force) state.xmindRemoteCheckForceRequested = true;
  if (state.xmindRemoteCheckTimer && !force && state.xmindRemoteCheckForceRequested) return;
  if (state.xmindRemoteCheckTimer) clearTimeout(state.xmindRemoteCheckTimer);
  if (isGuestMode() || !state.xmindConnection?.connected || state.xmindConnection?.reauthorize) return;
  state.xmindRemoteCheckTimer = setTimeout(
    () => {
      state.xmindRemoteCheckTimer = null;
      const forceCheck = state.xmindRemoteCheckForceRequested || force;
      state.xmindRemoteCheckForceRequested = false;
      void checkLinkedXmindRemoteChanges({ force: forceCheck });
    },
    Math.max(250, delay)
  );
}

async function checkLinkedXmindRemoteChanges(options = {}) {
  if (state.xmindAutoSyncInFlight.size) {
    scheduleXmindRemoteCheck(3000, true);
    return;
  }
  if (
    state.xmindRemoteCheckInFlight ||
    document.visibilityState === 'hidden' ||
    !state.joined ||
    !state.xmindConnection?.connected
  ) {
    scheduleXmindRemoteCheck();
    return;
  }
  const userId = window.MuseAccount?.session?.user?.id || '';
  const boardId = state.boardId;
  const items = Array.from(state.items.values()).filter(
    (item) =>
      item.type === 'mindmap' &&
      item.source?.provider === 'xmind' &&
      item.source.connectedUserId === userId &&
      item.source.accountProvider === state.xmindConnection.provider
  );
  if (!items.length) {
    scheduleXmindRemoteCheck();
    return;
  }
  const checkToken = ++state.xmindRemoteCheckToken;
  state.xmindRemoteCheckInFlight = true;
  try {
    const result = await xmindRequest('/api/xmind/links/check', {
      method: 'POST',
      body: { boardId, itemIds: items.map((item) => item.id), force: options.force === true }
    });
    if (state.boardId !== boardId) return;
    for (const change of result.changes || []) {
      const item = state.items.get(change.itemId);
      if (!item?.source || state.xmindRemoteAlerts.get(item.id) === change.remoteHash) continue;
      state.xmindRemoteAlerts.set(item.id, change.remoteHash);
      const hadLocalChanges = item.source.syncState === 'pending' || state.syncQueue.length > 0;
      item.source.syncState = hadLocalChanges ? 'pending' : 'remote-changed';
      renderItem(item);
      const loadLatest = await confirmRemoteXmindLoad(item, hadLocalChanges);
      if (!loadLatest) continue;
      const fingerprint = xmindContentFingerprint(item);
      setMindmapPlacementLoading(true, '正在载入 XMind 最新版本…');
      try {
        const latest = await xmindRequest(`/api/xmind/links/${encodeURIComponent(item.id)}/refresh`, {
          method: 'POST',
          body: { boardId: state.boardId }
        });
        if (
          state.boardId !== boardId ||
          state.items.get(item.id) !== item ||
          xmindContentFingerprint(item) !== fingerprint ||
          state.syncQueue.length
        ) {
          showToast('画布已有新修改，请手动处理 XMind 同步');
          continue;
        }
        applyRemoteXmindResult(item, latest);
        state.xmindRemoteAlerts.delete(item.id);
        showToast('已载入 XMind 最新版本');
      } catch (error) {
        showToast(error.message || '无法读取 XMind 最新版本');
      } finally {
        setMindmapPlacementLoading(false);
      }
    }
  } catch (error) {
    if (error.code === 'XMIND_REAUTH_REQUIRED') await refreshXmindConnectionStatus();
    else console.warn('Could not check XMind remote changes', error);
  } finally {
    if (checkToken === state.xmindRemoteCheckToken) {
      state.xmindRemoteCheckInFlight = false;
      scheduleXmindRemoteCheck();
    }
  }
}

async function detachLinkedXmindItem(item, options = {}) {
  const confirmed =
    options.confirmed === true ||
    (await openAdaptiveDialog({
      mode: 'confirm',
      title: '解除连接并保留画板副本？',
      message: '当前脑图会变成普通本地脑图，可继续编辑；不会删除或修改 XMind 中的原图。',
      confirmLabel: '解除并保留副本',
      cancelLabel: '取消'
    }));
  if (!confirmed) return false;
  try {
    await xmindRequest(`/api/xmind/links/${encodeURIComponent(item.id)}/detach`, {
      method: 'POST',
      body: { boardId: state.boardId }
    });
    delete item.source;
    upsertItem(item, { history: false });
    if (!options.silent) showToast('已解除 XMind 连接，画板副本可继续编辑');
    return true;
  } catch (error) {
    if (!options.silent) showToast(error.message || '无法解除 XMind 连接');
    return false;
  }
}

async function resolveXmindSyncConflict(item) {
  const loadLatest = await openAdaptiveDialog({
    mode: 'confirm',
    title: 'XMind 远端已有新修改',
    message:
      '载入最新版本会替换画板中的当前结构。选择“暂不载入”后，还可经过第二次危险确认强制覆盖；取消两次则保留画板修改，稍后处理。',
    confirmLabel: '载入 XMind 最新版本',
    cancelLabel: '暂不载入',
    danger: true
  });
  if (loadLatest) {
    setMindmapPlacementLoading(true, '正在载入 XMind 最新版本…');
    try {
      const latest = await xmindRequest(`/api/xmind/links/${encodeURIComponent(item.id)}/refresh`, {
        method: 'POST',
        body: { boardId: state.boardId }
      });
      applyRemoteXmindResult(item, latest);
      showToast('已载入 XMind 最新版本');
    } catch (error) {
      showToast(error.message || '无法读取 XMind 最新版本');
    } finally {
      setMindmapPlacementLoading(false);
    }
    return;
  }
  const overwrite = await openAdaptiveDialog({
    mode: 'confirm',
    title: '强制覆盖 XMind 远端？',
    message: '这会覆盖其他设备或成员在 XMind 中的最新修改，且写请求不会自动重试。取消将保留画板中的待同步修改。',
    confirmLabel: '确认强制覆盖',
    cancelLabel: '保留画板修改',
    danger: true
  });
  if (!overwrite) {
    const detach = await openAdaptiveDialog({
      mode: 'confirm',
      title: '解除连接并保留画板副本？',
      message:
        '解除后当前内容会变成普通可编辑脑图，不会删除 XMind 中的原图，也不会再与其同步。取消则继续保留待同步状态。',
      confirmLabel: '解除并保留副本',
      cancelLabel: '继续保留连接'
    });
    if (!detach) return;
    await detachLinkedXmindItem(item, { confirmed: true });
    return;
  }
  try {
    const result = await xmindRequest(`/api/xmind/links/${encodeURIComponent(item.id)}/sync`, {
      method: 'POST',
      body: { boardId: state.boardId, expectedHash: item.source.remoteHash, force: true }
    });
    applyXmindSyncResult(item, result);
    showToast('已强制覆盖并同步到 XMind');
  } catch (error) {
    showToast(error.message || '覆盖失败，画板修改仍保留');
  }
}

export {
  applyRemoteXmindResult,
  applyXmindSyncResult,
  checkLinkedXmindRemoteChanges,
  confirmRemoteXmindLoad,
  detachLinkedXmindItem,
  resolveXmindSyncConflict,
  scheduleXmindAutoSync,
  scheduleXmindRemoteCheck,
  setXmindBadgeLoading,
  syncLinkedXmindItem,
  syncPendingXmindItems
};
