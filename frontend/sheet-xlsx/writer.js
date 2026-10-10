import { CONTENT_TYPES_HEAD, ROOT_RELS, zip } from './shared.js';
import { escapeXml } from './xml.js';
import { cellReference } from './references.js';

function buildContentTypes(sheetCount) {
  const sheets = Array.from(
    { length: sheetCount },
    (unused, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return `${CONTENT_TYPES_HEAD}\n${sheets}\n</Types>`;
}

function buildWorkbookRels(sheetCount) {
  const sheets = Array.from(
    { length: sheetCount },
    (unused, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join('');
  const stylesId = `rId${sheetCount + 1}`;
  const stringsId = `rId${sheetCount + 2}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets}
<Relationship Id="${stylesId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="${stringsId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
}

function createStyleTable() {
  const fonts = [
    { bold: false, italic: false, underline: false, strike: false, color: null, size: 11, family: 'Calibri' }
  ];
  const fills = [null, { color: 'gray125' }];
  const borders = [{}];
  const formats = ['General'];
  const order = [
    'General',
    '0.00',
    '#,##0',
    '#,##0.00',
    '¥#,##0.00',
    '0.00%',
    '0%',
    '0.00E+00',
    'yyyy-mm-dd',
    'yyyy-mm-dd hh:mm',
    'hh:mm:ss',
    '@'
  ];
  for (const pattern of order.slice(1)) formats.push(pattern);
  const numberFormatIds = new Map();
  formats.forEach((pattern, index) => numberFormatIds.set(pattern, index === 0 ? 0 : 100 + index));
  const styles = [{ font: 0, fill: 0, border: 0, format: 0, align: null }];
  const index = new Map();
  return {
    formats,
    numberFormatIds,
    fonts,
    fills,
    borders,
    styles,
    intern(style) {
      const key = JSON.stringify([
        style.bold,
        style.italic,
        style.underline,
        style.strike,
        style.color,
        style.fill,
        style.format,
        style.align,
        style.valign,
        style.wrap,
        style.size,
        style.family,
        style.borderTop,
        style.borderRight,
        style.borderBottom,
        style.borderLeft,
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth
      ]);
      if (index.has(key)) return index.get(key);
      const font = {
        bold: !!style.bold,
        italic: !!style.italic,
        underline: !!style.underline,
        strike: !!style.strike,
        color: style.color || null,
        size: style.size || 11,
        family: primaryFontFamily(style.family)
      };
      let fontIndex = fonts.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(font));
      if (fontIndex < 0) {
        fonts.push(font);
        fontIndex = fonts.length - 1;
      }
      let fillIndex = 0;
      if (style.fill) {
        fillIndex = fills.findIndex((candidate) => candidate && candidate.color === style.fill);
        if (fillIndex < 0) {
          fills.push({ color: style.fill });
          fillIndex = fills.length - 1;
        }
      }
      const formatIndex = this.numberFormatIds.get(style.format || 'General') || 0;
      const border = {
        top: style.borderTop || null,
        right: style.borderRight || null,
        bottom: style.borderBottom || null,
        left: style.borderLeft || null,
        topWidth: style.borderTopWidth || 0,
        rightWidth: style.borderRightWidth || 0,
        bottomWidth: style.borderBottomWidth || 0,
        leftWidth: style.borderLeftWidth || 0
      };
      let borderIndex = borders.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(border));
      if (borderIndex < 0) {
        borders.push(border);
        borderIndex = borders.length - 1;
      }
      const id = styles.length;
      styles.push({
        font: fontIndex,
        fill: fillIndex,
        border: borderIndex,
        format: formatIndex,
        align: style.align || null,
        valign: style.valign || null,
        wrap: !!style.wrap
      });
      index.set(key, id);
      return id;
    }
  };
}

function primaryFontFamily(value) {
  const first = String(value || 'Calibri')
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '');
  return first || 'Calibri';
}

function buildStylesXml(table) {
  const fonts = table.fonts
    .map((font) => {
      const properties = [];
      if (font.bold) properties.push('<b/>');
      if (font.italic) properties.push('<i/>');
      if (font.underline) properties.push('<u/>');
      if (font.strike) properties.push('<strike/>');
      if (font.color) properties.push(`<color rgb="FF${String(font.color).replace('#', '').toUpperCase()}"/>`);
      return `<font>${properties.join('')}<sz val="${font.size}"/><name val="${escapeXml(font.family || 'Calibri')}"/></font>`;
    })
    .join('');
  const fills = table.fills
    .map((fill, index) => {
      if (!fill) return '<fill><patternFill patternType="none"/></fill>';
      if (fill.color === 'gray125') return '<fill><patternFill patternType="gray125"/></fill>';
      return `<fill><patternFill patternType="solid"><fgColor rgb="FF${String(fill.color).replace('#', '').toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`;
    })
    .join('');
  const numFmts = table.formats
    .map((pattern, index) => ({ pattern, id: table.numberFormatIds.get(pattern) }))
    .filter((entry) => entry.id >= 100)
    .map((entry) => `<numFmt numFmtId="${entry.id}" formatCode="${escapeXml(entry.pattern)}"/>`)
    .join('');
  const cellXfs = table.styles
    .map((style) => {
      const alignment = [];
      if (style.align) alignment.push(`horizontal="${style.align}"`);
      if (style.valign) alignment.push(`vertical="${style.valign === 'middle' ? 'center' : style.valign}"`);
      if (style.wrap) alignment.push('wrapText="1"');
      const alignmentXml = alignment.length ? `<alignment ${alignment.join(' ')}/>` : '';
      return `<xf numFmtId="${style.format}" fontId="${style.font}" fillId="${style.fill}" borderId="${style.border || 0}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1">${alignmentXml}</xf>`;
    })
    .join('');
  const borders = table.borders
    .map((border) => {
      const edge = (name) =>
        border[name]
          ? `<${name} style="${border[`${name}Width`] >= 3 ? 'thick' : 'thin'}"><color rgb="FF${String(border[name]).replace('#', '').toUpperCase()}"/></${name}>`
          : `<${name}/>`;
      return `<border>${edge('left')}${edge('right')}${edge('top')}${edge('bottom')}<diagonal/></border>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${numFmts ? numFmts.split('</numFmt>').length - 1 : 0}">${numFmts}</numFmts>
<fonts count="${table.fonts.length}">${fonts}</fonts>
<fills count="${table.fills.length}">${fills}</fills>
<borders count="${table.borders.length}">${borders}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${table.styles.length}">${cellXfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function buildSheetXml(sheet, styleTable) {
  const shared = sheet.sharedStrings;
  const heights = sheet.rows || {};
  const rows = [];
  const hiddenRows = sheet.hiddenRows || {};
  const lastRow = Math.max(
    sheet.matrix.length - 1,
    ...Object.keys(heights).map(Number).filter(Number.isInteger),
    ...Object.keys(hiddenRows).map(Number).filter(Number.isInteger),
    -1
  );
  for (let rowIndex = 0; rowIndex <= lastRow; rowIndex += 1) {
    const line = sheet.matrix[rowIndex] || [];
    const cells = [];
    line.forEach((value, columnIndexInRow) => {
      if (value === null || value === undefined || value === '') return;
      const styleId = sheet.styleAt ? styleTable.intern(sheet.styleAt(rowIndex, columnIndexInRow)) : 0;
      const reference = cellReference(rowIndex, columnIndexInRow);
      const attributes = styleId ? ` s="${styleId}"` : '';
      if (value && typeof value === 'object' && value.formula) {
        const cached = value.value;
        const cachedType = typeof cached === 'number' ? '' : ' t="str"';
        const cachedBody =
          cached === undefined || cached === null || cached === ''
            ? ''
            : typeof cached === 'number'
              ? `<v>${cached}</v>`
              : `<v>${escapeXml(cached)}</v>`;
        cells.push(
          `<c r="${reference}"${attributes}${cachedType}><f>${escapeXml(String(value.formula).replace(/^=/, ''))}</f>${cachedBody}</c>`
        );
        return;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        cells.push(`<c r="${reference}"${attributes}><v>${value}</v></c>`);
        return;
      }
      if (typeof value === 'boolean') {
        cells.push(`<c r="${reference}"${attributes} t="b"><v>${value ? 1 : 0}</v></c>`);
        return;
      }
      const text = String(value);
      const sharedIndex = shared.index(text);
      cells.push(`<c r="${reference}"${attributes} t="s"><v>${sharedIndex}</v></c>`);
    });
    // Row height must live on the row element itself: a second <row> with the
    // same index is invalid and makes Excel repair the file.
    const height = heights[rowIndex];
    const heightAttribute = Number.isFinite(height) ? ` ht="${(height * 0.75).toFixed(2)}" customHeight="1"` : '';
    const hiddenAttribute = hiddenRows[rowIndex] ? ' hidden="1"' : '';
    if (cells.length || heightAttribute || hiddenAttribute) {
      rows.push(`<row r="${rowIndex + 1}"${heightAttribute}${hiddenAttribute}>${cells.join('')}</row>`);
    }
  }

  const columnKeys = new Set([...Object.keys(sheet.cols || {}), ...Object.keys(sheet.hiddenColumns || {})]);
  const columnEntries = Array.from(columnKeys)
    .map((column) => ({
      column: Number(column),
      width: (sheet.cols || {})[column],
      hidden: Boolean(sheet.hiddenColumns?.[column])
    }))
    .filter((entry) => Number.isInteger(entry.column) && entry.column >= 0)
    .sort((a, b) => a.column - b.column)
    .map(
      (entry) =>
        // Excel 字符宽度不包含约 5px 的边距，与导入时的换算保持互逆。
        `<col min="${entry.column + 1}" max="${entry.column + 1}" width="${Math.max(1, ((Number(entry.width) || 96) - 5) / 7).toFixed(2)}" customWidth="1"${entry.hidden ? ' hidden="1"' : ''}/>`
    );
  const merges = (sheet.merges || []).map(
    (merge) => `<mergeCell ref="${cellReference(merge[0], merge[1])}:${cellReference(merge[2], merge[3])}"/>`
  );
  const frozen =
    sheet.frozen && (sheet.frozen.rows || sheet.frozen.cols)
      ? `<pane xSplit="${sheet.frozen.cols || 0}" ySplit="${sheet.frozen.rows || 0}" topLeftCell="${cellReference(sheet.frozen.rows || 0, sheet.frozen.cols || 0)}" activePane="bottomRight" state="frozen"/>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0">${frozen}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${columnEntries.length ? `<cols>${columnEntries.join('')}</cols>` : ''}
<sheetData>${rows.join('')}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}
</worksheet>`;
}

function buildSharedStringsXml(strings) {
  // Shared strings are XML character data, so they must be escaped here rather
  // than at the call site: a stray "<" would otherwise make the file invalid.
  const items = strings.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`;
}

function buildWorkbookXml(sheets) {
  const entries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name || `Sheet${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${entries}</sheets>
</workbook>`;
}

function createSharedStrings() {
  const list = [];
  const lookup = new Map();
  return {
    list,
    index(text) {
      if (lookup.has(text)) return lookup.get(text);
      list.push(text);
      lookup.set(text, list.length - 1);
      return list.length - 1;
    }
  };
}

function writeXlsx(sheets) {
  const styleTable = createStyleTable();
  const shared = createSharedStrings();
  const targets = sheets.length ? sheets : [{ name: 'Sheet1', matrix: [] }];
  const files = {
    '[Content_Types].xml': strToBytes(buildContentTypes(targets.length)),
    '_rels/.rels': strToBytes(ROOT_RELS),
    'xl/workbook.xml': strToBytes(buildWorkbookXml(targets)),
    'xl/_rels/workbook.xml.rels': strToBytes(buildWorkbookRels(targets.length))
  };
  targets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToBytes(
      buildSheetXml({ ...sheet, sharedStrings: shared }, styleTable)
    );
  });
  files['xl/styles.xml'] = strToBytes(buildStylesXml(styleTable));
  files['xl/sharedStrings.xml'] = strToBytes(buildSharedStringsXml(shared.list));
  return zip.zipSync(files, { level: 6 });
}

function strToBytes(text) {
  return new TextEncoder().encode(text);
}

function toBlob(sheets) {
  const bytes = writeXlsx(sheets);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export {
  buildContentTypes,
  buildWorkbookRels,
  createStyleTable,
  primaryFontFamily,
  buildStylesXml,
  buildSheetXml,
  buildSharedStringsXml,
  buildWorkbookXml,
  createSharedStrings,
  writeXlsx,
  strToBytes,
  toBlob
};
