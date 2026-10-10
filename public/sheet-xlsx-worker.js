'use strict';

importScripts('vendor/fflate.min.js', 'sheet-formula.js', 'sheet-xlsx.js');

self.onmessage = (event) => {
  try {
    const result = self.SheetXlsx.readXlsx(new Uint8Array(event.data));
    const sheets = result.sheets.map((sheet) => {
      const styleGrid = sheet.matrix.map((row, rowIndex) => row.map((_value, columnIndex) => sheet.styleAt(rowIndex, columnIndex)));
      const { styleAt, ...plain } = sheet;
      return { ...plain, styleGrid };
    });
    self.postMessage({ ok: true, result: { ...result, sheets } });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || 'xlsx 解析失败' });
  }
};
