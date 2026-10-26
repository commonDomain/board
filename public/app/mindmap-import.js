import { pushUndoSnapshot } from './history-controller.js';
import { snapshotItems } from './history-controller-model.js';
import { els } from './elements.js';
import { findOpenCanvasPoint } from './geometry-model.js';
import { getViewportDropPoint } from './geometry.js';
import { refreshIcons, showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { closePopovers } from './popovers.js';
import { renderItem } from './rendering.js';
import { markDirty } from './save-status.js';
import { findSectionForItem } from './sections.js';
import { selectItem } from './selection.js';
import { state } from './state.js';
import { enqueueOperation } from './sync-queue.js';
import { staticAssetUrl } from './utilities.js';
import { setMindmapPlacementLoading } from './xmind-connection.js';
import { createMindMapItem, countMindNodes } from './mindmap-model.js';

function addMindMapItem(point, tree, options = {}) {
  const item = createMindMapItem(point, tree, options);
  if (!item) return false;
  if (options.avoidOverlap !== false) {
    const openPoint = findOpenCanvasPoint(
      item.w,
      item.h,
      point,
      Array.from(state.items.values()).filter((entry) => !entry.hidden)
    );
    item.x = openPoint.x;
    item.y = openPoint.y;
  }
  if (item.source?.provider === 'xmind') state.xmindCleanBroadcastIds.add(item.id);
  return upsertItem(item) ? item : false;
}

function runXmindImportWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(staticAssetUrl('xmind-import-worker.js'));
    const finish = (callback, value) => {
      worker.terminate();
      callback(value);
    };
    worker.onmessage = (event) =>
      event.data?.ok
        ? finish(resolve, event.data.result)
        : finish(reject, new Error(event.data?.error || 'XMind 解析失败'));
    worker.onerror = () => finish(reject, new Error('XMind 解析进程异常退出'));
    worker.postMessage(buffer, [buffer]);
  });
}

async function importXmindFile(file) {
  closePopovers();
  if (!/\.xmind$/i.test(file.name || '')) {
    showToast('请选择 .xmind 文件');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast('XMind 文件不能超过 20 MB');
    return;
  }
  showToast('正在安全解析 XMind…');
  try {
    let buffer = await file.arrayBuffer();
    const result = await runXmindImportWorker(buffer);
    buffer = null;
    openMindmapImportDialog(result.sheets, result.warnings, file.name.replace(/\.xmind$/i, ''));
  } catch (error) {
    showToast(error.message || 'XMind 导入失败');
  }
}

async function importMindmapMarkdownFile(file) {
  closePopovers();
  if (!/\.(?:md|markdown)$/i.test(file.name || '')) {
    showToast('请选择 .md 或 .markdown 文件');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('Markdown 文件不能超过 2 MB');
    return;
  }
  try {
    const text = await file.text();
    const parsed = window.MindMapMarkdown.parseMarkdown(text, {
      fallbackTitle: file.name.replace(/\.(?:md|markdown)$/i, '')
    });
    openMindmapImportDialog(
      [{ id: 'markdown', title: parsed.tree.text, layoutMode: 'mindmap', tree: parsed.tree, relations: [] }],
      parsed.warnings,
      file.name
    );
  } catch (error) {
    showToast(`${error.message || 'Markdown 解析失败'}${error.line ? `（第 ${error.line} 行）` : ''}`);
  }
}

