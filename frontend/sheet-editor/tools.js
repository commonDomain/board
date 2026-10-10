'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const { FILTER_OPERATORS, element } = require('./controls');

function createTools({
  afterModelChange,
  buildTabs,
  doc,
  focusGrid,
  options,
  renderer,
  root,
  selectionRange,
  state,
  syncFormulaBar,
  syncHighlight,
  updateStatus,
  view
}) {
  function showPanelCard(build) {
    root.querySelectorAll('.sheet-card').forEach((existing) => existing.remove());
    const card = element('div', 'sheet-card');
    build(card);
    root.appendChild(card);
    return card;
  }

  function selectMatch(match) {
    if (!match) return;
    renderer.setSelection(match.row, match.column);
    renderer.scrollCellIntoView(match.row, match.column);
    syncHighlight();
    syncFormulaBar();
    updateStatus();
  }

  function openFindReplace() {
    const store = state.store;
    if (!store) return;
    showPanelCard((card) => {
      card.classList.add('sheet-find-card');
      card.append(element('div', 'sheet-card-title', '查找与替换'));
      const find = element('input', 'sheet-rename-input');
      find.placeholder = '查找内容';
      find.setAttribute('aria-label', '查找内容');
      const replacement = element('input', 'sheet-rename-input');
      replacement.placeholder = '替换为';
      replacement.setAttribute('aria-label', '替换为');
      const optionsRow = element('label', 'sheet-card-check');
      const caseSensitive = element('input');
      caseSensitive.type = 'checkbox';
      optionsRow.append(caseSensitive, doc.createTextNode(' 区分大小写'));
      const summary = element('div', 'sheet-card-note', '输入内容后查找');
      summary.setAttribute('role', 'status');
      summary.setAttribute('aria-live', 'polite');
      let matches = [];
      let matchIndex = -1;
      const refresh = () => {
        matches = store.findMatches(find.value, { caseSensitive: caseSensitive.checked });
        matchIndex = matches.length ? (matchIndex + 1) % matches.length : -1;
        if (matchIndex >= 0) {
          selectMatch(matches[matchIndex]);
          const match = matches[matchIndex];
          summary.textContent = `${matchIndex + 1} / ${matches.length} · ${Formula.toA1(match.row, match.column)}`;
        } else summary.textContent = find.value ? '未找到匹配内容' : '输入内容后查找';
      };
      const actions = element('div', 'sheet-card-row');
      const next = element('button', 'sheet-tool sheet-tool-primary', '查找下一个');
      next.type = 'button';
      const replaceAll = element('button', 'sheet-tool sheet-tool-wide sheet-dialog-button', '全部替换');
      replaceAll.type = 'button';
      const closeButton = element('button', 'sheet-tool sheet-dialog-button', '关闭');
      closeButton.type = 'button';
      next.addEventListener('click', refresh);
      replaceAll.addEventListener('click', () => {
        if (!find.value) return;
        const count = store.replaceAll(find.value, replacement.value, { caseSensitive: caseSensitive.checked });
        state.statusMessage = count ? `已替换 ${count} 处` : '没有可替换的内容';
        afterModelChange();
        matchIndex = -1;
        refresh();
      });
      closeButton.addEventListener('click', () => {
        card.remove();
        focusGrid();
      });
      find.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          refresh();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          card.remove();
          focusGrid();
        }
      });
      caseSensitive.addEventListener('change', () => {
        matchIndex = -1;
        refresh();
      });
      actions.append(next, replaceAll, closeButton);
      card.append(find, replacement, optionsRow, summary, actions);
      find.focus();
    });
  }

  function openShortcutHelp() {
    showPanelCard((card) => {
      card.classList.add('sheet-shortcut-card');
      card.append(element('div', 'sheet-card-title', '工作表快捷键'));
      const shortcuts = [
        ['Ctrl/Cmd + F', '查找与替换'],
        ['Ctrl/Cmd + Z', '撤销'],
        ['Ctrl/Cmd + Y', '重做'],
        ['Ctrl/Cmd + B / I / U', '加粗 / 斜体 / 下划线'],
        ['F2 / Enter', '编辑单元格'],
        ['Tab / Shift+Tab', '向右 / 向左移动'],
        ['Delete', '清空内容'],
        ['Esc', '取消或返回画布']
      ];
      const list = element('div', 'sheet-shortcut-list');
      for (const [keys, label] of shortcuts) {
        const row = element('div', 'sheet-shortcut-row');
        row.append(element('kbd', null, keys), element('span', null, label));
        list.appendChild(row);
      }
      const closeButton = element('button', 'sheet-tool sheet-tool-primary sheet-tool-wide', '知道了');
      closeButton.type = 'button';
      closeButton.addEventListener('click', () => {
        card.remove();
        focusGrid();
      });
      card.append(list, closeButton);
      closeButton.focus();
    });
  }

  function openFilterDialog() {
    const store = state.store;
    if (!store) return;
    const range = selectionRange();
    if (range.endColumn !== range.startColumn) {
      state.statusMessage = '请先选中要筛选的列';
      updateStatus();
      return;
    }
    const existing = store.activeFilters();
    const current = existing.criteria?.find((entry) => entry.column === range.startColumn);
    showPanelCard((card) => {
      card.classList.add('sheet-find-card');
      card.append(element('div', 'sheet-card-title', `筛选 ${Formula.columnToName(range.startColumn)} 列`));
      const operator = element('select', 'sheet-select');
      for (const entry of FILTER_OPERATORS) {
        const option = element('option', null, entry.label);
        option.value = entry.id;
        operator.appendChild(option);
      }
      operator.value = current?.operator || 'contains';
      const value = element('input', 'sheet-rename-input');
      value.value = current?.value ?? '';
      value.placeholder = '筛选值';
      const syncDisabled = () => {
        value.disabled = operator.value === 'blank' || operator.value === 'notBlank';
      };
      operator.addEventListener('change', syncDisabled);
      syncDisabled();

      const apply = element('button', 'sheet-tool sheet-tool-primary', '应用');
      apply.type = 'button';
      const clear = element('button', 'sheet-tool sheet-tool-wide sheet-dialog-button', '清除');
      clear.type = 'button';
      const cancel = element('button', 'sheet-tool sheet-dialog-button', '取消');
      cancel.type = 'button';

      apply.addEventListener('click', () => {
        const hidden = store.applyFilter(range, {
          [range.startColumn]: { operator: operator.value, value: value.value }
        });
        state.statusMessage = hidden ? `已隐藏 ${hidden} 行` : '没有行被隐藏';
        card.remove();
        afterModelChange();
        focusGrid();
      });
      clear.addEventListener('click', () => {
        store.clearFilter();
        state.statusMessage = '已清除筛选';
        card.remove();
        afterModelChange();
        focusGrid();
      });
      cancel.addEventListener('click', () => {
        card.remove();
        focusGrid();
      });
      value.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          apply.click();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          card.remove();
          focusGrid();
        }
      });
      const actions = element('div', 'sheet-card-row');
      actions.append(apply, clear, cancel);
      card.append(operator, value, actions);
      value.focus();
      value.select();
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    (doc.body || root).appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function workbookTitle() {
    const title = options.title ? options.title() : '工作表';
    return String(title || '工作表')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 60);
  }

  let xlsxLoadPromise = null;

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = source;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`组件加载失败：${source}`));
      (doc.head || doc.documentElement).appendChild(script);
    });
  }

  async function ensureXlsx() {
    if (view().SheetXlsx) return view().SheetXlsx;
    if (!xlsxLoadPromise) {
      xlsxLoadPromise = (async () => {
        if (!view().FFlate) await loadScript('vendor/fflate.min.js');
        if (!view().SheetXlsx) await loadScript('sheet-xlsx.js');
        if (!view().SheetXlsx) throw new Error('xlsx 组件加载失败');
        return view().SheetXlsx;
      })().catch((error) => {
        xlsxLoadPromise = null;
        throw error;
      });
    }
    return xlsxLoadPromise;
  }

  async function exportXlsx() {
    const store = state.store;
    if (!store) return;
    let xlsx;
    try {
      xlsx = await ensureXlsx();
    } catch (error) {
      state.statusMessage = error.message;
      updateStatus();
      return;
    }
    const activeIndex = store.activeSheetIndex();
    const sheets = store.workbook.sheets.map((sheet, index) => ({
      name: sheet.name,
      matrix: store.matrixForSheet(index),
      cols: sheet.cols,
      rows: sheet.rows,
      hiddenRows: sheet.hiddenRows,
      hiddenColumns: sheet.hiddenColumns,
      merges: sheet.merges,
      frozen: sheet.frozen,
      styleAt: (row, column) => store.getStyleOf(index, row, column)
    }));
    store.setActiveSheet(activeIndex);
    try {
      downloadBlob(xlsx.toBlob(sheets), `${workbookTitle()}.xlsx`);
      state.statusMessage = '已导出 xlsx';
    } catch (error) {
      state.statusMessage = `导出失败：${error.message}`;
    }
    updateStatus();
  }

  function exportCsv() {
    const store = state.store;
    if (!store) return;
    // A BOM keeps Excel from mis-detecting UTF-8 for Chinese text.
    const blob = new Blob([`\ufeff${store.toCsv()}`], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${workbookTitle()}.csv`);
    state.statusMessage = '已导出 CSV';
    updateStatus();
  }

  async function importXlsx() {
    const store = state.store;
    if (!store) return;
    let xlsx;
    try {
      xlsx = await ensureXlsx();
    } catch (error) {
      state.statusMessage = error.message;
      updateStatus();
      return;
    }
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          state.statusMessage = '正在安全解析 xlsx…';
          updateStatus();
          const parsed = await (xlsx.readXlsxAsync
            ? xlsx.readXlsxAsync(new Uint8Array(reader.result))
            : xlsx.readXlsx(new Uint8Array(reader.result)));
          if (!parsed.sheets.length) throw new Error('工作簿中没有工作表');
          // Option B: keep the file's own sheet structure instead of
          // overwriting what the canvas already holds. One undo step.
          const result = store.importSheets(parsed.sheets);
          if (!result.sheets) throw new Error('工作簿中没有可导入的工作表');
          const names = parsed.sheets.map((sheet) => sheet.name).join('、');
          const importedMessage =
            result.sheets > 1
              ? `已导入 ${result.sheets} 个工作表（${names}），共 ${result.cells} 个单元格`
              : `已导入工作表「${names}」，共 ${result.cells} 个单元格`;
          state.statusMessage = parsed.warnings?.length
            ? `${importedMessage}；注意：${parsed.warnings.join('；')}`
            : importedMessage;
          renderer.setSheetIndex(store.activeSheetIndex());
          buildTabs();
          afterModelChange();
        } catch (error) {
          state.statusMessage = `导入失败：${error.message}`;
          updateStatus();
        }
        focusGrid();
      };
      reader.onerror = () => {
        state.statusMessage = '读取文件失败';
        updateStatus();
      };
      reader.readAsArrayBuffer(file);
    });
    (doc.body || root).appendChild(input);
    input.click();
  }

  return {
    showPanelCard,
    selectMatch,
    openFindReplace,
    openShortcutHelp,
    openFilterDialog,
    downloadBlob,
    workbookTitle,
    loadScript,
    ensureXlsx,
    exportXlsx,
    exportCsv,
    importXlsx
  };
}

module.exports = { createTools };
