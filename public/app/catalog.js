import { placeAnchoredMenu } from './menu-placement.js';


import { CANVAS_CATALOG_FRESH_MS, MAX_CANVASES, MAX_CANVAS_NAME_LENGTH } from './constants.js';
import { els } from './elements.js';
import {
  cancelSurfaceMorph,
  captureElementRect,
  closeMenuSurface,
  morphSurface,
  openMenuSurface,
  refreshIcons,
  showToast
} from './interface-model.js';
import { interfaceEffects } from './interface.js';

import { state } from './state.js';

import { clamp, isImeEvent } from './utilities.js';
import { canvasCatalogSignature, currentCanvas } from './catalog-model.js';

let isGuestMode,
  persistCurrentCanvasForSwitch,
  resetCanvasRuntime,
  restoreLocalBoardStateAndConnect,
  switchCanvas,
  startCanvasDrag,
  onCanvasListFocusIn,
  onCanvasListFocusOut,
  onCanvasListPointerOut,
  onCanvasListPointerOver,
  resetCanvasPreviewIntent,
  connect,
  setConnection,
  closePopovers,
  updateCanvasStartState;

function configureCatalog(callbacks) {
  ({
    isGuestMode,
    persistCurrentCanvasForSwitch,
    resetCanvasRuntime,
    restoreLocalBoardStateAndConnect,
    switchCanvas,
    startCanvasDrag,
    onCanvasListFocusIn,
    onCanvasListFocusOut,
    onCanvasListPointerOut,
    onCanvasListPointerOver,
    resetCanvasPreviewIntent,
    connect,
    setConnection,
    closePopovers,
    updateCanvasStartState
  } = callbacks);
}

