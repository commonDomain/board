import {
  MAX_COMPRESSED_BYTES,
  MAX_INFLATED_BYTES,
  MAX_ARCHIVE_FILES,
  MAX_IMPORTED_CELLS,
  MAX_SHARD_CELLS,
  MAX_OUTPUT_SHEETS,
  zip,
  Formula
} from './shared.js';
import { parseXml } from './xml.js';
import { columnIndex } from './references.js';

function readXlsx(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  inspectZipArchive(source);
  const files = zip.unzipSync(source);
  const decode = (path) => (files[path] ? new TextDecoder().decode(files[path]) : null);
  const sharedStrings = parseSharedStrings(decode('xl/sharedStrings.xml'));
  const styleTable = parseStyles(decode('xl/styles.xml'));
  const workbookXml = decode('xl/workbook.xml');
  const sheetNames = workbookXml ? parseSheetNames(workbookXml) : [];
  const sheets = [];
  for (let index = 1; index <= 64; index += 1) {
    const xml = decode(`xl/worksheets/sheet${index}.xml`);
    if (!xml) break;
    const parsed = parseSheet(xml, sharedStrings, styleTable);
    sheets.push({ ...parsed, name: sheetNames[index - 1] || `Sheet${index}` });
  }
  if (!sheets.length) throw new Error('工作簿缺少工作表数据');
  const warnings = [];
  if (Object.keys(files).some((path) => /xl\/(charts|pivotTables|drawings)\//.test(path)))
    warnings.push('图表、透视表或绘图对象未导入');
  if (sheets.some((sheet) => sheet.unsupported)) warnings.push('条件格式或数据验证未导入');
  const sharded = shardImportedSheets(sheets);
  if (sharded.length !== sheets.length) warnings.push(`超大工作表已按行拆分为 ${sharded.length} 个工作表`);
  return { sheets: sharded, warnings };
}

function inspectZipArchive(bytes) {
  if (bytes.byteLength > MAX_COMPRESSED_BYTES) throw new Error('xlsx 文件超过 10MB 限制');
  let files = 0;
  let inflated = 0;
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (
      bytes[offset] !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      bytes[offset + 2] !== 0x01 ||
      bytes[offset + 3] !== 0x02
    )
      continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(bytes.length - offset, 46));
    const size = view.getUint32(24, true);
    const nameLength = view.getUint16(28, true);
    const extraLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('xlsx 压缩目录损坏');
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..'))
      throw new Error('xlsx 包含不安全的文件路径');
    files += 1;
    inflated += size;
    if (files > MAX_ARCHIVE_FILES) throw new Error('xlsx 内部文件数量过多');
    if (inflated > MAX_INFLATED_BYTES) throw new Error('xlsx 解压后超过 64MB 限制');
    offset += 45 + nameLength + extraLength + commentLength;
  }
  if (!files) throw new Error('xlsx 压缩目录缺失');
}

function uniqueImportName(wanted, used) {
  const base = String(wanted || 'Sheet').slice(0, 60) || 'Sheet';
  let name = base;
  let suffix = 2;
  while (used.has(name.toUpperCase())) {
    const tail = ` (${suffix})`;
    name = `${base.slice(0, Math.max(1, 60 - tail.length))}${tail}`;
    suffix += 1;
  }
  used.add(name.toUpperCase());
  return name;
}

