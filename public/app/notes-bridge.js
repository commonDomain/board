import { state } from './state.js';
import { placeAnchoredMenu } from './menu-placement.js';
import { isGuestMode } from './account-lifecycle.js';
import { cancelActiveGesture } from './gestures.js';
import { finishEditing } from './editing.js';
import { closePopovers } from './popovers.js';
import { getBoardPointFromClient } from './camera.js';
import { upsertItem } from './items.js';
import { showToast, refreshIcons } from './interface-model.js';
import { getWritableLayer } from './layers-model.js';
import { updateCanvasStartState } from './toolbar.js';
import { locateNoteSource, captureNoteRegion, wireNoteReferences } from './note-references.js';
import { clearNoteReturnAnchor } from './note-return-anchor.js';

function wireNotesWorkspace() {
  const workspace = window.MuseNotebook;
  if (!workspace) return;
  const switcher = document.getElementById('workspaceModeSwitch');
  workspace.initialize({
    isGuest: isGuestMode,
    locateSource: locateNoteSource,
    captureRegion: captureNoteRegion,
    leaveCanvas() { finishEditing(); cancelActiveGesture(); closePopovers(); document.getElementById('noteActionsMenu')?.removeAttribute('open'); switcher?.querySelectorAll('[data-workspace-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === 'notebook'))); },
    returnCanvas() { switcher?.querySelectorAll('[data-workspace-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === 'canvas'))); },
    async guestCanvases() {
      const canvases = await window.WhiteboardStorage.exportGuestCanvases();
      const current = { id: state.boardId, name: document.getElementById('currentCanvasName')?.textContent || '当前画布', snapshot: { items: structuredClone([...state.items.values()]), sections: structuredClone([...state.sections.values()]), layers: structuredClone(state.layers), background: state.background } };
      return state.boardId ? [...canvases.filter(canvas => canvas.id !== state.boardId), current] : canvases;
    }
  });
  wireNoteReferences(workspace, switcher);
  switcher?.addEventListener('click', event => { const button = event.target.closest('[data-workspace-mode]'); if (button) button.dataset.workspaceMode === 'notebook' ? workspace.show() : workspace.hide(); });
  const notebookSwitch=switcher?.querySelector('[data-workspace-mode="notebook"]');
  if(notebookSwitch){notebookSwitch.disabled=false;notebookSwitch.removeAttribute('title');}
  const trigger = document.createElement('button'); trigger.id = 'noteOriginalsButton'; trigger.type = 'button'; trigger.className = 'action-button'; trigger.textContent = '从笔记添加'; trigger.title = '复制到画布'; switcher?.after(trigger);
  const menu = document.createElement('details'); menu.id = 'noteActionsMenu'; menu.className = 'note-actions-menu';
  const summary = document.createElement('summary'); summary.textContent = '笔记操作';
  const panel = document.createElement('div'); panel.id = 'noteActionsPanel'; panel.className = 'note-actions-panel'; panel.setAttribute('aria-label', '笔记操作'); panel.hidden = true;
  summary.setAttribute('aria-controls', panel.id);
  menu.append(summary); switcher?.after(menu); document.body.append(panel);
  panel.append(trigger, document.getElementById('noteRegionButton'), document.getElementById('noteReferencesButton'));
  menu.addEventListener('toggle', () => { panel.hidden = !menu.open; if (menu.open) { for (const id of ['noteRegionButton','noteReferencesButton']) document.getElementById(id).disabled = !state.selectedIds.size; placeAnchoredMenu(panel, summary); panel.querySelector('button:not(:disabled)')?.focus(); } });
  const dismissMenu = event => { if (event.key === 'Escape') { menu.open = false; panel.hidden = true; summary.focus(); } };
  menu.addEventListener('keydown', dismissMenu); panel.addEventListener('keydown', dismissMenu);
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button:not(:disabled)')];
    if (event.shiftKey && document.activeElement === controls[0] || !event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault(); menu.open = false; panel.hidden = true; summary.focus();
    }
  });
  document.addEventListener('pointerdown', event => { if (menu.open && !menu.contains(event.target) && !panel.contains(event.target)) menu.open = false; });
  const back = document.createElement('button'); back.id = 'noteReturnButton'; back.type = 'button'; back.className = 'action-button note-return'; back.innerHTML = '<i data-lucide="notebook-pen" aria-hidden="true"></i><span>返回刚才笔记</span>'; back.hidden = true; document.body.append(back); refreshIcons(back);
  back.addEventListener('click', async () => { try { await workspace.returnToNote(); clearNoteReturnAnchor(); } catch (error) { showToast(error.message); } });
  let tray; let generation = 0; let cancelPlacement;
  const close = () => { tray?.remove(); tray = null; cancelPlacement?.(); cancelPlacement = null; };
  window.addEventListener('muse:cancel-placement', close);
  for (const name of ['muse:account-changing','muse:logout','muse:auth-expired']) window.addEventListener(name, () => { generation++; close(); menu.open = false; clearNoteReturnAnchor(); });
  trigger.addEventListener('click', async () => {
    menu.open = false;
    if (tray) { close(); return; }
    const epoch = generation; const owner = window.MuseAccount?.session?.user?.id || 'guest';
    const valid = () => generation === epoch && owner === (window.MuseAccount?.session?.user?.id || 'guest');
    tray = document.createElement('section'); tray.className = 'note-originals-tray'; tray.setAttribute('aria-label','从笔记添加'); document.body.append(tray);
    const currentTray = tray;
    const heading = document.createElement('strong'); heading.textContent = '从笔记添加'; tray.append(heading);
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '关闭'; dismiss.setAttribute('aria-label','关闭笔记内容面板'); dismiss.addEventListener('click',close); tray.append(dismiss);
    tray.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); summary.focus(); } });
    const hint = document.createElement('p'); hint.textContent = '点击后放置独立副本；复杂格式会保留文字并适配画布。'; tray.append(hint);
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索笔记内容或标题'; search.setAttribute('aria-label','搜索可添加的笔记内容'); search.maxLength = 100; tray.append(search);
    const results = document.createElement('div'); tray.append(results);
    let searchEpoch = 0, searchTimer;
    placeAnchoredMenu(tray, summary);
    const load = async (offset, epoch = searchEpoch) => {
      if (!valid() || tray !== currentTray || epoch !== searchEpoch) return;
      const materials = await workspace.originals(offset, search.value); if (!valid() || tray !== currentTray || epoch !== searchEpoch) return;
      if (!offset) results.replaceChildren();
      if (!materials.length && !offset) { const empty = document.createElement('p'); empty.textContent = search.value ? '没有找到匹配内容' : '在笔记中新增文字、图片或脑图后，会出现在这里。'; results.append(empty); }
      for (const material of materials) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = material.text.slice(0,90) || material.type;
        const source = document.createElement('small'); source.textContent = material.label; button.append(source); results.append(button);
        button.addEventListener('click', async () => {
          if (!state.boardId || !getWritableLayer()) return showToast('请先打开可编辑的画布');
          const boardId = state.boardId;
          try {
            const item = await workspace.originalItem(material);
            if (!valid() || state.boardId !== boardId || tray !== currentTray || epoch !== searchEpoch) return;
            close(); showToast('点击画布放置笔记副本，点“取消”或 Esc 取消');
            const viewport = document.getElementById('viewport');
            const cleanup = () => { viewport.removeEventListener('pointerdown',place,true); window.removeEventListener('keydown',cancel,true); if (cancelPlacement === cleanup) cancelPlacement = null; };
            const cancel = event => { if (event.key === 'Escape') cleanup(); };
            const place = event => {
              if (event.button !== 0) return; cleanup(); event.preventDefault(); event.stopImmediatePropagation();
              if (!valid() || state.boardId !== boardId || window.__independentNotesActive || !getWritableLayer()) return;
              const point = getBoardPointFromClient(event.clientX,event.clientY); Object.assign(item,point,{z:++state.zCounter});
              if (upsertItem(item,{select:true})) { updateCanvasStartState(); showToast('已复制为独立画布内容'); }
            };
            cancelPlacement = cleanup; viewport.addEventListener('pointerdown',place,true); window.addEventListener('keydown',cancel,true);
          } catch (error) { if (valid() && error.name !== 'AbortError') showToast(error.message); }
        });
      }
      if (materials.next != null) {
        const more = document.createElement('button'); more.textContent = '加载更多'; more.type = 'button'; results.append(more);
        more.addEventListener('click', async () => { more.disabled = true; try { await load(materials.next, epoch); more.remove(); } catch(error) { more.disabled = false; if(valid()) showToast(error.message); } });
      }
    };
    search.addEventListener('input', () => {
      clearTimeout(searchTimer); const epoch = ++searchEpoch;
      results.replaceChildren(); results.textContent = '正在搜索…';
      searchTimer = setTimeout(() => load(0, epoch).catch(error => { if (valid() && tray === currentTray && epoch === searchEpoch) results.textContent = error.message; }), 200);
    });
    try { await load(0); } catch (error) { if (valid() && tray === currentTray && searchEpoch === 0) results.textContent = error.message; }
  });
}
export { wireNotesWorkspace };
