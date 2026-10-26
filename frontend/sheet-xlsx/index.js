import { readXlsx } from './reader.js';

function readXlsxAsync(bytes) {
  if (typeof Worker !== 'function' || typeof window === 'undefined') return Promise.resolve(readXlsx(bytes));
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker('sheet-xlsx-worker.js');
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('xlsx 解析超时'));
    }, 30000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      if (!event.data?.ok) {
        reject(new Error(event.data?.error || 'xlsx 解析失败'));
        return;
      }
      const result = event.data.result;
      for (const sheet of result.sheets || []) {
        const styles = sheet.styleGrid || [];
        sheet.styleAt = (row, column) => styles[row]?.[column] || null;
        delete sheet.styleGrid;
      }
      resolve(result);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'xlsx Worker 启动失败'));
    };
    worker.postMessage(source, [source.buffer]);
  });
}
export { readXlsxAsync };
export { writeXlsx, toBlob } from './writer.js';
export { readXlsx } from './reader.js';
