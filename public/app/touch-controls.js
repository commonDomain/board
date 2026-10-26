import { openTouchSettings } from './touch-preferences.js';
import { state } from './state.js';
import { finishEditing, startEditingItem } from './editing.js';
import { showContextMenu } from './selection.js';
import { openSheetEditor } from './sheet-editor.js';
import { cancelActiveGesture } from './gestures.js';
import { cancelConnectorDraft } from './drawing-model.js';
import { setTool } from './toolbar.js';
import { showToast } from './interface-model.js';
import { canMutateItem } from './layers-model.js';
import { startMindNodeEdit } from './mindmap-editing.js';
import { resetRotation, scheduleCameraApply } from './camera.js';

export function wireTouchControls() {
  const toolbar = document.createElement('div');
  toolbar.className = 'touch-actions'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '触控操作');
  const add = (label, action) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', action); toolbar.append(button); return button;
  };
  add('触控设置', openTouchSettings);
  add('回正', resetRotation);
  const multi = add('多选', () => {
    finishEditing(); state.touchMultiSelect = !state.touchMultiSelect; setTool('select');
    multi.setAttribute('aria-pressed', String(state.touchMultiSelect));
  });
  multi.setAttribute('aria-pressed', 'false');
  add('编辑', () => {
    const item = state.items.get(state.selectedId);
    if (!item || !canMutateItem(item)) return showToast('请先选择可编辑的内容');
    if (item.type === 'sheet') return openSheetEditor(item.id);
    if (item.type === 'mindmap') return startMindNodeEdit(item, state.mindmapSelection?.itemId === item.id ? state.mindmapSelection.path : []);
    if (['text', 'note', 'table'].includes(item.type)) return startEditingItem(item.id, { focusTable: item.type === 'table' });
    showToast('拖动选中内容，或使用手柄调整尺寸');
  });
  add('更多', () => {
    const viewport = document.getElementById('viewport');
    const item = [...viewport.querySelectorAll('.board-item')].find(node => node.dataset.itemId === state.selectedId);
    const rect = toolbar.getBoundingClientRect();
    showContextMenu({ target: item || viewport, clientX: rect.left, clientY: rect.top, preventDefault() {} });
  });
  add('完成', () => { finishEditing(); state.mindmapEditing?.finish?.(true); document.activeElement?.blur(); });
  add('取消', () => {
    cancelActiveGesture(); cancelConnectorDraft(); state.touchMultiSelect = false;
    multi.setAttribute('aria-pressed', 'false'); setTool('select');
    window.dispatchEvent(new CustomEvent('muse:cancel-placement'));
  });
  toolbar.addEventListener('pointerdown', event => { event.stopPropagation(); if (event.pointerType !== 'touch') event.preventDefault(); });
  document.querySelector('.app').append(toolbar);
  let caretFrame = null;
  const revealCaret = () => {
    if (caretFrame) cancelAnimationFrame(caretFrame);
    caretFrame = requestAnimationFrame(() => {
      caretFrame = null;
      const editor = document.activeElement;
      if (!document.documentElement.classList.contains('soft-keyboard-open') || !editor?.closest('#viewport') || !editor.isContentEditable) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.focusNode)) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect.height) return;
      const visual = window.visualViewport;
      const top = (visual?.offsetTop || 0) + 20;
      const bottom = (visual?.offsetTop || 0) + (visual?.height || innerHeight) - 76;
      const dy = rect.bottom > bottom ? bottom - rect.bottom : rect.top < top ? top - rect.top : 0;
      if (dy) { state.camera.y += dy; scheduleCameraApply(); }
    });
  };
  window.visualViewport?.addEventListener('resize', revealCaret);
  document.getElementById('viewport').addEventListener('input', revealCaret);
}
