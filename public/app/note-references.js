import { state } from './state.js';
import { showToast } from './interface-model.js';
import { regionItems, regionRevision } from './note-reference-model.js';
import { renderNoteRegion } from './note-region-preview.js';
import { showNoteReturnAnchor } from './note-return-anchor.js';

const owner = () => window.MuseAccount?.session?.user?.id || 'guest';
export async function locateNoteSource(origin) {
  const account = owner();
  await window.MuseNotebook.checkSource(origin);
  if (account !== owner()) throw new Error('账号已切换');
  if (!state.canvases.some(board => board.id === origin.boardId)) throw new Error('来源画布已删除或无权访问');
  if (state.boardId !== origin.boardId) await (await import('./canvas-session.js')).switchCanvas(origin.boardId);
  if (account !== owner() || state.boardId !== origin.boardId) throw new Error('未能打开来源画布，请重试');
  const item = state.items.get(origin.entityId) || state.sections.get(origin.entityId);
  const bounds = origin.region?.bounds || item;
  if (!bounds) throw new Error('源内容已被删除，笔记副本仍保留');
  window.MuseNotebook.rememberSourceReturn();
  window.MuseNotebook.hide();
  const { focusBoundsInViewport } = await import('./focus.js');
  focusBoundsInViewport(bounds, { screenPadding: 70, zoomCap: 1.5 });
  if (item && state.items.has(item.id)) (await import('./selection.js')).selectItem(item.id);
  else if (origin.region) {
    state.selectedIds = new Set(regionItems([...state.items.values()], bounds).map(entry => entry.id));
    state.selectedId = state.selectedIds.values().next().value || null;
    (await import('./selection.js')).updateSelectionUI();
  }
  if (account !== owner() || state.boardId !== origin.boardId) throw new Error('账号或画布已切换');
  showNoteReturnAnchor(origin, bounds);
}
export async function captureNoteRegion(origin) {
  const account = owner();
  if (origin) {
    const snapshot = await window.MuseNotebook.regionSnapshot(origin);
    if (account !== owner()) throw new Error('账号已切换');
    if (snapshot.empty) throw new Error('原区域已空');
    const blob = await renderNoteRegion({ ...snapshot, boardId: origin.boardId, bounds: origin.region.bounds });
    const latest = await window.MuseNotebook.regionSnapshot(origin);
    if (account !== owner() || snapshot.revision !== latest.revision) throw new Error('画布已变化，请重新刷新');
    return { blob, scope: account, origin: { ...origin, region: { ...origin.region, entityIds: snapshot.items.map(item => item.id), revision: snapshot.revision } } };
  }
  const boardId = state.boardId;
  if (!boardId || state.switchingCanvas || state.exporting) throw new Error('请等待画布加载完成后重试');
  const selected = [...state.selectedIds].map(id => state.items.get(id)).filter(Boolean);
  if (!origin && !selected.length) throw new Error('请先框选要引用的画布内容');
  const x = Math.min(...selected.map(item => item.x)), y = Math.min(...selected.map(item => item.y));
  const bounds = origin?.region?.bounds || { x, y, w: Math.max(...selected.map(item => item.x + item.w)) - x, h: Math.max(...selected.map(item => item.y + item.h)) - y };
  const items = regionItems([...state.items.values()], bounds);
  if (!items.length) throw new Error('原区域内容已删除，保留上次预览');
  const revision = regionRevision(items);
  const { buildExportPngBlob } = await import('./export.js');
  const blob = await buildExportPngBlob(bounds, new Set(items.map(item => item.id)), null, { keepSectionIds: new Set(), maxSide: 1600 });
  if (account !== owner() || boardId !== state.boardId || revision !== regionRevision(regionItems([...state.items.values()], bounds))) throw new Error('画布已变化，请重新引用');
  return { blob, scope: account, origin: { kind: 'canvas', boardId, label: document.getElementById('currentCanvasName')?.textContent || '画布区域', region: { bounds, entityIds: items.map(item => item.id), revision } } };
}
export function wireNoteReferences(workspace, switcher) {
  const add = (id, label, action) => {
    const button = document.createElement('button'); button.id = id; button.className = 'action-button'; button.textContent = label; button.type = 'button'; switcher?.after(button);
    button.addEventListener('click', async () => { button.disabled = true; try { await action(); } catch(error) { showToast(error.message); } finally { button.disabled = false; } });
  };
  add('noteRegionButton', '引用选区到笔记', async () => { const result = await captureNoteRegion(); const target = await workspace.chooseRegionTarget(); if (target) await workspace.insertRegion(result, target); });
  add('noteReferencesButton', '查看引用笔记', async () => {
    const boardId = state.boardId, account = owner(), ids = [...state.selectedIds];
    if (!ids.length) throw new Error('请先选择画布内容');
    const references = await workspace.references(boardId, ids);
    if (boardId !== state.boardId || account !== owner()) return;
    if (!references.length) return showToast('所选内容还没有被笔记引用');
    const dialog = document.createElement('dialog'); dialog.className = 'nt-dialog';
    const heading = document.createElement('h2'); heading.textContent = '引用此内容的笔记'; dialog.append(heading);
    for (const reference of references) {
      const button = document.createElement('button'); button.textContent = reference.label;
      button.addEventListener('click', async () => { dialog.close(); if (account !== owner()) return; try { await workspace.openReference(reference); } catch(error) { showToast(error.message); } }); dialog.append(button);
    }
    const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => dialog.close(); dialog.append(close);
    const reset = () => dialog.close();
    for (const name of ['muse:account-changing','muse:logout','muse:auth-expired']) window.addEventListener(name, reset);
    dialog.addEventListener('close', () => { dialog.remove(); for (const name of ['muse:account-changing','muse:logout','muse:auth-expired']) window.removeEventListener(name, reset); }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}

