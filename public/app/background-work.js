import { state } from './state.js';

const deferred = new Map();
const suspenders = new Map();
let frozen = false, wired = false;

function isBackgroundWorkSuspended() {
  return Boolean(document.hidden || frozen);
}

// Only disposable presentation/read work belongs here. Model updates, version
// checks, ACK processing and durable drafts never pass through this queue.
function deferBackgroundWork(key, callback) {
  if (state.exporting && key === 'canvas' || !isBackgroundWorkSuspended()) { deferred.delete(key); return false; }
  deferred.set(key, { callback, boardId: state.boardId, epoch: state.canvasEpoch });
  return true;
}

function flushBackgroundWork() {
  if (isBackgroundWorkSuspended()) return;
  // Rendering the current model can consume other queued presentation work.
  const canvas = deferred.get('canvas');
  const entries = canvas ? [['canvas', canvas], ...deferred] : [...deferred];
  for (const [key, entry] of entries) {
    if (deferred.get(key) !== entry) continue;
    deferred.delete(key);
    if (entry.boardId !== state.boardId || entry.epoch !== state.canvasEpoch) continue;
    try { entry.callback(); }
    catch (error) { console.warn('Could not resume background work', key, error); }
  }
}

function registerBackgroundSuspender(key, callback) {
  suspenders.set(key, callback);
}

function clearBackgroundWork() { deferred.clear(); }

function wireBackgroundWork() {
  if (wired) return;
  wired = true;
  const update = () => {
    if (isBackgroundWorkSuspended()) for (const callback of suspenders.values()) callback();
    else flushBackgroundWork();
  };
  document.addEventListener('visibilitychange', update);
  document.addEventListener('freeze', () => { frozen = true; update(); });
  document.addEventListener('resume', () => { frozen = false; update(); });
  window.addEventListener('pageshow', () => { frozen = false; update(); });
}

export { deferBackgroundWork, flushBackgroundWork, registerBackgroundSuspender, clearBackgroundWork,
  isBackgroundWorkSuspended, wireBackgroundWork };
