function ensureSheetModules() {
  return Boolean(
    window.SheetProtocol && window.SheetCore && window.SheetView && window.SheetEditor && window.SheetFormula
  );
}

function sheetWorkbooksEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function sheetDraftKey(boardId, itemId) {
  return `${window.WhiteboardStorage?.getScope?.() || 'legacy'}:${boardId}:${itemId}`;
}
export { ensureSheetModules, sheetWorkbooksEqual, sheetDraftKey };
