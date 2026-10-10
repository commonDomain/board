import { state } from './state.js';
import { staticAssetUrl } from './utilities.js';

function getGroupDescendantIds(groupId) {
  const ids = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of state.groups.values()) {
      if (group.parentGroupId && ids.has(group.parentGroupId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return ids;
}

function getGroupMemberItemIds(groupId) {
  const groupIds = getGroupDescendantIds(groupId);
  return Array.from(state.items.values())
    .filter((item) => groupIds.has(item.groupId))
    .map((item) => item.id);
}

function runLayoutWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(staticAssetUrl('layout-worker.js'));
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Layout worker timed out'));
    }, 10000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data.items || []);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(event.error || new Error(event.message));
    };
    worker.postMessage(payload);
  });
}
export { getGroupDescendantIds, getGroupMemberItemIds, runLayoutWorker };
