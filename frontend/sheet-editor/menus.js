'use strict';

const Core = typeof window === 'object' ? window.SheetCore : require('../../public/sheet-core.js');
const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const { element } = require('./controls');

function createMenus({
  activeCell,
  afterModelChange,
  commitEdit,
  commitFormulaBar,
  contextMenu,
  copySelection,
  doc,
  focusGrid,
  formulaInput,
  gridCanvas,
  options,
  pasteSelection,
  renameSheet,
  renderer,
  requestSheetDelete,
  root,
  selection,
  selectionRange,
  state,
  syncFormulaBar,
  syncHighlight,
  syncToolbarState,
  updateStatus,
  view,
  visualViewport
}) {
  function restoreGridAfterMenuClose() {
    hideContextMenu();
    focusGrid();
  }

  function hideContextMenu() {
    if (contextMenu.hidden) return;
    contextMenu.hidden = true;
    contextMenu.textContent = '';
    doc.removeEventListener('pointerdown', dismissContextMenu, true);
    doc.removeEventListener('keydown', onContextMenuKey, true);
    doc.removeEventListener('wheel', restoreGridAfterMenuClose, true);
    view().removeEventListener('resize', restoreGridAfterMenuClose);
    visualViewport?.removeEventListener('resize', restoreGridAfterMenuClose);
    visualViewport?.removeEventListener('scroll', restoreGridAfterMenuClose);
  }

  function dismissContextMenu(event) {
    if (contextMenu.contains(event.target)) return;
    hideContextMenu();
  }

  function onContextMenuKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hideContextMenu();
      focusGrid();
      return;
    }
    const items = Array.from(contextMenu.querySelectorAll('.sheet-context-item:not(:disabled)'));
    if (!items.length) return;
    const current = items.indexOf(doc.activeElement);
    let next = current;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowUp')
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  }

  function openContextMenu(items, clientX, clientY) {
    contextMenu.textContent = '';
    contextMenu.hidden = false;
    for (const item of items) {
      if (!item || item.type === 'separator') {
        contextMenu.appendChild(element('div', 'sheet-context-separator'));
        continue;
      }
      const button = element('button', 'sheet-context-item');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      const label = element('span', 'sheet-context-label');
      if (item.icon) {
        const glyph = element('i');
        glyph.dataset.lucide = item.icon;
        glyph.setAttribute('aria-hidden', 'true');
        label.appendChild(glyph);
      }
      label.appendChild(doc.createTextNode(item.label || ''));
      button.appendChild(label);
      if (item.accelerator) {
        button.appendChild(element('span', 'sheet-context-accelerator', item.accelerator));
      } else if (item.children?.length) {
        const arrow = element('i', 'sheet-context-arrow');
        arrow.dataset.lucide = 'chevron-right';
        arrow.setAttribute('aria-hidden', 'true');
        button.appendChild(arrow);
      }
      button.disabled = item.disabled === true;
      if (item.danger) button.classList.add('danger');
      if (item.children?.length) {
        const submenu = element('div', 'sheet-context-submenu');
        submenu.hidden = true;
        submenu.setAttribute('role', 'menu');
        for (const child of item.children) {
          const childButton = element('button', 'sheet-context-item');
          childButton.type = 'button';
          childButton.setAttribute('role', 'menuitem');
          const childLabel = element('span', 'sheet-context-label');
          if (child.icon) {
            const glyph = element('i');
            glyph.dataset.lucide = child.icon;
            glyph.setAttribute('aria-hidden', 'true');
            childLabel.appendChild(glyph);
          }
          childLabel.appendChild(doc.createTextNode(child.label || ''));
          childButton.appendChild(childLabel);
          childButton.addEventListener('click', (event) => {
            event.stopPropagation();
            hideContextMenu();
            child.action?.();
            focusGrid();
          });
          submenu.appendChild(childButton);
        }
        const reveal = () => {
          contextMenu.querySelectorAll('.sheet-context-submenu').forEach((candidate) => {
            if (candidate !== submenu) candidate.hidden = true;
          });
          submenu.hidden = false;
        };
        button.addEventListener('pointerenter', reveal);
        // A real click is preceded by pointerenter. Toggling here therefore
        // closed the submenu at the exact moment the user clicked its parent.
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          reveal();
        });
        const holder = element('div', 'sheet-context-parent');
        holder.append(button, submenu);
        contextMenu.appendChild(holder);
        continue;
      }
      button.addEventListener('click', () => {
        hideContextMenu();
        if (typeof item.action === 'function') item.action();
        focusGrid();
      });
      contextMenu.appendChild(button);
    }
    contextMenu.hidden = false;
    // The editor is transformed on desktop, which makes fixed descendants use
    // the editor itself as their containing block. Position in the editor's
    // local coordinate system and clamp to the intersection with the visual
    // viewport so browser zoom and mobile keyboards cannot hide menu items.
    const bounds = root.getBoundingClientRect();
    const viewportLeft = visualViewport?.offsetLeft || 0;
    const viewportTop = visualViewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (visualViewport?.width || view().innerWidth);
    const viewportBottom = viewportTop + (visualViewport?.height || view().innerHeight);
    const safeLeft = Math.max(bounds.left + 4, viewportLeft + 4);
    const safeTop = Math.max(bounds.top + 4, viewportTop + 4);
    const safeRight = Math.min(bounds.right - 4, viewportRight - 4);
    const safeBottom = Math.min(bounds.bottom - 4, viewportBottom - 4);
    contextMenu.classList.toggle('open-left', clientX > (safeLeft + safeRight) / 2);
    options.lucide?.();
    contextMenu.style.maxHeight = `${Math.max(96, safeBottom - safeTop)}px`;
    const size = contextMenu.getBoundingClientRect();
    const left = Math.max(safeLeft, Math.min(clientX, safeRight - size.width));
    const top = Math.max(safeTop, Math.min(clientY, safeBottom - size.height));
    contextMenu.style.left = `${left - bounds.left}px`;
    contextMenu.style.top = `${top - bounds.top}px`;
    doc.addEventListener('pointerdown', dismissContextMenu, true);
    doc.addEventListener('keydown', onContextMenuKey, true);
    doc.addEventListener('wheel', restoreGridAfterMenuClose, true);
    view().addEventListener('resize', restoreGridAfterMenuClose);
    visualViewport?.addEventListener('resize', restoreGridAfterMenuClose);
    visualViewport?.addEventListener('scroll', restoreGridAfterMenuClose);
    const first = contextMenu.querySelector('.sheet-context-item:not(:disabled)');
    if (first) view().requestAnimationFrame(() => first.focus());
  }

  function cellMenuItems() {
    const store = state.store;
    const range = selectionRange();
    const multi = range.endRow > range.startRow || range.endColumn > range.startColumn;
    const cell = activeCell();
    const merged = store.mergeAt?.(cell.row, cell.column);
    const frozen = store.activeSheet().frozen;
    return [
      {
        label: '删除',
        icon: 'trash-2',
        danger: true,
        children: [
          {
            label: '右侧单元格左移',
            icon: 'panel-left-close',
            action: () => {
              store.deleteCells(range, 'left');
              afterModelChange();
            }
          },
          {
            label: '下方单元格上移',
            icon: 'panel-top-close',
            action: () => {
              store.deleteCells(range, 'up');
              afterModelChange();
            }
          },
          {
            label: '整行',
            icon: 'rows-3',
            action: () => {
              store.deleteRows(range.startRow, range.endRow - range.startRow + 1);
              afterModelChange();
            }
          },
          {
            label: '整列',
            icon: 'columns-3',
            action: () => {
              store.deleteColumns(range.startColumn, range.endColumn - range.startColumn + 1);
              afterModelChange();
            }
          }
        ]
      },
      {
        label: '插入',
        icon: 'between-horizontal-start',
        children: [
          {
            label: '在上方插入行',
            icon: 'rows-3',
            action: () => {
              store.insertRows(range.startRow, range.endRow - range.startRow + 1);
              afterModelChange();
            }
          },
          {
            label: '在下方插入行',
            icon: 'rows-3',
            action: () => {
              store.insertRows(range.endRow + 1, range.endRow - range.startRow + 1);
              afterModelChange();
            }
          },
          {
            label: '在左侧插入列',
            icon: 'columns-3',
            action: () => {
              store.insertColumns(range.startColumn, range.endColumn - range.startColumn + 1);
              afterModelChange();
            }
          },
          {
            label: '在右侧插入列',
            icon: 'columns-3',
            action: () => {
              store.insertColumns(range.endColumn + 1, range.endColumn - range.startColumn + 1);
              afterModelChange();
            }
          }
        ]
      },
      {
        label: '清除内容',
        icon: 'eraser',
        children: [
          {
            label: '清除全部',
            icon: 'trash-2',
            action: () => {
              store.clearRange(range, 'all');
              afterModelChange();
            }
          },
          {
            label: '清除格式',
            icon: 'paintbrush',
            action: () => {
              store.clearRange(range, 'format');
              afterModelChange();
            }
          },
          {
            label: '清除内容',
            icon: 'eraser',
            action: () => {
              store.clearRange(range, 'content');
              afterModelChange();
            }
          },
          {
            label: '清除数据（保留公式）',
            icon: 'database',
            action: () => {
              store.clearRange(range, 'data');
              afterModelChange();
            }
          },
          {
            label: '清除公式（保留值）',
            icon: 'sigma',
            action: () => {
              store.clearRange(range, 'formula');
              afterModelChange();
            }
          }
        ]
      },
      { type: 'separator' },
      { label: '复制', accelerator: 'Ctrl+C', action: () => copySelection() },
      { label: '剪切', accelerator: 'Ctrl+X', action: () => copySelection(true) },
      { label: '粘贴', accelerator: 'Ctrl+V', action: () => pasteSelection() },
      { type: 'separator' },
      ...(multi
        ? [
            {
              label: '合并单元格',
              action: () => {
                store.mergeCells(range);
                afterModelChange();
              }
            }
          ]
        : []),
      ...(merged
        ? [
            {
              label: '取消合并',
              action: () => {
                store.unmergeCells(merged);
                afterModelChange();
              }
            }
          ]
        : []),
      ...(multi || merged ? [{ type: 'separator' }] : []),
      {
        label: frozen.rows || frozen.cols ? '取消冻结' : '冻结到当前单元格',
        action: () => {
          const next =
            frozen.rows || frozen.cols ? { rows: 0, cols: 0 } : { rows: range.startRow, cols: range.startColumn };
          store.setFreeze(next.rows, next.cols);
          state.statusMessage = next.rows || next.cols ? `已冻结 ${next.rows} 行 / ${next.cols} 列` : '已取消冻结';
          afterModelChange();
        }
      }
    ];
  }

  function rowMenuItems(row) {
    const store = state.store;
    return [
      {
        label: `在上方插入行`,
        action: () => {
          store.insertRows(row, 1);
          afterModelChange();
        }
      },
      {
        label: `在下方插入行`,
        action: () => {
          store.insertRows(row + 1, 1);
          afterModelChange();
        }
      },
      { type: 'separator' },
      {
        label: `删除第 ${row + 1} 行`,
        danger: true,
        action: () => {
          store.deleteRows(row, 1);
          afterModelChange();
        }
      },
      {
        label: `隐藏第 ${row + 1} 行`,
        action: () => {
          store.setRowsHidden(row, row, true);
          afterModelChange();
        }
      },
      {
        label: '取消隐藏全部行',
        disabled: !store.activeSheet().hiddenRows,
        action: () => {
          store.setRowsHidden(0, Core.MAX_DISPLAY_ROWS - 1, false);
          afterModelChange();
        }
      },
      { type: 'separator' },
      {
        label: '清除本行内容',
        danger: true,
        action: () => {
          store.clearRange(
            { startRow: row, startColumn: 0, endRow: row, endColumn: store.displayBounds(4096).columns - 1 },
            'content'
          );
          afterModelChange();
        }
      }
    ];
  }

  function columnMenuItems(column) {
    const store = state.store;
    const name = Formula.columnToName(column);
    return [
      {
        label: `在左侧插入列`,
        action: () => {
          store.insertColumns(column, 1);
          afterModelChange();
        }
      },
      {
        label: `在右侧插入列`,
        action: () => {
          store.insertColumns(column + 1, 1);
          afterModelChange();
        }
      },
      { type: 'separator' },
      {
        label: `删除 ${name} 列`,
        danger: true,
        action: () => {
          store.deleteColumns(column, 1);
          afterModelChange();
        }
      },
      {
        label: `隐藏 ${name} 列`,
        action: () => {
          store.setColumnsHidden(column, column, true);
          afterModelChange();
        }
      },
      {
        label: '取消隐藏全部列',
        disabled: !store.activeSheet().hiddenColumns,
        action: () => {
          store.setColumnsHidden(0, Core.MAX_DISPLAY_COLUMNS - 1, false);
          afterModelChange();
        }
      },
      { type: 'separator' },
      {
        label: '自动调整列宽',
        action: () => {
          store.autoFitColumn(column, store.usedBounds().rows);
          afterModelChange();
        }
      },
      {
        label: '清除本列内容',
        danger: true,
        action: () => {
          store.clearRange(
            { startRow: 0, startColumn: column, endRow: store.displayBounds(4096).rows - 1, endColumn: column },
            'content'
          );
          afterModelChange();
        }
      }
    ];
  }

  function sheetMenuItems(index) {
    const store = state.store;
    const sheet = store.workbook.sheets[index];
    return [
      { label: '重命名', action: () => renameSheet(index) },
      {
        label: '删除工作表',
        danger: true,
        disabled: store.workbook.sheets.length <= 1,
        action: () => requestSheetDelete(index, sheet)
      }
    ];
  }

  function onGridContextMenu(event) {
    const store = state.store;
    if (!store) return;
    // The panel owns this gesture completely: no canvas context menu, no
    // canvas pointer capture, and no bubbling past the editor.
    event.preventDefault();
    event.stopPropagation();
    if (state.editing && commitEdit(null) === false) return;
    if (formulaInput()?.dataset.dirty === 'true' && !commitFormulaBar()) return;
    const headerColumn = renderer.headerColumnAt(event.clientX, event.clientY);
    const headerRow = renderer.headerRowAt(event.clientX, event.clientY);
    if (headerColumn !== null && headerColumn !== undefined) {
      renderer.setSelection(0, headerColumn);
      selection().focus.row = Math.max(0, store.usedBounds().rows - 1);
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      renderer.requestDraw();
      openContextMenu(columnMenuItems(headerColumn), event.clientX, event.clientY);
      return;
    }
    if (headerRow !== null && headerRow !== undefined) {
      renderer.setSelection(headerRow, 0);
      selection().focus.column = Math.max(0, store.usedBounds().columns - 1);
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      renderer.requestDraw();
      openContextMenu(rowMenuItems(headerRow), event.clientX, event.clientY);
      return;
    }
    const cell = renderer.cellAt(event.clientX, event.clientY);
    if (!cell) return;
    if (state.formatPainter) {
      renderer.setSelection(cell.row, cell.column);
      store.applyStyle(
        { startRow: cell.row, startColumn: cell.column, endRow: cell.row, endColumn: cell.column },
        state.formatPainter
      );
      state.formatPainter = null;
      state.statusMessage = '格式已应用';
      gridCanvas.style.cursor = 'cell';
      afterModelChange();
      event.preventDefault();
      return;
    }
    // Right-clicking outside the current selection moves it, like Excel.
    if (!selection().contains(cell.row, cell.column)) {
      renderer.setSelection(cell.row, cell.column);
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      syncToolbarState();
    }
    openContextMenu(cellMenuItems(), event.clientX, event.clientY);
  }

  return {
    restoreGridAfterMenuClose,
    hideContextMenu,
    dismissContextMenu,
    onContextMenuKey,
    openContextMenu,
    cellMenuItems,
    rowMenuItems,
    columnMenuItems,
    sheetMenuItems,
    onGridContextMenu
  };
}

module.exports = { createMenus };
