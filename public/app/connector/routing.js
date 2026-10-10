import { showToast } from '../interface-model.js';
import { state } from '../state.js';
import { renderItem } from '../rendering.js';

import { effectiveRouteType, inputFor } from './binding.js';
import { stateRuntime } from './runtime/state.js';
import { R, cache, mounted, pending } from './state.js';

function notifyRouteFailure(message) {
  if (stateRuntime.routeWarningShown) return;
  stateRuntime.routeWarningShown = true;
  showToast(message);
}

function markRouteFailure(id, message) {
  const entry = cache.get(id);
  if (!entry) return;
  entry.result = { ...entry.result, conflict: true, failure: message };
  const item = state.items.get(id);
  if (item && mounted(id)) renderItem(item);
}

function disableRouteWorker(message) {
  clearTimeout(stateRuntime.workerTimer);
  stateRuntime.workerTimer = 0;
  stateRuntime.worker?.terminate();
  stateRuntime.worker = null;
  stateRuntime.workerBusy = null;
  const ids = [...pending.keys()];
  pending.clear();
  for (const id of ids) markRouteFailure(id, message);
  notifyRouteFailure(message);
}

function dispatchRoute() {
  if (!stateRuntime.worker || stateRuntime.workerBusy || !pending.size) return;
  const [id, request] = pending.entries().next().value;
  stateRuntime.workerBusy = { id, revision: request.revision };
  try {
    stateRuntime.worker.postMessage({ id, ...request });
    clearTimeout(stateRuntime.workerTimer);
    stateRuntime.workerTimer = setTimeout(() => disableRouteWorker('避障计算超时，当前显示临时路径'), 8e3);
  } catch {
    disableRouteWorker('避障计算不可用，当前显示临时路径');
  }
}

function geometry(item, ends) {
  const effectiveType = effectiveRouteType(item, ends);
  const input = inputFor(item, ends, effectiveType === 'orthogonal' && item.route.avoidance !== false, effectiveType),
    signature = JSON.stringify(input),
    previous = cache.get(item.id);
  if (previous?.signature === signature) return previous.result;
  const revision = ++stateRuntime.serial;
  const result = R.route({ ...input, obstacles: [] });
  if (!stateRuntime.worker && effectiveType === 'orthogonal' && input.obstacles.length) {
    result.conflict = true;
    result.failure = '避障计算不可用，当前显示临时路径';
    notifyRouteFailure(result.failure);
  }
  cache.set(item.id, { signature, result, revision, effectiveType });
  if (stateRuntime.worker && effectiveType === 'orthogonal' && input.obstacles.length) {
    pending.set(item.id, { revision, input });
    dispatchRoute();
  } else {
    pending.delete(item.id);
  }
  return result;
}

export { disableRouteWorker, dispatchRoute, geometry, markRouteFailure, notifyRouteFailure };
