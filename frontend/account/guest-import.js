import { byId } from './dom.js';
import { accountGenerationGuard, request } from './request.js';
import { global, nativeFetch } from './state.js';
import { escapeAttribute, escapeHtml, setError } from './view.js';
import { exportPlanningScope } from '../planning/store.js';

async function stageGuestImportImages(canvases, onProgress = () => {}) {
  const requireCurrentAccount = accountGenerationGuard();
  const staged = structuredClone(canvases);
  const sources = new Map();
  for (const canvas of staged) {
    for (const item of canvas.snapshot?.items || []) {
      if (item?.type !== 'image' || !String(item.src || '').startsWith('data:image/')) continue;
      if (!sources.has(item.src)) sources.set(item.src, []);
      sources.get(item.src).push(item);
    }
  }
  const entries = Array.from(sources.entries());
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      requireCurrentAccount();
      const index = cursor++;
      const [source, items] = entries[index];
      const dataResponse = await nativeFetch(source);
      const blob = await dataResponse.blob();
      requireCurrentAccount();
      const uploaded = await request('/api/assets', {
        method: 'POST',
        headers: { 'content-type': blob.type },
        body: blob
      });
      requireCurrentAccount();
      for (const item of items) {
        item.src = uploaded.url;
        item.assetId = uploaded.assetId;
        item.naturalWidth = uploaded.width || item.naturalWidth;
        item.naturalHeight = uploaded.height || item.naturalHeight;
      }
      completed += 1;
      onProgress(completed, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker));
  requireCurrentAccount();
  return staged;
}

async function maybeOfferGuestImport() {
  const requireCurrentAccount = accountGenerationGuard();
  let canvases;
  try {
    canvases = await global.WhiteboardStorage?.listGuestCanvases({ createIfEmpty: false });
    requireCurrentAccount();
  } catch {
    return;
  }
  canvases = canvases?.filter((canvas) => !canvas.isGuide && canvas.hasContent !== false);
  if (!canvases?.length) return;
  const list = byId('guestImportList');
  list.textContent = '';
  for (const canvas of canvases) {
    const label = document.createElement('label');
    label.className = 'guest-import-option';
    label.innerHTML = `<input type="checkbox" value="${escapeAttribute(canvas.id)}" checked><span>${escapeHtml(canvas.name)}</span>`;
    list.appendChild(label);
  }
  byId('guestImportDialog').hidden = false;
  return new Promise((resolve) => {
    byId('skipGuestImportButton').onclick = () => {
      byId('guestImportDialog').hidden = true;
      resolve();
    };
    byId('confirmGuestImportButton').onclick = async () => {
      const ids = Array.from(list.querySelectorAll('input:checked'), (input) => input.value);
      if (!ids.length) {
        byId('guestImportDialog').hidden = true;
        resolve();
        return;
      }
      const button = byId('confirmGuestImportButton');
      const originalLabel = button.textContent;
      button.disabled = true;
      setError(byId('guestImportError'), '');
      try {
        requireCurrentAccount();
        const canvasesToImport = await global.WhiteboardStorage.exportGuestCanvases(ids);
        requireCurrentAccount();
        const stagedCanvases = await stageGuestImportImages(canvasesToImport, (completed, total) => {
          button.textContent = `上传图片 ${completed}/${total}`;
        });
        requireCurrentAccount();
        const planning=await exportPlanningScope('guest',plan=>plan.host.kind==='canvas'&&ids.includes(plan.host.boardId)&&!plan.deleted);
        button.textContent = '正在导入画布…';
        const result = await request('/api/imports/guest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canvases: stagedCanvases,planning })
        });
        requireCurrentAccount();
        await global.WhiteboardStorage.removeGuestCanvases(result.importedGuestIds || ids);
        byId('guestImportDialog').hidden = true;
        resolve();
      } catch (error) {
        setError(byId('guestImportError'), `${error.message || '导入失败'}，本地副本已保留。`);
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    };
  });
}

export { maybeOfferGuestImport, stageGuestImportImages };
