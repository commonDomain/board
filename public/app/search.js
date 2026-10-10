import { isGuestMode } from './account-lifecycle.js';
import { switchCanvas } from './canvas-session.js';
import { els } from './elements.js';
import { cancelSurfaceMorph, morphSurface, refreshIcons, setOrbActive, showToast } from './interface-model.js';
import { interfaceEffects } from './interface.js';

import { clearSearchLocator } from './search-locator-model.js';
import { locateTarget } from './search-locator.js';
import { focusSheetPreviewCell } from './sheet-preview.js';
import { getSheetRecord } from './sheet-store.js';
import { state } from './state.js';
import { clamp, isImeEvent, waitForCanvasPaint } from './utilities.js';
import { waitForBoardJoin } from './canvas-state.js';
import { sheetCellSearchMatches, sheetCellSearchResult } from './search-model.js';

let itemNavigatorTypeLabel;

function configureSearch(callbacks) {
  ({
    itemNavigatorTypeLabel
  } = callbacks);
}

function openGlobalSearch() {
  if (!els.globalSearchDialog) return;
  clearSearchLocator();
  els.globalSearchDialog.hidden = false;
  morphSurface(els.globalSearchDialog.querySelector('.search-command'), els.globalSearchButton);
  els.globalSearchInput.value = '';
  els.globalSearchStatus.textContent = '输入关键词开始搜索';
  els.globalSearchResults.textContent = '';
  state.searchResults = [];
  state.searchActiveIndex = -1;
  setOrbActive(interfaceEffects.searchOrb, false, 'searching');
  requestAnimationFrame(() => {
    if (!els.globalSearchDialog.hidden) els.globalSearchInput.focus();
  });
}

function closeGlobalSearch() {
  if (!els.globalSearchDialog) return;
  state.searchRequest?.abort();
  state.searchRequest = null;
  setOrbActive(interfaceEffects.searchOrb, false, 'searching');
  document.querySelector('.search-command')?.classList.remove('is-beam-active');
  cancelSurfaceMorph(els.globalSearchDialog.querySelector('.search-command'));
  els.globalSearchDialog.hidden = true;
  els.globalSearchButton?.focus({ preventScroll: true });
}

