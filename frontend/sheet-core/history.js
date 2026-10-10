'use strict';

const { MAX_UNDO_BYTES, MAX_UNDO_STEPS, cloneData, eachRangeCell, key } = require('./model');

function createHistory({ boundsCache, bumpCellVersion, emit, evaluator, invalidateGeometry, options, workbook }) {
  const undoStack = [];

  const redoStack = [];

  let undoBytes = 0;

  const maxUndoSteps = options.maxUndoSteps || MAX_UNDO_STEPS;

  const maxUndoBytes = options.maxUndoBytes || MAX_UNDO_BYTES;

  function snapshot() {
    return {
      sheets: cloneData(workbook.sheets),
      styles: cloneData(workbook.styles),
      formats: cloneData(workbook.formats),
      active: workbook.active,
      structureVersion: workbook.structureVersion
    };
  }

  function restore(state) {
    workbook.sheets = cloneData(state.sheets);
    workbook.styles = cloneData(state.styles);
    workbook.formats = cloneData(state.formats);
    workbook.active = Math.min(workbook.sheets.length - 1, Math.max(0, state.active ?? workbook.active));
    workbook.structureVersion = Math.max(0, Math.trunc(Number(state.structureVersion) || 0));
    evaluator.bumpEpoch();
    invalidateGeometry();
    emit({ type: 'restore' });
  }

  let mutating = false;
  const isMutating = () => mutating;

  function pushUndoEntry(entry) {
    undoStack.push(entry);
    undoBytes += entry.bytes;
    redoStack.length = 0;
    while (undoStack.length > maxUndoSteps || undoBytes > maxUndoBytes) {
      const dropped = undoStack.shift();
      if (!dropped) break;
      undoBytes -= dropped.bytes;
    }
  }

  function mutate(label, operation) {
    if (mutating) return operation();
    const before = snapshot();
    mutating = true;
    let result;
    try {
      result = operation();
    } finally {
      mutating = false;
    }
    if (result === false) return false;
    const bytes = JSON.stringify(before).length * 2;
    pushUndoEntry({ kind: 'snapshot', label, state: before, bytes });
    evaluator.bumpEpoch();
    emit({ type: 'change', label, result });
    return result;
  }

  function cellState(sheetIndex, row, column) {
    const cell = workbook.sheets[sheetIndex]?.cells?.[key(row, column)];
    return cell ? cloneData(cell) : null;
  }

  function applyCellState(entry, direction) {
    const sheet = workbook.sheets[entry.sheetIndex];
    if (!sheet) return false;
    const cellKey = key(entry.row, entry.column);
    const value = entry[direction];
    if (value) sheet.cells[cellKey] = cloneData(value);
    else delete sheet.cells[cellKey];
    bumpCellVersion(sheet, entry.row, entry.column);
    evaluator.invalidateCell(entry.sheetIndex, entry.row, entry.column);
    emit({ type: 'restore', label: entry.label });
    return true;
  }

  function mutateCell(label, sheetIndex, row, column, operation) {
    if (mutating) return operation();
    const before = cellState(sheetIndex, row, column);
    mutating = true;
    let result;
    try {
      result = operation();
    } finally {
      mutating = false;
    }
    if (result === false) return false;
    const after = cellState(sheetIndex, row, column);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const bytes = (JSON.stringify(before).length + JSON.stringify(after).length) * 2;
      pushUndoEntry({ kind: 'cell', label, sheetIndex, row, column, before, after, bytes });
    }
    emit({ type: 'change', label, result });
    return result;
  }

  function mutateCommand(label, redo, undo, bytes = 256) {
    const result = redo();
    if (result === false) return false;
    pushUndoEntry({ kind: 'command', label, redo, undo, bytes: Math.max(64, bytes) });
    evaluator.bumpEpoch();
    emit({ type: 'change', label, result });
    return result;
  }

  function mutateRange(label, sheetIndex, range, operation) {
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) return false;
    const before = [];
    eachRangeCell(range, (row, column) => before.push([row, column, cellState(sheetIndex, row, column)]));
    mutating = true;
    let result;
    try {
      result = operation();
    } finally {
      mutating = false;
    }
    if (result === false) return false;
    const after = before.map(([row, column]) => [row, column, cellState(sheetIndex, row, column)]);
    const apply = (entries) => {
      for (const [row, column, cell] of entries) {
        const cellKey = key(row, column);
        if (cell) sheet.cells[cellKey] = cloneData(cell);
        else delete sheet.cells[cellKey];
        bumpCellVersion(sheet, row, column);
        evaluator.invalidateCell(sheetIndex, row, column);
      }
      boundsCache.delete(sheet);
    };
    const bytes = (JSON.stringify(before).length + JSON.stringify(after).length) * 2;
    pushUndoEntry({ kind: 'command', label, undo: () => apply(before), redo: () => apply(after), bytes });
    evaluator.bumpEpoch();
    emit({ type: 'change', label, result });
    return result;
  }

  function edit(label, options, operation) {
    if (options && options.history === false) {
      const result = operation();
      evaluator.bumpEpoch();
      emit({ type: 'change', label, result });
      return result;
    }
    return mutate(label, operation);
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) return false;
    if (entry.kind === 'cell') {
      redoStack.push(entry);
      undoBytes -= entry.bytes;
      return applyCellState(entry, 'before');
    }
    if (entry.kind === 'command') {
      entry.undo();
      redoStack.push(entry);
      undoBytes -= entry.bytes;
      evaluator.bumpEpoch();
      emit({ type: 'restore', label: entry.label });
      return true;
    }
    const current = snapshot();
    redoStack.push({ kind: 'snapshot', label: entry.label, state: current, bytes: JSON.stringify(current).length * 2 });
    undoBytes -= entry.bytes;
    restore(entry.state);
    return true;
  }

  function redo() {
    const entry = redoStack.pop();
    if (!entry) return false;
    if (entry.kind === 'cell') {
      undoStack.push(entry);
      undoBytes += entry.bytes;
      return applyCellState(entry, 'after');
    }
    if (entry.kind === 'command') {
      entry.redo();
      undoStack.push(entry);
      undoBytes += entry.bytes;
      evaluator.bumpEpoch();
      emit({ type: 'restore', label: entry.label });
      return true;
    }
    const current = snapshot();
    undoStack.push({ kind: 'snapshot', label: entry.label, state: current, bytes: JSON.stringify(current).length * 2 });
    undoBytes += entry.bytes;
    restore(entry.state);
    return true;
  }

  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    undoBytes = 0;
  }

  return {
    isMutating,
    snapshot,
    restore,
    pushUndoEntry,
    mutate,
    cellState,
    applyCellState,
    mutateCell,
    mutateCommand,
    mutateRange,
    edit,
    canUndo,
    canRedo,
    undo,
    redo,
    clearHistory
  };
}

module.exports = { createHistory };
