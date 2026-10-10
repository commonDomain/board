'use strict';

const { element, iconButton } = require('./controls');

function createTabs({
  commitFormulaBar,
  focusGrid,
  onDirty,
  openContextMenu,
  options,
  renderer,
  selectionRange,
  sheetMenuItems,
  showPanelCard,
  state,
  statusBar,
  syncFormulaBar,
  syncHighlight,
  syncHorizontalScroll,
  syncToolbarState,
  tabsBar
}) {
  function buildTabs() {
    tabsBar.textContent = '';
    const store = state.store;
    if (!store) return;
    store.workbook.sheets.forEach((sheet, index) => {
      const tab = element('button', 'sheet-tab', sheet.name);
      tab.type = 'button';
      tab.dataset.sheetIndex = String(index);
      tab.classList.toggle('is-active', index === store.activeSheetIndex());
      tab.setAttribute('aria-selected', String(index === store.activeSheetIndex()));
      tab.addEventListener('click', () => {
        if (!commitFormulaBar()) return;
        if (state.store.setActiveSheet(index)) {
          renderer.setSheetIndex(index);
          buildTabs();
          afterModelChange();
        }
      });
      tab.addEventListener('dblclick', () => renameSheet(index));
      tab.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openSheetMenu(index, event.clientX, event.clientY);
      });
      tabsBar.appendChild(tab);
    });
    const add = iconButton('circle-plus', '新建工作表', 'sheet-tab-add');
    add.addEventListener('click', () => {
      if (state.store.addSheet()) {
        renderer.setSheetIndex(state.store.activeSheetIndex());
        buildTabs();
        afterModelChange();
        focusGrid();
      }
    });
    tabsBar.appendChild(add);
    options.lucide?.();
  }

  function requestSheetDelete(index, sheet) {
    const store = state.store;
    if (!store) return;
    if (store.workbook.sheets.length <= 1) {
      state.statusMessage = '至少保留一个工作表';
      updateStatus();
      return;
    }
    confirmDeleteCard(sheet.name, () => {
      if (store.removeSheet(index)) {
        renderer.setSheetIndex(store.activeSheetIndex());
        buildTabs();
        afterModelChange();
      }
    });
  }

  function openSheetMenu(index, clientX, clientY) {
    const store = state.store;
    const sheet = store?.workbook.sheets[index];
    if (!sheet) return;
    openContextMenu(sheetMenuItems(index), clientX, clientY);
  }

  function confirmDeleteCard(name, proceed) {
    showPanelCard((card) => {
      card.append(
        element('div', 'sheet-card-title', '删除工作表？'),
        element('div', 'sheet-card-note', `工作表「${name}」中的内容会一并删除，此操作可以用 Ctrl+Z 撤销。`)
      );
      const confirm = element('button', 'sheet-tool sheet-tool-primary', '删除');
      confirm.type = 'button';
      const cancel = element('button', 'sheet-tool', '取消');
      cancel.type = 'button';
      confirm.addEventListener('click', () => {
        card.remove();
        proceed();
        focusGrid();
      });
      cancel.addEventListener('click', () => {
        card.remove();
        focusGrid();
      });
      card.append(confirm, cancel);
      cancel.focus();
    });
  }

  function renameSheet(index) {
    const store = state.store;
    const sheet = store?.workbook.sheets[index];
    if (!sheet) return;
    showPanelCard((card) => {
      card.append(element('div', 'sheet-card-title', '重命名工作表'));
      const input = element('input', 'sheet-rename-input');
      input.value = sheet.name;
      input.setAttribute('aria-label', '工作表名称');
      const confirm = element('button', 'sheet-tool sheet-tool-primary', '确定');
      confirm.type = 'button';
      const cancel = element('button', 'sheet-tool', '取消');
      cancel.type = 'button';
      const finish = (accept) => {
        if (accept) {
          if (store.renameSheet(index, input.value)) {
            buildTabs();
            afterModelChange();
          } else {
            state.statusMessage = '工作表名重复或为空';
            updateStatus();
          }
        }
        card.remove();
        focusGrid();
      };
      confirm.addEventListener('click', () => finish(true));
      cancel.addEventListener('click', () => finish(false));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });
      card.append(input, confirm, cancel);
      input.focus();
      input.select();
    });
  }

  function updateStatus() {
    statusBar.textContent = '';
    const store = state.store;
    if (!store) return;
    const range = selectionRange();
    let count = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      for (let column = range.startColumn; column <= range.endColumn; column += 1) {
        const value = store.getNumericValue(store.activeSheetIndex(), row, column);
        const text = store.getDisplayValue(store.activeSheetIndex(), row, column);
        if (text !== '' && text !== null) count += 1;
        if (value !== null) {
          numericCount += 1;
          sum += value;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
    }
    const parts = [element('span', 'sheet-status-item', state.statusMessage || `已用 ${store.cellCount()} 个单元格`)];
    if (count) parts.push(element('span', 'sheet-status-item', `计数 ${count}`));
    if (numericCount) {
      parts.push(element('span', 'sheet-status-item', `求和 ${formatNumber(sum)}`));
      parts.push(element('span', 'sheet-status-item', `平均 ${formatNumber(sum / numericCount)}`));
      parts.push(element('span', 'sheet-status-item', `最小 ${formatNumber(min)}`));
      parts.push(element('span', 'sheet-status-item', `最大 ${formatNumber(max)}`));
    }
    statusBar.append(...parts);
    const saveState = element('span', 'sheet-status-item sheet-status-save');
    saveState.dataset.role = 'save-state';
    saveState.textContent = options.saveLabel ? options.saveLabel() : '已保存到画布';
    statusBar.appendChild(saveState);
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return '0';
    return String(Number(value.toPrecision(10)));
  }

  function afterModelChange(change) {
    renderer.requestDraw();
    syncHorizontalScroll();
    syncFormulaBar();
    updateStatus();
    syncToolbarState();
    syncHighlight();
    return onDirty(change);
  }

  return {
    buildTabs,
    requestSheetDelete,
    openSheetMenu,
    confirmDeleteCard,
    renameSheet,
    updateStatus,
    formatNumber,
    afterModelChange
  };
}

module.exports = { createTabs };
