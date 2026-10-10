'use strict';
const Core = typeof window === 'object' ? window.SheetCore : require('../../public/sheet-core.js');
const { element } = require('./controls');
function createSurface({ doc, editorId, labeledTool, withAction }) {
  const root = element('div', 'sheet-editor');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '工作表编辑器');

  const header = element('div', 'sheet-editor-header');
  const identity = element('div', 'sheet-editor-identity');
  const identityIcon = element('i');
  identityIcon.dataset.lucide = 'file-spreadsheet';
  identityIcon.setAttribute('aria-hidden', 'true');
  const titleWrap = element('div', 'sheet-editor-title-wrap');
  const titleButton = element('button', 'sheet-editor-title-button');
  titleButton.type = 'button';
  titleButton.title = '重命名工作表';
  titleButton.setAttribute('aria-label', '重命名工作表');
  const title = element('strong', 'sheet-editor-title', '工作表');
  title.dataset.role = 'editor-title';
  const titleEditIcon = element('i', 'sheet-editor-title-edit-icon');
  titleEditIcon.dataset.lucide = 'pencil';
  titleEditIcon.setAttribute('aria-hidden', 'true');
  titleButton.append(title, titleEditIcon);
  titleWrap.append(titleButton);
  identity.append(identityIcon, titleWrap);
  const headerActions = element('div', 'sheet-editor-header-actions');
  const headerSaveState = element('span', 'sheet-editor-save-pill', '已保存到画布');
  headerSaveState.dataset.role = 'header-save-state';
  headerSaveState.setAttribute('role', 'status');
  headerSaveState.setAttribute('aria-live', 'polite');
  const headerDone = labeledTool('check', '完成');
  headerDone.classList.add('sheet-tool-primary', 'sheet-editor-done');
  headerDone.title = '完成（Ctrl+S 保存，Esc 返回画布）';
  withAction(headerDone, 'close');
  headerActions.append(headerSaveState, headerDone);
  header.append(identity, headerActions);
  const toolbar = element('div', 'sheet-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  const formulaBar = element('div', 'sheet-formula-bar');
  const gridWrap = element('div', 'sheet-grid-wrap');
  const gridCanvas = element('canvas', 'sheet-grid');
  gridCanvas.setAttribute('role', 'grid');
  gridCanvas.setAttribute('aria-label', '工作表网格');
  gridCanvas.setAttribute('aria-rowcount', String(Core.MAX_DISPLAY_ROWS));
  gridCanvas.setAttribute('aria-colcount', String(Core.MAX_DISPLAY_COLUMNS));
  const activeCellProxy = element('div', 'sheet-a11y-cell');
  activeCellProxy.id = `sheet-active-cell-${editorId}`;
  activeCellProxy.setAttribute('role', 'gridcell');
  gridCanvas.setAttribute('aria-activedescendant', activeCellProxy.id);
  gridWrap.appendChild(gridCanvas);
  const editorOverlay = element('textarea', 'sheet-cell-editor');
  editorOverlay.hidden = true;
  editorOverlay.spellcheck = false;
  editorOverlay.setAttribute('aria-label', '单元格内容');
  const cellFormulaAssist = element('div', 'sheet-cell-formula-assist');
  cellFormulaAssist.hidden = true;
  cellFormulaAssist.setAttribute('role', 'listbox');
  gridWrap.append(editorOverlay, cellFormulaAssist, activeCellProxy);
  const horizontalScroll = element('div', 'sheet-horizontal-scroll');
  horizontalScroll.setAttribute('aria-label', '工作表横向滚动条');
  horizontalScroll.tabIndex = 0;
  const horizontalScrollTrack = element('div', 'sheet-horizontal-scroll-track');
  horizontalScroll.appendChild(horizontalScrollTrack);
  const tabsBar = element('div', 'sheet-tabs');
  const statusBar = element('div', 'sheet-status');
  root.append(header, toolbar, formulaBar, gridWrap, horizontalScroll, tabsBar, statusBar);
  return {
    root,
    header,
    identity,
    identityIcon,
    titleWrap,
    titleButton,
    title,
    titleEditIcon,
    headerActions,
    headerSaveState,
    headerDone,
    toolbar,
    formulaBar,
    gridWrap,
    gridCanvas,
    activeCellProxy,
    editorOverlay,
    cellFormulaAssist,
    horizontalScroll,
    horizontalScrollTrack,
    tabsBar,
    statusBar
  };
}
module.exports = { createSurface };