async function fetchCanvasCatalog(options = {}) {
  const generation = window.WhiteboardStorage?.getGeneration();
  const requireCurrent = () => {
    if (generation !== window.WhiteboardStorage?.getGeneration()) throw new Error('账号已切换，忽略旧目录请求');
    if (options.isCurrent && !options.isCurrent()) throw new Error('画布目录请求已过期');
  };
  if (isGuestMode()) {
    const canvases = await window.WhiteboardStorage.listGuestCanvases();
    requireCurrent();
    state.canvases = canvases;
    state.maximumCanvases = MAX_CANVASES;
    return canvases;
  }
  const response = await fetch('/api/canvases', { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  requireCurrent();
  if (!response.ok || !Array.isArray(body.canvases)) {
    throw new Error(body.error || '无法读取画布列表');
  }
  state.canvases = body.canvases.filter(
    (canvas) => canvas && typeof canvas.id === 'string' && typeof canvas.name === 'string'
  );
  state.maximumCanvases = Number(body.maximum) || MAX_CANVASES;
  state.maximumCanvasNameLength = Number(body.maximumNameLength) || MAX_CANVAS_NAME_LENGTH;
  els.newCanvasName.maxLength = state.maximumCanvasNameLength;
  els.renameCanvasName.maxLength = state.maximumCanvasNameLength;
  return state.canvases;
}

async function loadCanvasCatalog(options = {}) {
  const previousSignature = canvasCatalogSignature(state.canvases);
  const previousBoardId = state.boardId;
  const canvases = await fetchCanvasCatalog(options);
  state.canvasCatalogLoadedAt = Date.now();
  if (options.selectFirst || !canvases.some((canvas) => canvas.id === state.boardId)) {
    state.boardId = canvases[0]?.id || null;
  }
  if (
    options.forceRender ||
    previousBoardId !== state.boardId ||
    previousSignature !== canvasCatalogSignature(canvases)
  ) {
    renderCanvasCatalog();
  }
  updateCurrentCanvasLabel();
  updateCanvasStartState();
  return canvases;
}

function ownedCanvasCount() {
  return state.canvases.filter((canvas) => !canvas.isGuide && (isGuestMode() || canvas.canManage)).length;
}

function updateCurrentCanvasLabel() {
  const canvas = currentCanvas();
  const name = canvas?.name || '画布';
  els.currentCanvasName.textContent = name;
  els.canvasSwitcherButton.title = name;
  els.canvasSwitcherButton.setAttribute('aria-label', `切换画布，当前为${name}`);
  document.title = 'Muse Board · 实时共享画板';
}

function renderCanvasCatalog() {
  resetCanvasPreviewIntent();
  els.canvasList.textContent = '';
  for (const canvas of state.canvases) {
    const row = document.createElement('div');
    row.className = 'canvas-list-item';
    row.classList.toggle('active', canvas.id === state.boardId);
    row.dataset.canvasId = canvas.id;

    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'canvas-drag-handle';
    dragHandle.setAttribute('aria-label', `拖动“${canvas.name}”调整顺序`);
    dragHandle.title = '拖拽调整顺序';
    const dragIcon = document.createElement('i');
    dragIcon.setAttribute('data-lucide', 'menu');
    dragIcon.setAttribute('aria-hidden', 'true');
    dragHandle.appendChild(dragIcon);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'canvas-select-button';
    button.classList.toggle('active', canvas.id === state.boardId);
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(canvas.id === state.boardId));
    button.title = canvas.name;

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'file-image');
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'canvas-list-name';
    name.textContent = canvas.name;
    if (!isGuestMode() && canvas.owner && canvas.ownerUserId !== window.MuseAccount?.session?.user?.id) {
      const owner = document.createElement('small');
      owner.className = 'canvas-owner-badge';
      owner.textContent = `· ${canvas.owner.username}`;
      name.appendChild(owner);
    }
    const check = document.createElement('span');
    check.className = 'canvas-current-check';
    if (canvas.id === state.boardId) {
      const checkIcon = document.createElement('i');
      checkIcon.setAttribute('data-lucide', 'check');
      checkIcon.setAttribute('aria-hidden', 'true');
      check.appendChild(checkIcon);
    }
    button.append(icon, name, check);

    const actions = document.createElement('div');
    actions.className = 'canvas-item-actions';
    const privacy = document.createElement('button');
    privacy.type = 'button';
    privacy.className = 'canvas-item-action canvas-privacy-action';
    privacy.classList.toggle('is-private', canvas.visibility === 'private');
    privacy.setAttribute(
      'aria-label',
      canvas.visibility === 'private' ? `将“${canvas.name}”设为共享` : `将“${canvas.name}”设为仅自己可见`
    );
    privacy.title = canvas.visibility === 'private' ? '仅自己可见' : '共享画布';
    privacy.innerHTML = `<i data-lucide="${canvas.visibility === 'private' ? 'lock-keyhole' : 'users'}" aria-hidden="true"></i>`;
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'canvas-item-action';
    rename.setAttribute('aria-label', `重命名“${canvas.name}”`);
    rename.title = '重命名';
    rename.innerHTML = '<i data-lucide="type" aria-hidden="true"></i>';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'canvas-item-action danger';
    remove.setAttribute('aria-label', `删除“${canvas.name}”`);
    remove.title = '删除';
    remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';

    if (!isGuestMode() && canvas.canManage && !canvas.isGuide) actions.append(privacy);
    if (isGuestMode() || canvas.canManage) actions.append(rename);
    if (isGuestMode() || canvas.canManage) actions.append(remove);
    row.append(dragHandle, button, actions);
    button.addEventListener('click', () => switchCanvas(canvas.id));
    rename.addEventListener('click', () => openRenameCanvasDialog(canvas, rename));
    remove.addEventListener('click', () => openDeleteCanvasDialog(canvas, remove));
    privacy.addEventListener('click', () => toggleCanvasVisibility(canvas, privacy));
    dragHandle.addEventListener('pointerdown', (event) => startCanvasDrag(event, row, dragHandle));
    els.canvasList.appendChild(row);
  }
  els.canvasCount.textContent = isGuestMode()
    ? `${ownedCanvasCount()}/${state.maximumCanvases}${state.canvases.some((canvas) => canvas.isGuide) ? ' · 含操作指南' : ''}`
    : `我的 ${ownedCanvasCount()}/${state.maximumCanvases} · 可见 ${state.canvases.length}`;
  const atLimit = ownedCanvasCount() >= state.maximumCanvases;
  els.newCanvasButton.disabled = atLimit || state.creatingCanvas;
  els.newCanvasButton.title = atLimit ? `最多只能创建 ${state.maximumCanvases} 个画布` : '新建画布';
  interfaceEffects.canvasLiquid?.refresh();
  refreshIcons(els.canvasList);
  updateCanvasStartState();
}