function shardImportedSheets(sheets) {
  let totalCells = 0;
  const usedNames = new Set();
  const plans = [];
  for (const source of sheets) {
    const rows = Array.isArray(source.matrix) ? source.matrix : [];
    const chunks = [];
    let startRow = 0;
    let cells = 0;
    const finish = (endRow) => {
      if (endRow < startRow) return;
      const number = chunks.length + 1;
      const wanted = number === 1 ? source.name : `${source.name} (${number})`;
      chunks.push({ source, startRow, endRow, name: uniqueImportName(wanted, usedNames) });
      startRow = endRow + 1;
      cells = 0;
    };
    for (let row = 0; row < rows.length; row += 1) {
      const rowCells = Array.isArray(rows[row])
        ? rows[row].reduce((sum, value) => sum + (value === null || value === undefined || value === '' ? 0 : 1), 0)
        : 0;
      if (cells && cells + rowCells > MAX_SHARD_CELLS) finish(row - 1);
      cells += rowCells;
      totalCells += rowCells;
      if (totalCells > MAX_IMPORTED_CELLS) throw new Error('xlsx 超过 50 万个非空单元格限制');
    }
    finish(Math.max(startRow, rows.length - 1));
    if (!chunks.length) chunks.push({ source, startRow: 0, endRow: 0, name: uniqueImportName(source.name, usedNames) });
    plans.push({ source, chunks });
  }
  const outputCount = plans.reduce((sum, plan) => sum + plan.chunks.length, 0);
  if (outputCount > MAX_OUTPUT_SHEETS) throw new Error('xlsx 分片后超过 32 个工作表限制');
  const byName = new Map(plans.map((plan) => [String(plan.source.name || '').toUpperCase(), plan]));
  const chunkForRow = (plan, row) => plan?.chunks.find((chunk) => row >= chunk.startRow && row <= chunk.endRow) || null;
  const absoluteA1 = (sourceText, row, column) => {
    const match = /^(\$?)[A-Za-z]{1,3}(\$?)\d+$/.exec(sourceText || '');
    return `${match?.[1] || ''}${Formula.columnToName(column)}${match?.[2] || ''}${row + 1}`;
  };
  const outputs = [];
  for (const plan of plans) {
    for (const chunk of plan.chunks) {
      const matrix = plan.source.matrix
        .slice(chunk.startRow, chunk.endRow + 1)
        .map((row) => (Array.isArray(row) ? row.slice() : []));
      matrix.forEach((row) =>
        row.forEach((value, column) => {
          if (!value || typeof value !== 'object' || !value.formula) return;
          const parsedFormula = Formula.parseFormula(value.formula);
          if (parsedFormula.error) throw new Error(`公式无法安全保真导入：${value.formula}`);
          const rewriteCell = (reference) => {
            const targetPlan = reference.sheet ? byName.get(String(reference.sheet).toUpperCase()) : plan;
            const target = chunkForRow(targetPlan, reference.row);
            if (!target) throw new Error(`公式引用无法分片：${value.formula}`);
            const localRow = reference.row - target.startRow;
            const address = absoluteA1(reference.text, localRow, reference.column);
            return reference.sheet || target !== chunk ? `${Formula.quoteSheetName(target.name)}!${address}` : address;
          };
          const rewriteRange = (reference) => {
            const targetPlan = reference.sheet ? byName.get(String(reference.sheet).toUpperCase()) : plan;
            const start = chunkForRow(targetPlan, reference.start.row);
            const end = chunkForRow(targetPlan, reference.end.row);
            if (!start || start !== end) throw new Error(`跨分片区域公式无法无损改写：${value.formula}`);
            const first = absoluteA1(reference.startText, reference.start.row - start.startRow, reference.start.column);
            const last = absoluteA1(reference.endText, reference.end.row - start.startRow, reference.end.column);
            return reference.sheet || start !== chunk
              ? `${Formula.quoteSheetName(start.name)}!${first}:${last}`
              : `${first}:${last}`;
          };
          value.formula = Formula.rewriteReferences(value.formula, rewriteRange, rewriteCell);
          void column;
        })
      );
      const remapObject = (source) =>
        Object.fromEntries(
          Object.entries(source || {})
            .map(([row, value]) => [Number(row) - chunk.startRow, value])
            .filter(([row]) => row >= 0 && row <= chunk.endRow - chunk.startRow)
        );
      const merges = (plan.source.merges || [])
        .map((merge) => {
          if (merge[0] < chunk.startRow || merge[2] > chunk.endRow) {
            if (merge[2] >= chunk.startRow && merge[0] <= chunk.endRow)
              throw new Error('合并单元格跨越分片边界，无法无损导入');
            return null;
          }
          return [merge[0] - chunk.startRow, merge[1], merge[2] - chunk.startRow, merge[3]];
        })
        .filter(Boolean);
      outputs.push({
        ...plan.source,
        name: chunk.name,
        matrix,
        rows: remapObject(plan.source.rows),
        hiddenRows: remapObject(plan.source.hiddenRows),
        merges,
        frozen: chunk.startRow === 0 ? plan.source.frozen : { rows: 0, cols: plan.source.frozen?.cols || 0 },
        styleAt: (row, column) => plan.source.styleAt(row + chunk.startRow, column)
      });
    }
  }
  return outputs;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagName('si')).map((node) => {
    // A string item can be split across several <t> runs.
    const runs = Array.from(node.getElementsByTagName('t'));
    return runs.map((run) => run.textContent || '').join('');
  });
}

function parseSheetNames(xml) {
  const doc = parseXml(xml);
  return Array.from(doc.getElementsByTagName('sheet')).map((node) => node.getAttribute('name') || '');
}