function openMindmapImportDialog(sheets, warnings = [], sourceName = '') {
  state.mindmapImport = { sheets, warnings, sourceName };
  els.mindmapImportSummary.textContent = `${sourceName ? `「${sourceName}」 · ` : ''}${sheets.length} 个 Sheet`;
  els.mindmapImportSheets.replaceChildren();
  sheets.forEach((sheet, index) => {
    const label = document.createElement('label');
    label.className = 'mindmap-sheet-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.sheetIndex = String(index);
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = sheet.title || `Sheet ${index + 1}`;
    const detail = document.createElement('small');
    const firstLevel = Array.isArray(sheet.tree?.children) ? sheet.tree.children.length : 0;
    const direction =
      sheet.layoutMode === 'logic-left' ? '向左' : sheet.layoutMode === 'logic-right' ? '向右' : '双向/自动';
    detail.textContent = `${countMindNodes(sheet.tree)} 个节点 · ${firstLevel} 个一级分支 · ${direction}`;
    copy.append(title, detail);
    const preview = document.createElement('span');
    preview.className = 'mindmap-sheet-preview';
    preview.textContent =
      String(sheet.tree?.text || sheet.title || '脑图')
        .trim()
        .slice(0, 2) || '脑图';
    preview.title = `根主题：${String(sheet.tree?.text || sheet.title || '未命名').slice(0, 80)}`;
    label.append(checkbox, copy, preview);
    els.mindmapImportSheets.appendChild(label);
  });
  els.mindmapImportWarnings.textContent = warnings.length ? `注意：${warnings.join('；')}` : '';
  els.mindmapImportDialog.hidden = false;
  updateMindmapImportActionState();
  refreshIcons(els.mindmapImportDialog);
}

function updateMindmapImportActionState() {
  if (!els.confirmMindmapImportButton || !els.mindmapImportSheets) return;
  const count = els.mindmapImportSheets.querySelectorAll('input[type="checkbox"]:checked').length;
  els.confirmMindmapImportButton.disabled = count === 0;
  const label = els.confirmMindmapImportButton.querySelector('[data-import-confirm-label]');
  if (label) label.textContent = count ? `导入所选 Sheet（${count}）` : '请选择 Sheet';
}

function closeMindmapImportDialog() {
  state.mindmapImport = null;
  els.mindmapImportDialog.hidden = true;
  els.mindmapImportSheets.replaceChildren();
}

async function confirmMindmapImport() {
  const pending = state.mindmapImport;
  if (!pending) return;
  const selected = Array.from(
    els.mindmapImportSheets.querySelectorAll('input:checked'),
    (input) => pending.sheets[Number(input.dataset.sheetIndex)]
  ).filter(Boolean);
  if (!selected.length) {
    showToast('请至少选择一个 Sheet');
    return;
  }
  setMindmapPlacementLoading(true, `正在放置 ${selected.length} 个脑图…`);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const beforeItems = snapshotItems();
  const center = getViewportDropPoint(520, 300);
  const reserved = Array.from(state.items.values())
    .filter((item) => !item.hidden)
    .map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }));
  const items = selected.map((sheet, index) => {
    const item = createMindMapItem({ x: 0, y: 0 }, sheet.tree, sheet);
    if (!item) return null;
    const preferred = {
      x: center.x + (index % 2) * (item.w + 40),
      y: center.y + Math.floor(index / 2) * (item.h + 40)
    };
    const point = findOpenCanvasPoint(item.w, item.h, preferred, reserved);
    item.x = point.x;
    item.y = point.y;
    reserved.push({ x: item.x, y: item.y, w: item.w, h: item.h });
    return item;
  });
  if (items.some((item) => !item)) {
    setMindmapPlacementLoading(false);
    return;
  }
  pushUndoSnapshot(beforeItems);
  const ops = [];
  items.forEach((item) => {
    item.layerId = state.activeLayerId;
    item.sectionId = findSectionForItem(item)?.id || null;
    item.groupId = null;
    item.locked = false;
    item.hidden = false;
    state.items.set(item.id, item);
    state.zCounter = Math.max(state.zCounter, Number(item.z || 1) + 1);
    renderItem(item);
    ops.push({ kind: 'upsert', item });
  });
  enqueueOperation(ops.length === 1 ? ops[0] : { kind: 'batch', ops });
  markDirty(true);
  selectItem(items[0].id);
  closeMindmapImportDialog();
  setMindmapPlacementLoading(false);
  showToast(`已导入 ${items.length} 个脑图${pending.warnings.length ? '，部分高级内容已降级' : ''}`);
}
export {
  addMindMapItem,
  runXmindImportWorker,
  openMindmapImportDialog,
  updateMindmapImportActionState,
  closeMindmapImportDialog,
  confirmMindmapImport,
  importMindmapMarkdownFile,
  importXmindFile
};