async function toggleCanvasVisibility(canvas, button) {
  if (!canvas?.canManage || isGuestMode()) return;
  const visibility = canvas.visibility === 'private' ? 'shared' : 'private';
  button.disabled = true;
  try {
    const response = await fetch(`/api/canvases/${encodeURIComponent(canvas.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ visibility })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '无法修改画布可见性');
    const index = state.canvases.findIndex((entry) => entry.id === canvas.id);
    if (index >= 0) state.canvases[index] = { ...state.canvases[index], ...body.canvas };
    renderCanvasCatalog();
    showToast(visibility === 'private' ? '已设为仅自己可见' : '已恢复共享');
  } catch (error) {
    showToast(error.message || '画布权限修改失败');
  } finally {
    button.disabled = false;
  }
}

function positionCanvasMenu() {
  const anchor = els.canvasSwitcherButton.getBoundingClientRect();
  const menuWidth = els.canvasMenu.offsetWidth || 360;
  const left = clamp(anchor.left, 8, Math.max(8, window.innerWidth - menuWidth - 8));
  els.canvasMenu.style.left = `${left}px`;
  els.canvasMenu.style.top = `${Math.min(window.innerHeight - 8, anchor.bottom + 8)}px`;
}

async function openCanvasMenu() {
  closePopovers();
  els.canvasMenu.hidden = false;
  delete els.canvasMenu.dataset.menuClosing;
  els.canvasSwitcherButton.setAttribute('aria-expanded', 'true');
  positionCanvasMenu();
  interfaceEffects.canvasLiquid?.refresh();
  placeAnchoredMenu(els.canvasMenu, els.canvasSwitcherButton);
  openMenuSurface(els.canvasMenu, els.canvasSwitcherButton);
  requestAnimationFrame(() => {
    if (els.canvasMenu.hidden) return;
    els.canvasList.querySelector('.canvas-select-button.active, .canvas-select-button')?.focus({ preventScroll: true });
  });
  if (Date.now() - state.canvasCatalogLoadedAt < CANVAS_CATALOG_FRESH_MS) return;
  const reloadId = state.catalogReloadId;
  const isCurrent = () => reloadId === state.catalogReloadId;
  try {
    const previousBoardId = state.boardId;
    await loadCanvasCatalog({ isCurrent });
    if (state.boardId !== previousBoardId) {
      const socket = state.socket;
      state.socket = null;
      socket?.close(1000, 'Canvas catalog selection changed');
      resetCanvasRuntime();
      if (state.boardId) await restoreLocalBoardStateAndConnect();
      else setConnection('idle');
    }
  } catch (error) {
    if (!isCurrent()) return;
    console.warn('Could not refresh canvas catalog', error);
    showToast('画布列表刷新失败，已显示本地列表');
  }
}

function closeCanvasMenu(options = {}) {
  if (els.canvasMenu.hidden || els.canvasMenu.dataset.menuClosing === 'true') return;
  const restoreFocus = options.restoreFocus !== false && els.canvasMenu.contains(document.activeElement);
  interfaceEffects.canvasLiquid?.hide();
  els.canvasSwitcherButton.setAttribute('aria-expanded', 'false');
  resetCanvasPreviewIntent();
  if (restoreFocus) els.canvasSwitcherButton.focus({ preventScroll: true });
  closeMenuSurface(
    els.canvasMenu,
    () => {
      els.canvasMenu.hidden = true;
      els.canvasMenu.removeAttribute('style');
    },
    { immediate: options.immediate }
  );
}

function openNewCanvasDialog() {
  if (ownedCanvasCount() >= state.maximumCanvases) {
    showToast(`最多只能创建 ${state.maximumCanvases} 个画布`);
    return;
  }
  const anchorRect = captureElementRect(els.newCanvasButton) || captureElementRect(els.canvasSwitcherButton);
  closeCanvasMenu({ restoreFocus: false });
  closePopovers();
  els.newCanvasForm.reset();
  if (!state.boardId) els.newCanvasName.value = '画布 1';
  document.getElementById('newCanvasVisibilityField').hidden = isGuestMode();
  els.newCanvasNameCount.textContent = `${Array.from(els.newCanvasName.value).length}/${state.maximumCanvasNameLength}`;
  setNewCanvasError('');
  els.newCanvasDialog.hidden = false;
  morphSurface(els.newCanvasDialog.querySelector('.canvas-dialog-card'), anchorRect);
  requestAnimationFrame(() => {
    if (!els.newCanvasDialog.hidden) els.newCanvasName.focus();
  });
}

function closeNewCanvasDialog() {
  if (state.creatingCanvas) return;
  cancelSurfaceMorph(els.newCanvasDialog.querySelector('.canvas-dialog-card'));
  els.newCanvasDialog.hidden = true;
  setNewCanvasError('');
  els.newCanvasButton.focus({ preventScroll: true });
}

function setNewCanvasError(message) {
  els.newCanvasError.textContent = message;
  els.newCanvasError.hidden = !message;
  els.newCanvasName.setAttribute('aria-invalid', String(Boolean(message)));
}

async function submitNewCanvas(event) {
  event.preventDefault();
  if (state.creatingCanvas) return;
  const name = els.newCanvasName.value.trim();
  const wasWithoutCanvas = !state.boardId;
  const length = Array.from(name).length;
  if (!name) {
    setNewCanvasError('请输入画布名称');
    els.newCanvasName.focus();
    return;
  }
  if (length > state.maximumCanvasNameLength) {
    setNewCanvasError(`画布名称不能超过 ${state.maximumCanvasNameLength} 个字符`);
    return;
  }
  state.creatingCanvas = true;
  els.confirmNewCanvas.disabled = true;
  els.newCanvasButton.disabled = true;
  setNewCanvasError('');
  try {
    if (isGuestMode()) {
      const canvas = await window.WhiteboardStorage.createGuestCanvas(name);
      await loadCanvasCatalog();
      if (wasWithoutCanvas && state.boardId) {
        resetCanvasRuntime();
        await restoreLocalBoardStateAndConnect();
      }
      cancelSurfaceMorph(els.newCanvasDialog.querySelector('.canvas-dialog-card'));
      els.newCanvasDialog.hidden = true;
      showToast(`已在浏览器中创建“${canvas.name}”`);
      return;
    }
    const response = await fetch('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name, visibility: document.getElementById('newCanvasVisibility')?.value || 'shared' })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        CANVAS_NAME_EXISTS: '该画布名称已存在',
        CANVAS_LIMIT_REACHED: `最多只能创建 ${state.maximumCanvases} 个画布`,
        INVALID_CANVAS_NAME: `请输入 1–${state.maximumCanvasNameLength} 个字符的画布名称`
      };
      setNewCanvasError(messages[body.code] || body.error || '画布创建失败');
      return;
    }
    await loadCanvasCatalog();
    if (wasWithoutCanvas && state.boardId) {
      resetCanvasRuntime();
      await restoreLocalBoardStateAndConnect();
    }
    cancelSurfaceMorph(els.newCanvasDialog.querySelector('.canvas-dialog-card'));
    els.newCanvasDialog.hidden = true;
    showToast(`已创建“${body.canvas?.name || name}”`);
  } catch (error) {
    console.warn('Could not create canvas', error);
    setNewCanvasError('网络异常，请稍后重试');
  } finally {
    state.creatingCanvas = false;
    els.confirmNewCanvas.disabled = false;
    renderCanvasCatalog();
  }
}

function setRenameCanvasError(message) {
  els.renameCanvasError.textContent = message;
  els.renameCanvasError.hidden = !message;
  els.renameCanvasName.setAttribute('aria-invalid', String(Boolean(message)));
}

function openRenameCanvasDialog(canvas, anchor) {
  const anchorRect = captureElementRect(anchor) || captureElementRect(els.canvasSwitcherButton);
  closeCanvasMenu({ restoreFocus: false });
  state.canvasActionId = canvas.id;
  els.renameCanvasName.value = canvas.name;
  els.renameCanvasNameCount.textContent = `${Array.from(canvas.name).length}/${state.maximumCanvasNameLength}`;
  setRenameCanvasError('');
  els.renameCanvasDialog.hidden = false;
  morphSurface(els.renameCanvasDialog.querySelector('.canvas-dialog-card'), anchorRect);
  requestAnimationFrame(() => {
    if (els.renameCanvasDialog.hidden) return;
    els.renameCanvasName.focus();
    els.renameCanvasName.select();
  });
}

function closeRenameCanvasDialog() {
  if (state.renamingCanvas) return;
  cancelSurfaceMorph(els.renameCanvasDialog.querySelector('.canvas-dialog-card'));
  els.renameCanvasDialog.hidden = true;
  state.canvasActionId = null;
  setRenameCanvasError('');
  els.canvasSwitcherButton.focus({ preventScroll: true });
}

async function submitRenameCanvas(event) {
  event.preventDefault();
  if (state.renamingCanvas || !state.canvasActionId) return;
  const name = els.renameCanvasName.value.trim();
  const length = Array.from(name).length;
  if (!name || length > state.maximumCanvasNameLength) {
    setRenameCanvasError(name ? `画布名称不能超过 ${state.maximumCanvasNameLength} 个字符` : '请输入画布名称');
    return;
  }
  const existing = state.canvases.find((canvas) => canvas.id === state.canvasActionId);
  if (existing?.name === name) {
    closeRenameCanvasDialog();
    return;
  }

  state.renamingCanvas = true;
  els.confirmRenameCanvas.disabled = true;
  setRenameCanvasError('');
  try {
    if (isGuestMode()) {
      await window.WhiteboardStorage.renameGuestCanvas(state.canvasActionId, name);
      await loadCanvasCatalog();
      cancelSurfaceMorph(els.renameCanvasDialog.querySelector('.canvas-dialog-card'));
      els.renameCanvasDialog.hidden = true;
      state.canvasActionId = null;
      showToast(`已重命名为“${name}”`);
      return;
    }
    const response = await fetch(`/api/canvases/${encodeURIComponent(state.canvasActionId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        CANVAS_NAME_EXISTS: '该画布名称已存在',
        INVALID_CANVAS_NAME: `请输入 1–${state.maximumCanvasNameLength} 个字符的画布名称`,
        CANVAS_NOT_FOUND: '该画布已被删除'
      };
      setRenameCanvasError(messages[body.code] || body.error || '重命名失败');
      return;
    }
    await loadCanvasCatalog();
    cancelSurfaceMorph(els.renameCanvasDialog.querySelector('.canvas-dialog-card'));
    els.renameCanvasDialog.hidden = true;
    state.canvasActionId = null;
    showToast(`已重命名为“${body.canvas?.name || name}”`);
  } catch (error) {
    console.warn('Could not rename canvas', error);
    setRenameCanvasError('网络异常，请稍后重试');
  } finally {
    state.renamingCanvas = false;
    els.confirmRenameCanvas.disabled = false;
  }
}

function openDeleteCanvasDialog(canvas, anchor) {
  const anchorRect = captureElementRect(anchor) || captureElementRect(els.canvasSwitcherButton);
  closeCanvasMenu({ restoreFocus: false });
  state.canvasActionId = canvas.id;
  els.deleteCanvasName.textContent = canvas.name;
  let planningHint = els.deleteCanvasDialog.querySelector('.planning-delete-hint');
  if (window.MusePlanning?.enabled) {
    planningHint ||= document.createElement('p'); planningHint.className = 'planning-delete-hint';
    planningHint.textContent = '此画布承载的规划将归档，仅所有者可查看并恢复到其他画布或笔记。';
    els.deleteCanvasDialog.querySelector('.canvas-dialog-card').append(planningHint);
  }
  els.deleteCanvasDialog.hidden = false;
  morphSurface(els.deleteCanvasDialog.querySelector('.canvas-dialog-card'), anchorRect);
  requestAnimationFrame(() => {
    if (!els.deleteCanvasDialog.hidden) els.cancelDeleteCanvas.focus();
  });
}

function closeDeleteCanvasDialog() {
  if (state.deletingCanvas) return;
  cancelSurfaceMorph(els.deleteCanvasDialog.querySelector('.canvas-dialog-card'));
  els.deleteCanvasDialog.hidden = true;
  state.canvasActionId = null;
  els.canvasSwitcherButton.focus({ preventScroll: true });
}

async function requestDeleteCanvas(boardId) {
  if (isGuestMode()) {
    const canvases = await window.WhiteboardStorage.deleteGuestCanvas(boardId);
    await window.MusePlanning?.archiveHost({ kind: 'canvas', boardId });
    return { ok: true, canvases, maximum: MAX_CANVASES };
  }
  const response = await fetch(`/api/canvases/${encodeURIComponent(boardId)}`, {
    method: 'DELETE',
    headers: { accept: 'application/json' }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      LAST_CANVAS: '至少需要保留一块画布',
      CANVAS_NOT_FOUND: '该画布已被删除'
    };
    throw Object.assign(new Error(messages[body.code] || body.error || '删除画布失败'), { code: body.code });
  }
  return body;
}

async function deleteSelectedCanvas() {
  const boardId = state.canvasActionId;
  if (!boardId || state.deletingCanvas) return;
  state.deletingCanvas = true;
  els.confirmDeleteCanvas.disabled = true;
  els.cancelDeleteCanvas.disabled = true;
  const deletingCurrent = boardId === state.boardId;
  let disconnected = false;
  try {
    if (deletingCurrent && !(await persistCurrentCanvasForSwitch())) return;
    if (deletingCurrent) {
      state.switchingCanvas = true;
      document.documentElement.classList.add('canvas-switching');
      const socket = state.socket;
      state.socket = null;
      socket?.close(1000, 'Deleting canvas');
      disconnected = true;
    }
    const body = await requestDeleteCanvas(boardId);
    state.canvases = Array.isArray(body.canvases) ? body.canvases : await fetchCanvasCatalog();
    if (deletingCurrent) {
      state.boardId = state.canvases[0]?.id || null;
      resetCanvasRuntime();
      if (state.boardId) {
        setConnection('connecting');
        await restoreLocalBoardStateAndConnect();
      } else {
        setConnection('idle');
      }
    }
    renderCanvasCatalog();
    updateCurrentCanvasLabel();
    cancelSurfaceMorph(els.deleteCanvasDialog.querySelector('.canvas-dialog-card'));
    els.deleteCanvasDialog.hidden = true;
    state.canvasActionId = null;
    showToast('画布已删除');
  } catch (error) {
    console.warn('Could not delete canvas', error);
    showToast(error.message || '删除画布失败');
    if (deletingCurrent && disconnected && !state.socket) connect();
  } finally {
    state.deletingCanvas = false;
    state.switchingCanvas = false;
    document.documentElement.classList.remove('canvas-switching');
    els.confirmDeleteCanvas.disabled = false;
    els.cancelDeleteCanvas.disabled = false;
    updateCanvasStartState();
  }
}

function wireCanvasControls() {
  els.canvasList.addEventListener('pointerover', onCanvasListPointerOver);
  els.canvasList.addEventListener('pointerout', onCanvasListPointerOut);
  els.canvasList.addEventListener('focusin', onCanvasListFocusIn);
  els.canvasList.addEventListener('focusout', onCanvasListFocusOut);
  els.canvasSwitcherButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (els.canvasMenu.hidden || els.canvasMenu.dataset.menuClosing === 'true') void openCanvasMenu();
    else closeCanvasMenu();
  });
  els.newCanvasButton.addEventListener('click', openNewCanvasDialog);
  els.createFirstCanvasButton?.addEventListener('click', openNewCanvasDialog);
  els.newCanvasForm.addEventListener('submit', submitNewCanvas);
  els.cancelNewCanvas.addEventListener('click', closeNewCanvasDialog);
  els.newCanvasName.addEventListener('input', () => {
    els.newCanvasNameCount.textContent = `${Array.from(els.newCanvasName.value).length}/${state.maximumCanvasNameLength}`;
    setNewCanvasError('');
  });
  els.newCanvasDialog.addEventListener('click', (event) => {
    if (event.target === els.newCanvasDialog) closeNewCanvasDialog();
  });
  els.newCanvasDialog.addEventListener('keydown', (event) => {
    if (isImeEvent(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeNewCanvasDialog();
      return;
    }
    if (event.key === 'Tab') {
      const controls = [els.newCanvasName, els.cancelNewCanvas, els.confirmNewCanvas].filter(
        (control) => !control.disabled
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  els.renameCanvasForm.addEventListener('submit', submitRenameCanvas);
  els.cancelRenameCanvas.addEventListener('click', closeRenameCanvasDialog);
  els.renameCanvasName.addEventListener('input', () => {
    els.renameCanvasNameCount.textContent = `${Array.from(els.renameCanvasName.value).length}/${state.maximumCanvasNameLength}`;
    setRenameCanvasError('');
  });
  els.renameCanvasDialog.addEventListener('click', (event) => {
    if (event.target === els.renameCanvasDialog) closeRenameCanvasDialog();
  });
  els.renameCanvasDialog.addEventListener('keydown', (event) => {
    if (isImeEvent(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRenameCanvasDialog();
    }
  });
  els.cancelDeleteCanvas.addEventListener('click', closeDeleteCanvasDialog);
  els.confirmDeleteCanvas.addEventListener('click', deleteSelectedCanvas);
  els.deleteCanvasDialog.addEventListener('click', (event) => {
    if (event.target === els.deleteCanvasDialog) closeDeleteCanvasDialog();
  });
  els.deleteCanvasDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDeleteCanvasDialog();
    }
  });
}
export {
  fetchCanvasCatalog,
  loadCanvasCatalog,
  ownedCanvasCount,
  updateCurrentCanvasLabel,
  renderCanvasCatalog,
  toggleCanvasVisibility,
  positionCanvasMenu,
  openCanvasMenu,
  closeCanvasMenu,
  openNewCanvasDialog,
  closeNewCanvasDialog,
  setNewCanvasError,
  submitNewCanvas,
  setRenameCanvasError,
  openRenameCanvasDialog,
  closeRenameCanvasDialog,
  submitRenameCanvas,
  openDeleteCanvasDialog,
  closeDeleteCanvasDialog,
  requestDeleteCanvas,
  deleteSelectedCanvas,
  wireCanvasControls
};

export { configureCatalog };
