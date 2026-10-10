'use strict';
function wireEditorEvents({
  beginTitleRename,
  close,
  onEditorKeyDown,
  lockMatches,
  requestCellLock,
  onEditorInput,
  commitEdit,
  onGridPointerDown,
  onGridPointerMove,
  onGridPointerUp,
  onGridDoubleClick,
  onGridWheel,
  onGridKeyDown,
  onCopyEvent,
  onPasteEvent,
  onGridContextMenu,
  closeToolbarMenus,
  buildToolbar,
  buildFormulaBar,
  buildTabs,
  titleButton,
  headerDone,
  editorOverlay,
  state,
  renderer,
  gridCanvas,
  horizontalScroll,
  gridWrap,
  root,
  view,
  onViewportResize,
  doc,
  dismissToolbarMenus
}) {
  const touchSelect = doc.createElement('button'); touchSelect.type = 'button'; touchSelect.className = 'sheet-touch-select';
  touchSelect.textContent = '拖动选择区域'; touchSelect.setAttribute('aria-pressed', 'false');
  touchSelect.addEventListener('click', () => { state.touchSelect = !state.touchSelect; touchSelect.setAttribute('aria-pressed', String(state.touchSelect)); touchSelect.textContent = state.touchSelect ? '选择模式 · 点击切换滚动' : '拖动选择区域'; });
  headerDone.before(touchSelect);
  titleButton.addEventListener('click', beginTitleRename);
  headerDone.addEventListener('click', close);
  editorOverlay.addEventListener('keydown', onEditorKeyDown);
  editorOverlay.addEventListener('focus', async () => {
    if (!state.editing || state.startingEdit || lockMatches(state.editing.row, state.editing.column)) return;
    editorOverlay.readOnly = true;
    const lock = await requestCellLock(state.editing.row, state.editing.column);
    if (lock && state.editing) editorOverlay.readOnly = false;
  });
  editorOverlay.addEventListener('compositionstart', () => {
    state.cellComposing = true;
  });
  editorOverlay.addEventListener('compositionend', () => {
    state.cellComposing = false;
    onEditorInput();
  });
  editorOverlay.addEventListener('input', onEditorInput);
  editorOverlay.addEventListener('blur', () => {
    if (state.editing) {
      commitEdit(null);
      renderer.requestDraw();
    }
  });
  gridCanvas.addEventListener('pointerdown', onGridPointerDown);
  gridCanvas.addEventListener('pointermove', onGridPointerMove);
  gridCanvas.addEventListener('pointerup', onGridPointerUp);
  gridCanvas.addEventListener('pointercancel', onGridPointerUp);
  gridCanvas.addEventListener('dblclick', onGridDoubleClick);
  gridCanvas.addEventListener('wheel', onGridWheel, { passive: false });
  horizontalScroll.addEventListener(
    'scroll',
    () => {
      const scroll = renderer.getScroll();
      renderer.setScroll(scroll.top, horizontalScroll.scrollLeft);
    },
    { passive: true }
  );
  gridCanvas.addEventListener('keydown', onGridKeyDown);
  gridCanvas.addEventListener('copy', onCopyEvent);
  gridCanvas.addEventListener('paste', onPasteEvent);
  gridCanvas.addEventListener('contextmenu', onGridContextMenu);
  gridWrap.addEventListener('contextmenu', onGridContextMenu);
  root.addEventListener('contextmenu', (event) => {
    if (
      event.target.closest?.(
        'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
  });
  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('.sheet-color, .sheet-border-picker, .sheet-menu-picker')) closeToolbarMenus();
    if (event.target === root) event.preventDefault();
  });
  root.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  root.addEventListener('keydown', (event) => event.stopPropagation());
  root.addEventListener('keyup', (event) => event.stopPropagation());
  view().addEventListener('resize', onViewportResize);
  view().visualViewport?.addEventListener('resize', onViewportResize);
  view().visualViewport?.addEventListener('scroll', onViewportResize);
  doc.addEventListener('pointerdown', dismissToolbarMenus, true);
  buildToolbar();
  buildFormulaBar();
  buildTabs();
}
module.exports = { wireEditorEvents };