function parseSheet(xml, sharedStrings, styles = []) {
  const doc = parseXml(xml);
  const matrix = [];
  const styleRefs = [];
  let maxColumn = 0;
  for (const rowNode of Array.from(doc.getElementsByTagName('row'))) {
    const rowIndex = Number(rowNode.getAttribute('r')) - 1;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= 1000000) throw new Error('xlsx 行号超出支持范围');
    const line = matrix[rowIndex] || (matrix[rowIndex] = []);
    const styleLine = styleRefs[rowIndex] || (styleRefs[rowIndex] = []);
    for (const cellNode of Array.from(rowNode.getElementsByTagName('c'))) {
      const reference = cellNode.getAttribute('r') || '';
      const column = columnIndex(reference.replace(/\d+/g, ''));
      if (!Number.isInteger(column) || column < 0 || column >= 512) throw new Error('xlsx 列数超过 512 列限制');
      const type = cellNode.getAttribute('t');
      const formulaNode = cellNode.getElementsByTagName('f')[0];
      const valueNode = cellNode.getElementsByTagName('v')[0];
      const raw = valueNode ? valueNode.textContent || '' : '';
      let value = null;
      if (formulaNode) {
        const formula = `=${formulaNode.textContent || ''}`;
        const cached =
          type === 'str' || type === 's' ? raw : raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
        value = { formula, value: cached === '' ? undefined : cached };
      } else if (type === 's') {
        value = sharedStrings[Number(raw)] ?? '';
      } else if (type === 'b') {
        value = raw === '1' || raw.toLowerCase() === 'true';
      } else if (type === 'inlineStr') {
        const inline = cellNode.getElementsByTagName('t')[0];
        value = inline ? inline.textContent || '' : '';
      } else if (raw !== '') {
        const numeric = Number(raw);
        value = Number.isFinite(numeric) ? numeric : raw;
      }
      if (value === null || value === '') continue;
      line[column] = value;
      styleLine[column] = Number(cellNode.getAttribute('s')) || 0;
      maxColumn = Math.max(maxColumn, column + 1);
    }
  }
  // Normalize every row to the same width, because the model expects a matrix.
  const width = Math.max(maxColumn, 1);
  const normalized = matrix.map((line) => {
    const output = [];
    for (let column = 0; column < width; column += 1)
      output.push(line && line[column] !== undefined ? line[column] : null);
    return output;
  });
  return {
    matrix: normalized,
    cols: parseColumns(doc),
    rows: parseRowHeights(doc),
    merges: parseMerges(doc),
    frozen: parseFrozen(doc),
    styleRefs,
    styleAt: (row, column) => styles[styleRefs[row]?.[column] || 0] || null,
    hiddenRows: parseHiddenRows(doc),
    hiddenColumns: parseHiddenColumns(doc),
    unsupported:
      doc.getElementsByTagName('conditionalFormatting').length > 0 ||
      doc.getElementsByTagName('dataValidations').length > 0
  };
}

function colorValue(node) {
  if (!node) return null;
  const rgb = node.getAttribute('rgb');
  if (rgb && /^[0-9a-f]{6,8}$/i.test(rgb)) return `#${rgb.slice(-6).toLowerCase()}`;
  return null;
}