async function runGlobalSearch() {
  const query = els.globalSearchInput.value.trim();
  state.searchRequest?.abort();
  state.searchRequest = null;
  if (!query) {
    state.searchResults = [];
    els.globalSearchStatus.textContent = '输入关键词开始搜索';
    els.globalSearchResults.textContent = '';
    setOrbActive(interfaceEffects.searchOrb, false, 'searching');
    document.querySelector('.search-command')?.classList.remove('is-beam-active');
    return;
  }
  const controller = new AbortController();
  state.searchRequest = controller;
  els.globalSearchStatus.textContent = '正在搜索所有画布…';
  setOrbActive(interfaceEffects.searchOrb, true, 'searching');
  document.querySelector('.search-command')?.classList.add('is-beam-active');
  try {
    if (isGuestMode()) {
      const canvases = await window.WhiteboardStorage.exportGuestCanvases(null, { hydrateImages: false });
      const lower = query.toLocaleLowerCase();
      state.searchResults = [];
      for (const canvas of canvases) {
        const sections = Array.isArray(canvas.snapshot?.sections) ? canvas.snapshot.sections : [];
        const sectionNames = new Map(sections.map((section) => [section.id, section.name || '未命名画框']));

        if ((canvas.name || '').toLocaleLowerCase().includes(lower)) {
          state.searchResults.push({
            canvasId: canvas.id,
            canvasName: canvas.name,
            documentId: '__canvas__',
            targetId: canvas.id,
            kind: 'canvas',
            label: canvas.name,
            excerpt: canvas.name,
            x: 0,
            y: 0
          });
        }
        
        for (const section of sections) {
          if (!(section.name || '').toLocaleLowerCase().includes(lower)) continue;

          state.searchResults.push({
            canvasId: canvas.id,
            canvasName: canvas.name,
            documentId: `section:${section.id}`,
            targetId: section.id,
            kind: 'section',
            label: section.name || '未命名画框',
            excerpt: section.name || '',
            sectionId: section.id,
            sectionName: section.name || '',

            x: Number(section.x) || 0,
            y: Number(section.y) || 0
          });
          if (state.searchResults.length >= 50) break;
        }
        if (state.searchResults.length >= 50) break;
        for (const item of canvas.snapshot?.items || []) {
          if (item.type === 'sheet') {
            const matches = sheetCellSearchMatches(item, query, 50 - state.searchResults.length);
            for (const match of matches) {
              state.searchResults.push(
                sheetCellSearchResult(item, match, {
                  canvasId: canvas.id,
                  canvasName: canvas.name,
                  sectionName: sectionNames.get(item.sectionId) || ''
                })
              );
            }
            if (state.searchResults.length >= 50) break;
            continue;
          }
          const content = [
            item.navigatorName,
            item.text,
            item.content,
            item.title,
            item.name,
            JSON.stringify(item.rows || ''),
            JSON.stringify(item.tree || '')
          ]
            .filter(Boolean)
            .join(' ');
          if (!content.toLocaleLowerCase().includes(lower)) continue;

          state.searchResults.push({
            canvasId: canvas.id,
            canvasName: canvas.name,
            documentId: item.id,
            targetId: item.id,
            kind: item.type,
            label: item.navigatorName || item.name || item.title || item.text || itemNavigatorTypeLabel(item.type),
            excerpt: content.slice(0, 240),
            sectionId: item.sectionId || null,
            sectionName: sectionNames.get(item.sectionId) || '',

            x: Number(item.x) || 0,
            y: Number(item.y) || 0
          });
          if (state.searchResults.length >= 50) break;
        }
        if (state.searchResults.length >= 50) break;
      }
      state.searchActiveIndex = state.searchResults.length ? 0 : -1;
      els.globalSearchStatus.textContent = state.searchResults.length
        ? `找到 ${state.searchResults.length} 项`
        : '没有找到匹配内容';
      renderGlobalSearchResults();
      return;
    }
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=50`, { signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Search failed');
    state.searchResults = Array.isArray(body.results) ? body.results : [];
    state.searchActiveIndex = state.searchResults.length ? 0 : -1;
    els.globalSearchStatus.textContent = state.searchResults.length
      ? `找到 ${state.searchResults.length} 项`
      : '没有找到匹配内容';
    renderGlobalSearchResults();
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error(error);
    els.globalSearchStatus.textContent = '搜索失败，请稍后重试';
  } finally {
    if (state.searchRequest === controller) {
      state.searchRequest = null;
      setOrbActive(interfaceEffects.searchOrb, false, 'searching');
      document.querySelector('.search-command')?.classList.remove('is-beam-active');
    }
  }
}

function renderGlobalSearchResults() {
  els.globalSearchResults.textContent = '';
  state.searchResults.forEach((result, index) => {
    const meta = {
      canvas: { label: '画布', icon: 'layers-3', tone: 'canvas' },
      section: { label: '画框', icon: 'panel-top', tone: 'section' },
      group: { label: '分组', icon: 'group', tone: 'group' },
      text: { label: '文本', icon: 'type', tone: 'text' },
      note: { label: '便签', icon: 'sticky-note', tone: 'note' },
      table: { label: '表格', icon: 'table-2', tone: 'table' },
      mindmap: { label: '脑图', icon: 'network', tone: 'mindmap' },
      kdocs: { label: '云文档', icon: 'file-text', tone: 'kdocs' },
      sheet: { label: '工作表', icon: 'file-spreadsheet', tone: 'sheet' },
      ink: { label: '笔迹', icon: 'pen-tool', tone: 'ink' },
      image: { label: '图片', icon: 'image', tone: 'image' },
      shape: { label: '形状', icon: 'shapes', tone: 'shape' },
      connector: { label: '连接线', icon: 'workflow', tone: 'connector' },
      sticker: { label: '贴纸', icon: 'sparkles', tone: 'sticker' }
    }[result.kind] || { label: '元素', icon: 'box', tone: 'item' };

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    button.dataset.resultKind = meta.tone;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === state.searchActiveIndex));
    const iconBox = document.createElement('span');
    iconBox.className = 'search-result-icon';
    const icon = document.createElement('i');
    icon.dataset.lucide = meta.icon;
    iconBox.appendChild(icon);
    const copy = document.createElement('span');
    copy.className = 'search-result-copy';
    const titleRow = document.createElement('span');
    titleRow.className = 'search-result-title-row';
    const title = document.createElement('strong');
    title.textContent = result.label || result.excerpt || '未命名内容';
    const kind = document.createElement('span');
    kind.className = 'search-result-kind';
    kind.textContent = meta.label;
    titleRow.append(title, kind);
    const excerpt = document.createElement('span');
    excerpt.className = 'search-result-excerpt';
    excerpt.textContent = result.kind === 'canvas' ? '打开整张画布' : result.excerpt || `${meta.label}内容`;
    const location = document.createElement('span');
    location.className = 'search-result-location';
    const canvasIcon = document.createElement('i');
    canvasIcon.dataset.lucide = 'layers-3';
    const canvasName = document.createElement('span');
    canvasName.className = 'search-path-canvas';
    canvasName.textContent = result.canvasName || '未命名画布';
    location.append(canvasIcon, canvasName);
    if (result.noteTitle && !(result.kind === 'note' && String(result.documentId || '').startsWith('note:'))) {
      const separator = document.createElement('i');
      separator.dataset.lucide = 'chevron-right';
      const noteIcon = document.createElement('i');
      noteIcon.dataset.lucide = 'book-open';
      const noteName = document.createElement('span');
      noteName.textContent = result.noteTitle;
      location.append(separator, noteIcon, noteName);
    }
    if (result.sectionName && result.kind !== 'section') {
      const separator = document.createElement('i');
      separator.dataset.lucide = 'chevron-right';
      const sectionIcon = document.createElement('i');
      sectionIcon.dataset.lucide = 'panel-top';
      const sectionName = document.createElement('span');
      sectionName.className = 'search-path-section';
      sectionName.textContent = result.sectionName;
      location.append(separator, sectionIcon, sectionName);
    }
    if (result.kind === 'sheet' && result.sheetName && result.cellAddress) {
      const separator = document.createElement('i');
      separator.dataset.lucide = 'chevron-right';
      const sheetIcon = document.createElement('i');
      sheetIcon.dataset.lucide = 'file-spreadsheet';
      const cell = document.createElement('span');
      cell.className = 'search-path-sheet-cell';
      cell.textContent = `${result.sheetName}!${result.cellAddress}`;
      location.append(separator, sheetIcon, cell);
    }
    const locationParts = [`画布 ${result.canvasName}`];
    if (result.noteTitle) locationParts.push(`笔记 ${result.noteTitle}`);
    if (result.sectionName && result.kind !== 'section') locationParts.push(`画框 ${result.sectionName}`);
    if (result.kind === 'sheet' && result.sheetName && result.cellAddress)
      locationParts.push(`单元格 ${result.sheetName}!${result.cellAddress}`);
    location.setAttribute('aria-label', locationParts.join('，'));
    copy.append(titleRow, excerpt, location);
    button.append(iconBox, copy);
    button.addEventListener('mouseenter', () => {
      state.searchActiveIndex = index;
      renderGlobalSearchSelection();
    });
    button.addEventListener('click', () => activateSearchResult(result));
    els.globalSearchResults.appendChild(button);
  });
  refreshIcons(els.globalSearchResults);
}

function renderGlobalSearchSelection() {
  els.globalSearchResults
    .querySelectorAll('.search-result')
    .forEach((button, index) => button.setAttribute('aria-selected', String(index === state.searchActiveIndex)));
  els.globalSearchResults.children[state.searchActiveIndex]?.scrollIntoView({ block: 'nearest' });
}

function onGlobalSearchKeyDown(event) {
  if (isImeEvent(event)) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeGlobalSearch();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    state.searchActiveIndex = clamp(state.searchActiveIndex + delta, 0, Math.max(0, state.searchResults.length - 1));
    renderGlobalSearchSelection();
    return;
  }
  if (event.key === 'Enter' && state.searchActiveIndex >= 0) {
    event.preventDefault();
    activateSearchResult(state.searchResults[state.searchActiveIndex]);
  }
}

async function activateSearchResult(result) {
  const query = els.globalSearchInput.value.trim();
  closeGlobalSearch();
  if (result.canvasId !== state.boardId) {
    await switchCanvas(result.canvasId);
    const joined = await waitForBoardJoin(result.canvasId);
    if (!joined) {
      showToast('目标画布加载失败，请重试');
      return;
    }
    await waitForCanvasPaint();
  }
  locateTarget(result.targetId, result.x, result.y, { fromSearch: true, query });
  if (result.kind !== 'sheet') return;
  const item = state.items.get(result.targetId);
  if (!item?.workbook) return;
  const record = getSheetRecord(item);
  const targetCell =
    Number.isInteger(result.row) && Number.isInteger(result.column)
      ? result
      : sheetCellSearchMatches(item, query, 1, { store: record?.store })[0];
  if (!targetCell) return;
  focusSheetPreviewCell(item, targetCell);
}
export {
  openGlobalSearch,
  closeGlobalSearch,
  runGlobalSearch,
  renderGlobalSearchResults,
  renderGlobalSearchSelection,
  onGlobalSearchKeyDown,
  activateSearchResult
};

export { configureSearch };
