function sheetCellSearchMatches(item, query, limit = 50, options = {}) {
  const normalizedQuery = String(query || '')
    .trim()
    .toLocaleLowerCase('zh-CN');
  const sheets = Array.isArray(item?.workbook?.sheets) ? item.workbook.sheets : [];
  if (!normalizedQuery || !sheets.length) return [];
  const store = options.store || null;
  const matches = [];
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets[sheetIndex];
    const entries = Object.entries(sheet?.cells || {}).sort(([left], [right]) => {
      const [leftRow, leftColumn] = left.split(':').map(Number);
      const [rightRow, rightColumn] = right.split(':').map(Number);
      return leftRow - rightRow || leftColumn - rightColumn;
    });
    for (const [cellKey, cell] of entries) {
      if (!cell || typeof cell !== 'object') continue;
      const [row, column] = cellKey.split(':').map(Number);
      if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) continue;
      const raw = cell.f !== undefined ? String(cell.f) : cell.v !== undefined ? String(cell.v) : '';
      const display = store?.getDisplayValue?.(sheetIndex, row, column) || '';
      if (!`${raw} ${display}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery)) continue;
      const address = window.SheetFormula?.toA1?.(row, column) || `${column + 1}:${row + 1}`;
      matches.push({
        sheetId: sheet.sheetId,
        sheetIndex,
        sheetName: sheet.name || `Sheet${sheetIndex + 1}`,
        row,
        column,
        cellAddress: address,
        cellText: display || raw
      });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}

function sheetCellSearchResult(item, match, context) {
  return {
    canvasId: context.canvasId,
    canvasName: context.canvasName,
    documentId: `item:${item.id}:sheet:${match.sheetId || match.sheetIndex}:cell:${match.row}:${match.column}`,
    targetId: item.id,
    kind: 'sheet',
    label: `${match.sheetName}!${match.cellAddress}`,
    excerpt: match.cellText,
    sectionId: item.sectionId || null,
    sectionName: context.sectionName || '',
    x: Number(item.x) || 0,
    y: Number(item.y) || 0,
    ...match
  };
}
export { sheetCellSearchMatches, sheetCellSearchResult };
