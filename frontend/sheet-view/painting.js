'use strict';

const Core = typeof window === 'object' ? window.SheetCore : require('../../public/sheet-core.js');
const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const { FILL_HANDLE_SIZE, fontString } = require('./controls');

function createPainting({
  bandFor,
  cellSize,
  columnX,
  context,
  displayColumnWidth,
  displayRowHeight,
  frozen,
  headerOffsetX,
  headerOffsetY,
  hiddenRowRunY,
  hiddenRowRuns,
  hiddenRowSet,
  paintBands,
  paintHighlight,
  rowY,
  state,
  viewport
}) {
  function draw() {
    const storeRef = state.store;
    const ctx = context;
    const palette = state.palette;
    if (!ctx) return;
    // Refresh the filtered row set before any geometry is computed.
    state.hiddenRows = hiddenRowSet();
    const scale = state.pixelRatio;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = palette.surface;
    ctx.fillRect(0, 0, state.width, state.height);
    if (!storeRef) return;
    const view = viewport();
    if (!view) return;

    const fontSize = state.metrics.baseSize;
    ctx.textBaseline = 'middle';

    // Each pass paints the whole visible window, clipped per band, so frozen
    // panes stay independent of the scrolling body.
    const passes = [
      (band) => paintBackgrounds(ctx, storeRef, view, palette, band),
      (band) => {
        if (band === 'body') paintHighlight(ctx, storeRef, view, palette);
      },
      (band) => {
        if (state.showGrid) paintGridLines(ctx, storeRef, view, palette, band);
      },
      (band) => paintMerges(ctx, storeRef, view, palette, band),
      (band) => paintText(ctx, storeRef, view, palette, fontSize, band)
    ];
    for (const pass of passes) paintBands(ctx, pass);
    // Pane edges are a renderer-level concern rather than a property of any
    // one clipped band. Draw them once, then put user borders above them.
    paintFrozenPaneEdges(ctx, palette);
    paintCustomBorders(ctx, storeRef, view);
    paintBands(ctx, (band) => paintSelection(ctx, storeRef, view, palette, band));
    paintDropTarget(ctx, palette);

    // Headers last so scrolled content never bleeds over them.
    if (state.showHeaders) paintHeaders(ctx, storeRef, view, palette, fontSize);
    paintBorder(ctx, palette);
  }

  function paintBackgrounds(ctx, storeRef, view, palette, band) {
    const sheetIndex = state.sheetIndex;
    const selectionStart = state.selection.start;
    const selectionEnd = state.selection.end;
    for (let row = view.firstRow; row <= view.lastRow; row += 1) {
      const y = rowY(row);
      const height = displayRowHeight(row);
      for (let column = view.firstColumn; column <= view.lastColumn; column += 1) {
        const width = displayColumnWidth(column);
        if (bandFor(row, column, { width, height }) !== band) continue;
        const style = storeRef.getStyleOf(sheetIndex, row, column);
        const x = columnX(column);
        if (style.fill) {
          ctx.fillStyle = style.fill;
          ctx.fillRect(x, y, width, height);
        }
        const selected =
          row >= selectionStart.row &&
          row <= selectionEnd.row &&
          column >= selectionStart.column &&
          column <= selectionEnd.column;
        if (selected) {
          ctx.fillStyle = palette.accentSoft;
          ctx.fillRect(x, y, width, height);
        }
        if (state.hover && state.hover.row === row && state.hover.column === column) {
          ctx.fillStyle = palette.accentSoft;
          ctx.fillRect(x, y, width, height);
        }
      }
    }
  }

  function paintGridLines(ctx, storeRef, view, palette, band) {
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let row = view.firstRow; row <= view.lastRow; row += 1) {
      const y = rowY(row);
      const height = displayRowHeight(row);
      if (height <= 0) continue;
      for (let column = view.firstColumn; column <= view.lastColumn; column += 1) {
        const x = columnX(column);
        const width = displayColumnWidth(column);
        if (width <= 0 || bandFor(row, column, { width, height }) !== band) continue;
        const left = Math.round(x) + 0.5;
        const top = Math.round(y) + 0.5;
        const right = Math.round(x + width) + 0.5;
        const bottom = Math.round(y + height) + 0.5;
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.lineTo(right, bottom);
        ctx.lineTo(left, bottom);
        ctx.closePath();
      }
    }
    ctx.stroke();
  }

  function paintFrozenPaneEdges(ctx, palette) {
    const pane = frozen();
    if (!pane.rows && !pane.cols) return;
    const left = headerOffsetX();
    const top = headerOffsetY();
    ctx.save();
    ctx.strokeStyle = palette.gridStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (pane.rows) {
      const y = Math.round(top + pane.height) + 0.5;
      ctx.moveTo(left, y);
      ctx.lineTo(state.width, y);
    }
    if (pane.cols) {
      const x = Math.round(left + pane.width) + 0.5;
      ctx.moveTo(x, top);
      ctx.lineTo(x, state.height);
    }
    ctx.stroke();
    ctx.restore();
  }

  function textOverflowLayout(ctx, storeRef, view, merges, row, column, span, style, text, band) {
    const padding = 6;
    const anchorX = columnX(span.startColumn);
    const anchorRight = columnX(span.endColumn) + displayColumnWidth(span.endColumn);
    const anchorWidth = anchorRight - anchorX;
    const align = style.align || 'left';
    const requiredWidth = ctx.measureText(text).width + padding * 2;
    let startColumn = span.startColumn;
    let endColumn = span.endColumn;
    let left = anchorX;
    let right = anchorRight;

    // Merged cells already own an explicit rectangular area. Only ordinary,
    // unwrapped cells may borrow empty neighbours for visual text overflow.
    if (span.startColumn === span.endColumn && !style.wrap && requiredWidth > anchorWidth) {
      const canBorrow = (candidate) => {
        if (candidate < view.firstColumn || candidate > view.lastColumn) return false;
        if (merges.has(Core.key(row, candidate))) return false;
        const value = storeRef.getDisplayValue(state.sheetIndex, row, candidate);
        if (value !== '' && value !== null && value !== undefined) return false;
        const size = cellSize(row, candidate);
        return bandFor(row, candidate, size) === band;
      };
      const borrowLeft = () => {
        const candidate = startColumn - 1;
        if (!canBorrow(candidate)) return false;
        startColumn = candidate;
        left = columnX(candidate);
        return true;
      };
      const borrowRight = () => {
        const candidate = endColumn + 1;
        if (!canBorrow(candidate)) return false;
        endColumn = candidate;
        right = columnX(candidate) + displayColumnWidth(candidate);
        return true;
      };

      if (align === 'right') {
        while (right - left < requiredWidth && borrowLeft()) {}
        // Near the viewport/frozen-pane edge there may be no drawable space
        // on the preferred side. Fall back to empty cells on the other side
        // rather than showing only the tail of the value.
        while (right - left < requiredWidth && borrowRight()) {}
      } else if (align === 'center') {
        let blockedLeft = false;
        let blockedRight = false;
        while (right - left < requiredWidth && (!blockedLeft || !blockedRight)) {
          if (!blockedRight) blockedRight = !borrowRight();
          if (right - left >= requiredWidth) break;
          if (!blockedLeft) blockedLeft = !borrowLeft();
        }
      } else {
        while (right - left < requiredWidth && borrowRight()) {}
        while (right - left < requiredWidth && borrowLeft()) {}
      }
    }

    return {
      left,
      width: Math.max(0, right - left),
      padding,
      anchorX,
      anchorWidth,
      align,
      textX: align === 'center' ? left + (right - left) / 2 : align === 'right' ? right - padding : left + padding
    };
  }

  function paintText(ctx, storeRef, view, palette, fontSize, band) {
    const sheetIndex = state.sheetIndex;
    const merges = storeRef.mergeLookup();
    const drawnMerges = new Set();
    for (let row = view.firstRow; row <= view.lastRow; row += 1) {
      for (let column = view.firstColumn; column <= view.lastColumn; column += 1) {
        const merge = merges.get(Core.key(row, column));
        if (merge && !merge.anchor) continue;
        const span =
          merge && merge.anchor ? merge.range : { startRow: row, startColumn: column, endRow: row, endColumn: column };
        if (merge && merge.anchor) {
          const marker = `${span.startRow}:${span.startColumn}`;
          if (drawnMerges.has(marker)) continue;
          drawnMerges.add(marker);
        }
        const style = storeRef.getStyleOf(sheetIndex, row, column);
        const text = storeRef.getDisplayValue(sheetIndex, row, column);
        const x = columnX(column);
        const y = rowY(row);
        const width =
          span.endColumn > span.startColumn
            ? columnX(span.endColumn) + displayColumnWidth(span.endColumn) - x
            : displayColumnWidth(column);
        const height =
          span.endRow > span.startRow ? rowY(span.endRow) + displayRowHeight(span.endRow) - y : displayRowHeight(row);
        if (bandFor(row, column, { width, height }) !== band) continue;
        if (x > state.width || y > state.height || x + width < headerOffsetX() || y + height < headerOffsetY())
          continue;
        if (text === '' || text === null || text === undefined) continue;
        const size = style.size || fontSize;
        ctx.font = fontString(style, size, style.family || state.metrics.family);
        ctx.fillStyle =
          String(text).startsWith('#') && Formula.isError(String(text)) ? palette.danger : style.color || palette.ink;
        const overflow = textOverflowLayout(ctx, storeRef, view, merges, row, column, span, style, String(text), band);
        const padding = overflow.padding;
        const align = overflow.align;
        const available = width - padding * 2;
        const metrics = ctx.measureText(text);
        ctx.save();
        ctx.beginPath();
        ctx.rect(overflow.left + 1, y + 1, overflow.width - 2, height - 2);
        ctx.clip();
        const textX = overflow.textX;
        ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
        if (style.wrap) {
          const lines = wrapText(ctx, text, available);
          const lineHeight = size * 1.3;
          const totalHeight = lines.length * lineHeight;
          const valign = style.valign || 'middle';
          let lineY =
            valign === 'top'
              ? y + lineHeight / 2 + 3
              : valign === 'bottom'
                ? y + height - totalHeight + lineHeight / 2 - 3
                : y + Math.max(2, (height - totalHeight) / 2) + lineHeight / 2;
          for (const line of lines) {
            ctx.fillText(line, textX, lineY, available);
            lineY += lineHeight;
          }
        } else {
          const textY =
            style.valign === 'top'
              ? y + size / 2 + 4
              : style.valign === 'bottom'
                ? y + height - size / 2 - 2
                : y + height / 2 + 1;
          // Never use Canvas's maxWidth argument here: browsers are allowed to
          // condense glyphs, which makes the displayed string differ from the
          // stored value. The expanded clip above controls visibility instead.
          ctx.fillText(text, textX, textY);
        }
        ctx.restore();
        if ((style.underline || style.strike) && !style.wrap) {
          const textWidth = Math.min(metrics.width, Math.max(0, overflow.width - padding * 2));
          const textY =
            style.valign === 'top'
              ? y + size / 2 + 4
              : style.valign === 'bottom'
                ? y + height - size / 2 - 2
                : y + height / 2 + 1;
          const lineX = align === 'center' ? textX - textWidth / 2 : align === 'right' ? textX - textWidth : textX;
          ctx.strokeStyle = style.color || palette.ink;
          ctx.lineWidth = 1;
          if (style.underline) {
            const underlineY = Math.round(textY + size * 0.55) + 0.5;
            ctx.beginPath();
            ctx.moveTo(lineX, underlineY);
            ctx.lineTo(lineX + textWidth, underlineY);
            ctx.stroke();
          }
          if (style.strike) {
            const strikeY = Math.round(textY) + 0.5;
            ctx.beginPath();
            ctx.moveTo(lineX, strikeY);
            ctx.lineTo(lineX + textWidth, strikeY);
            ctx.stroke();
          }
        }
      }
    }
  }

  function paintCustomBorders(ctx, storeRef, view) {
    const lookup = storeRef.mergeLookup();
    const drawnMerges = new Set();
    for (let row = view.firstRow; row <= view.lastRow; row += 1) {
      if (displayRowHeight(row) <= 0) continue;
      for (let column = view.firstColumn; column <= view.lastColumn; column += 1) {
        if (displayColumnWidth(column) <= 0) continue;
        const merge = lookup.get(Core.key(row, column));
        if (merge && !merge.anchor) continue;
        const span = merge?.range || { startRow: row, startColumn: column, endRow: row, endColumn: column };
        const marker = `${span.startRow}:${span.startColumn}`;
        if (merge && drawnMerges.has(marker)) continue;
        if (merge) drawnMerges.add(marker);
        const x = columnX(span.startColumn);
        const y = rowY(span.startRow);
        const endX = columnX(span.endColumn) + displayColumnWidth(span.endColumn);
        const endY = rowY(span.endRow) + displayRowHeight(span.endRow);
        const width = endX - x;
        const height = endY - y;
        if (!bandFor(span.startRow, span.startColumn, { width, height })) continue;
        const edges = [
          [
            storeRef.getStyleOf(state.sheetIndex, span.startRow, span.startColumn),
            'borderTop',
            'borderTopWidth',
            x,
            y,
            endX,
            y
          ],
          [
            storeRef.getStyleOf(state.sheetIndex, span.startRow, span.endColumn),
            'borderRight',
            'borderRightWidth',
            endX,
            y,
            endX,
            endY
          ],
          [
            storeRef.getStyleOf(state.sheetIndex, span.endRow, span.startColumn),
            'borderBottom',
            'borderBottomWidth',
            x,
            endY,
            endX,
            endY
          ],
          [
            storeRef.getStyleOf(state.sheetIndex, span.startRow, span.startColumn),
            'borderLeft',
            'borderLeftWidth',
            x,
            y,
            x,
            endY
          ]
        ];
        for (const [style, colorProperty, widthProperty, x1, y1, x2, y2] of edges) {
          if (!style[colorProperty]) continue;
          ctx.save();
          ctx.strokeStyle = style[colorProperty];
          ctx.lineWidth = style[widthProperty] || 1.5;
          ctx.beginPath();
          ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
          ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  function wrapText(ctx, text, available) {
    const lines = [];
    let line = '';
    for (const char of String(text)) {
      const candidate = line + char;
      if (ctx.measureText(candidate).width > available && line) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
      if (lines.length > 64) break;
    }
    if (line) lines.push(line);
    return lines;
  }

  function paintMerges(ctx, storeRef, view, palette, band) {
    ctx.strokeStyle = palette.gridStrong;
    ctx.lineWidth = 1.5;
    for (const merge of storeRef.activeSheet().merges) {
      const startRow = merge[0];
      const startColumn = merge[1];
      const endRow = merge[2];
      const endColumn = merge[3];
      if (
        endRow < view.firstRow ||
        startRow > view.lastRow ||
        endColumn < view.firstColumn ||
        startColumn > view.lastColumn
      )
        continue;
      const x = columnX(startColumn);
      const y = rowY(startRow);
      const width = columnX(endColumn) + displayColumnWidth(endColumn) - x;
      const height = rowY(endRow) + displayRowHeight(endRow) - y;
      if (bandFor(startRow, startColumn, { width, height }) !== band) continue;
      const style = storeRef.getStyleOf(state.sheetIndex, startRow, startColumn);
      const selected =
        startRow >= state.selection.start.row &&
        endRow <= state.selection.end.row &&
        startColumn >= state.selection.start.column &&
        endColumn <= state.selection.end.column;
      ctx.fillStyle = selected ? palette.accentSoft : style.fill || palette.surface;
      ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
      const edges = [
        [
          storeRef.getStyleOf(state.sheetIndex, startRow, startColumn),
          'borderTop',
          'borderTopWidth',
          x,
          y,
          x + width,
          y
        ],
        [
          storeRef.getStyleOf(state.sheetIndex, startRow, endColumn),
          'borderRight',
          'borderRightWidth',
          x + width,
          y,
          x + width,
          y + height
        ],
        [
          storeRef.getStyleOf(state.sheetIndex, endRow, startColumn),
          'borderBottom',
          'borderBottomWidth',
          x,
          y + height,
          x + width,
          y + height
        ],
        [
          storeRef.getStyleOf(state.sheetIndex, startRow, startColumn),
          'borderLeft',
          'borderLeftWidth',
          x,
          y,
          x,
          y + height
        ]
      ];
      for (const [edgeStyle, colorProperty, widthProperty, x1, y1, x2, y2] of edges) {
        ctx.strokeStyle = edgeStyle[colorProperty] || palette.gridStrong;
        ctx.lineWidth = edgeStyle[widthProperty] || 1.5;
        ctx.beginPath();
        ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
        ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
        ctx.stroke();
      }
    }
  }

  function paintSelection(ctx, storeRef, view, palette, band) {
    const start = state.selection.start;
    const end = state.selection.end;
    if (end.row < view.firstRow - 1 || start.row > view.lastRow + 1) return;
    if (end.column < view.firstColumn - 1 || start.column > view.lastColumn + 1) return;
    const x = columnX(start.column);
    const y = rowY(start.row);
    const width = columnX(end.column) + displayColumnWidth(end.column) - x;
    const height = rowY(end.row) + displayRowHeight(end.row) - y;
    if (
      bandFor(start.row, start.column, { width, height }) !== band &&
      bandFor(end.row, end.column, { width: 1, height: 1 }) !== band
    )
      return;
    ctx.save();
    ctx.strokeStyle = palette.select;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(width) - 2, Math.round(height) - 2);
    // The fill handle is only offered for a single rectangular selection.
    ctx.fillStyle = palette.select;
    ctx.fillRect(
      Math.round(x + width) - FILL_HANDLE_SIZE / 2 - 1,
      Math.round(y + height) - FILL_HANDLE_SIZE / 2 - 1,
      FILL_HANDLE_SIZE,
      FILL_HANDLE_SIZE
    );
    ctx.restore();
  }

  function paintDropTarget(ctx, palette) {
    const target = state.dropTarget;
    if (!target || !state.store) return;
    const storeRef = state.store;
    const x = columnX(target.startColumn);
    const y = rowY(target.startRow);
    const width = columnX(target.endColumn) + displayColumnWidth(target.endColumn) - x;
    const height = rowY(target.endRow) + displayRowHeight(target.endRow) - y;
    ctx.save();
    ctx.strokeStyle = palette.accent;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
    ctx.restore();
  }

  function paintHeaders(ctx, storeRef, view, palette, fontSize) {
    const width = headerOffsetX();
    const height = headerOffsetY();
    ctx.fillStyle = palette.header;
    ctx.fillRect(0, 0, state.width, height);
    ctx.fillRect(0, 0, width, state.height);
    ctx.font = `500 ${fontSize - 1}px ${state.metrics.family}`;
    ctx.fillStyle = palette.headerText;
    ctx.textBaseline = 'middle';

    const selected = { start: state.selection.start, end: state.selection.end };
    for (let column = view.firstColumn; column <= view.lastColumn; column += 1) {
      const x = columnX(column);
      const cellWidth = displayColumnWidth(column);
      if (x + cellWidth < width || x > state.width) continue;
      ctx.fillStyle = palette.headerText;
      ctx.textAlign = 'center';
      ctx.fillText(Formula.columnToName(column), x + cellWidth / 2, height / 2, cellWidth - 4);
    }
    for (let row = view.firstRow; row <= view.lastRow; row += 1) {
      const y = rowY(row);
      const cellHeight = displayRowHeight(row);
      if (y + cellHeight < height || y > state.height) continue;
      ctx.fillStyle = palette.headerText;
      ctx.textAlign = 'center';
      ctx.fillText(String(row + 1), width / 2, y + cellHeight / 2, width - 6);
    }

    // Explicitly hidden rows collapse to a line. Paired arrows on the row
    // header make that otherwise invisible state discoverable and clickable.
    ctx.fillStyle = palette.select;
    for (const run of hiddenRowRuns()) {
      const y = hiddenRowRunY(run);
      if (y < height - 6 || y > state.height + 6) continue;
      ctx.fillRect(width - 7, Math.round(y) - 1, 7, 2);
      ctx.beginPath();
      ctx.moveTo(width - 7, y - 1);
      ctx.lineTo(width - 3, y - 6);
      ctx.lineTo(width - 11, y - 6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(width - 7, y + 1);
      ctx.lineTo(width - 3, y + 6);
      ctx.lineTo(width - 11, y + 6);
      ctx.closePath();
      ctx.fill();
    }

    // The corner box clears the active cell reference.
    ctx.fillStyle = palette.header;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = palette.gridStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width + 0.5, 0);
    ctx.lineTo(width + 0.5, state.height);
    ctx.moveTo(0, height + 0.5);
    ctx.lineTo(state.width, height + 0.5);
    ctx.stroke();
  }

  function paintBorder(ctx, palette) {
    ctx.strokeStyle = palette.gridStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(state.width, 0.5);
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, state.height);
    ctx.stroke();
  }

  return {
    draw,
    paintBackgrounds,
    paintGridLines,
    paintFrozenPaneEdges,
    textOverflowLayout,
    paintText,
    paintCustomBorders,
    wrapText,
    paintMerges,
    paintSelection,
    paintDropTarget,
    paintHeaders,
    paintBorder
  };
}

module.exports = { createPainting };