function parseStyles(xml) {
  if (!xml) return [{}];
  const doc = parseXml(xml);
  const fontNodes = Array.from(doc.getElementsByTagName('fonts')[0]?.getElementsByTagName('font') || []);
  const fonts = fontNodes.map((node) => ({
    bold: node.getElementsByTagName('b').length > 0,
    italic: node.getElementsByTagName('i').length > 0,
    underline: node.getElementsByTagName('u').length > 0,
    strike: node.getElementsByTagName('strike').length > 0,
    color: colorValue(node.getElementsByTagName('color')[0]),
    size: Number(node.getElementsByTagName('sz')[0]?.getAttribute('val')) || 0,
    family: node.getElementsByTagName('name')[0]?.getAttribute('val') || null
  }));
  const fillNodes = Array.from(doc.getElementsByTagName('fills')[0]?.getElementsByTagName('fill') || []);
  const fills = fillNodes.map((node) => colorValue(node.getElementsByTagName('fgColor')[0]));
  const borderNodes = Array.from(doc.getElementsByTagName('borders')[0]?.getElementsByTagName('border') || []);
  const borders = borderNodes.map((node) => {
    const edge = (name) => {
      const edgeNode = node.getElementsByTagName(name)[0];
      return {
        color: colorValue(edgeNode?.getElementsByTagName('color')[0]),
        width: edgeNode?.getAttribute('style') === 'thick' ? 3 : edgeNode?.getAttribute('style') ? 1.5 : 0
      };
    };
    const top = edge('top');
    const right = edge('right');
    const bottom = edge('bottom');
    const left = edge('left');
    return {
      borderTop: top.color,
      borderTopWidth: top.width,
      borderRight: right.color,
      borderRightWidth: right.width,
      borderBottom: bottom.color,
      borderBottomWidth: bottom.width,
      borderLeft: left.color,
      borderLeftWidth: left.width
    };
  });
  const numFormats = new Map();
  for (const node of Array.from(doc.getElementsByTagName('numFmt')))
    numFormats.set(Number(node.getAttribute('numFmtId')), node.getAttribute('formatCode') || 'General');
  const builtIns = new Map([
    [0, 'General'],
    [1, '0'],
    [2, '0.00'],
    [9, '0%'],
    [10, '0.00%'],
    [14, 'yyyy-mm-dd'],
    [49, '@']
  ]);
  const xfNodes = Array.from(doc.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf') || []);
  return xfNodes.map((node) => {
    const alignment = node.getElementsByTagName('alignment')[0];
    const vertical = alignment?.getAttribute('vertical');
    return {
      ...(fonts[Number(node.getAttribute('fontId')) || 0] || {}),
      fill: fills[Number(node.getAttribute('fillId')) || 0] || null,
      ...(borders[Number(node.getAttribute('borderId')) || 0] || {}),
      format:
        numFormats.get(Number(node.getAttribute('numFmtId'))) ||
        builtIns.get(Number(node.getAttribute('numFmtId'))) ||
        'General',
      align: alignment?.getAttribute('horizontal') || 'left',
      valign: vertical === 'center' ? 'middle' : vertical || 'middle',
      wrap: alignment?.getAttribute('wrapText') === '1'
    };
  });
}

function parseHiddenRows(doc) {
  const hidden = {};
  for (const node of Array.from(doc.getElementsByTagName('row'))) {
    const row = Number(node.getAttribute('r')) - 1;
    if (node.getAttribute('hidden') === '1' && Number.isInteger(row) && row >= 0) hidden[row] = true;
  }
  return Object.keys(hidden).length ? hidden : null;
}

function parseHiddenColumns(doc) {
  const hidden = {};
  for (const node of Array.from(doc.getElementsByTagName('col'))) {
    if (node.getAttribute('hidden') !== '1') continue;
    const min = Number(node.getAttribute('min')) - 1;
    const max = Number(node.getAttribute('max')) - 1;
    for (let column = Math.max(0, min); column <= max && column < 1024; column += 1) hidden[column] = true;
  }
  return Object.keys(hidden).length ? hidden : null;
}

function parseColumns(doc) {
  const cols = {};
  for (const node of Array.from(doc.getElementsByTagName('col'))) {
    const min = Number(node.getAttribute('min')) - 1;
    const max = Number(node.getAttribute('max')) - 1;
    const width = Number(node.getAttribute('width'));
    if (!Number.isFinite(width)) continue;
    for (let column = Math.max(0, min); column <= max && column < 1024; column += 1) {
      // Excel column width units are roughly characters; convert to pixels.
      cols[column] = Math.round(Math.max(28, Math.min(1200, width * 7 + 5)));
    }
  }
  return cols;
}

function parseRowHeights(doc) {
  const rows = {};
  for (const node of Array.from(doc.getElementsByTagName('row'))) {
    const index = Number(node.getAttribute('r')) - 1;
    const height = Number(node.getAttribute('ht'));
    if (!Number.isInteger(index) || index < 0 || !Number.isFinite(height)) continue;
    rows[index] = Math.round(Math.max(16, Math.min(400, height * 1.3333)));
  }
  return rows;
}

function parseMerges(doc) {
  const merges = [];
  for (const node of Array.from(doc.getElementsByTagName('mergeCell'))) {
    const reference = node.getAttribute('ref') || '';
    const [start, end] = reference.split(':');
    if (!start || !end) continue;
    const startColumn = columnIndex(start.replace(/\d+/g, ''));
    const startRow = Number(start.replace(/[A-Za-z]+/g, '')) - 1;
    const endColumn = columnIndex(end.replace(/\d+/g, ''));
    const endRow = Number(end.replace(/[A-Za-z]+/g, '')) - 1;
    if ([startColumn, startRow, endColumn, endRow].some((value) => !Number.isInteger(value) || value < 0)) continue;
    if (startRow === endRow && startColumn === endColumn) continue;
    merges.push([startRow, startColumn, endRow, endColumn]);
  }
  return merges;
}

function parseFrozen(doc) {
  const pane = doc.getElementsByTagName('pane')[0];
  if (!pane) return { rows: 0, cols: 0 };
  return {
    rows: Math.max(0, Math.min(64, Number(pane.getAttribute('ySplit')) || 0)),
    cols: Math.max(0, Math.min(64, Number(pane.getAttribute('xSplit')) || 0))
  };
}
export {
  readXlsx,
  inspectZipArchive,
  uniqueImportName,
  shardImportedSheets,
  parseSharedStrings,
  parseSheetNames,
  parseSheet,
  colorValue,
  parseStyles,
  parseHiddenRows,
  parseHiddenColumns,
  parseColumns,
  parseRowHeights,
  parseMerges,
  parseFrozen
};
