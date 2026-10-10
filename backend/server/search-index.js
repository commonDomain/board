
import { boards } from './board-registry.js';
import { SEARCH_RESULT_LIMIT } from './config.js';
import { servicesRuntime } from './runtime/services.js';
import { cleanString } from './validation.js';

/**
 * Flattens a spreadsheet payload into searchable text.
 *
 * The payload is client-owned, so this reads defensively and stops early: a
 * malformed or enormous sheet must never block a board write.
 */
function sheetSearchText(item, limit = 200000) {
  const sheets = Array.isArray(item?.workbook?.sheets) ? item.workbook.sheets : [];
  const parts = [];
  let length = 0;
  for (const sheet of sheets) {
    if (!sheet || typeof sheet !== 'object') continue;
    if (typeof sheet.name === 'string' && sheet.name) parts.push(sheet.name);
    const cells = sheet.cells && typeof sheet.cells === 'object' ? sheet.cells : {};
    for (const cell of Object.values(cells)) {
      if (!cell || typeof cell !== 'object') continue;
      const value = cell.f !== undefined ? cell.f : cell.v;
      if (value === undefined || value === null || value === '') continue;
      const text = String(value);
      parts.push(text);
      length += text.length + 1;
      if (length >= limit) return parts.join(' ').slice(0, limit);
    }
  }
  return parts.join(' ');
}

function spreadsheetColumnName(column) {
  let value = Math.max(0, Math.trunc(Number(column) || 0)) + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function sheetCellMatches(item, query, limit = SEARCH_RESULT_LIMIT) {
  const normalizedQuery = String(query || '')
    .trim()
    .toLocaleLowerCase('zh-CN');
  const sheets = Array.isArray(item?.workbook?.sheets) ? item.workbook.sheets : [];
  if (!normalizedQuery || !sheets.length) return [];
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
      const values = [cell.f, cell.v]
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map(String);
      const text = values.join(' ');
      if (!text.toLocaleLowerCase('zh-CN').includes(normalizedQuery)) continue;
      matches.push({
        sheetId: typeof sheet.sheetId === 'string' ? sheet.sheetId : '',
        sheetIndex,
        sheetName: typeof sheet.name === 'string' && sheet.name ? sheet.name : `Sheet${sheetIndex + 1}`,
        row,
        column,
        cellAddress: `${spreadsheetColumnName(column)}${row + 1}`,
        cellText: text.replace(/\s+/g, ' ').slice(0, 240)
      });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}

function searchBoardState(boardId, cache) {
  if (cache.has(boardId)) return cache.get(boardId);
  let state = boards.get(boardId)?.state || null;
  if (!state) {
    const row = servicesRuntime.database.prepare('SELECT state_json FROM boards WHERE id = ?').get(boardId);
    try {
      state = row ? JSON.parse(row.state_json) : null;
    } catch {
      state = null;
    }
  }
  cache.set(boardId, state);
  return state;
}

function searchableItemContent(item) {
  const navigatorName = cleanString(item.navigatorName, 100, '').trim();
  let content = '';
  if (item.type === 'text' || item.type === 'note') content = item.text || '';
  else if (item.type === 'table') content = (item.rows || []).flat().join(' ');
  else if (item.type === 'kdocs') content = item.title || '';
  else if (item.type === 'sheet') content = sheetSearchText(item);
  else if (item.type === 'amap-map')
    content = ['地图', item.place?.name, item.place?.address].filter(Boolean).join(' ');
  else if (item.type === 'amap-search')
    content = [item.query, ...(item.results || []).flatMap((poi) => [poi.name, poi.address])].filter(Boolean).join(' ');
  else if (item.type === 'amap-route')
    content = [
      item.origin?.name,
      item.origin?.address,
      item.destination?.name,
      item.destination?.address,
      ...(item.routes || []).flatMap((route) => (route.steps || []).map((step) => step.instruction))
    ]
      .filter(Boolean)
      .join(' ');
  else if (item.type === 'mindmap') {
    const parts = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      parts.push(node.text || '', node.note || '', node.status || '');
      (node.children || []).forEach(visit);
    };
    visit(item.tree);
    content = parts.join(' ');
  }
  return [navigatorName, content].filter(Boolean).join(' ');
}

function itemSearchLabel(item, content) {
  return content.replace(/\s+/g, ' ').slice(0, 120) || ({ image: '图片', ink: '笔迹', shape: '图形' })[item.type] || item.type;
}

function rebuildDerivedIndexes(boardId, state) {
  const catalog = servicesRuntime.database.prepare('SELECT name FROM canvas_catalog WHERE board_id = ?').get(boardId);
  servicesRuntime.database.prepare('DELETE FROM search_documents WHERE board_id = ?').run(boardId);
  servicesRuntime.database.prepare('DELETE FROM search_index WHERE board_id = ?').run(boardId);
  const insertDocument = servicesRuntime.database.prepare(`
    INSERT INTO search_documents (board_id, document_id, kind, label, content, target_id, section_id, x, y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSearch = servicesRuntime.database.prepare(`
    INSERT INTO search_index (content, label, board_id, document_id, kind, target_id, section_id, x, y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const addDocument = (documentId, kind, label, content, targetId, sectionId, x, y) => {
    const normalizedLabel = cleanString(label, 200, '');
    const normalizedContent = cleanString(content, 200000, '');
    insertDocument.run(boardId, documentId, kind, normalizedLabel, normalizedContent, targetId, sectionId, x, y);
    insertSearch.run(normalizedContent, normalizedLabel, boardId, documentId, kind, targetId, sectionId, x, y);
  };
  if (catalog) addDocument('__canvas__', 'canvas', catalog.name, catalog.name, boardId, null, 0, 0);
  
  for (const section of state.sections) {
    addDocument(
      `section:${section.id}`,
      'section',
      section.name,
      section.name,
      section.id,
      section.id,
      section.x,
      section.y
    );
  }
  for (const group of state.groups) {
    const childItems = state.items.filter((item) => item.groupId === group.id);
    const x = childItems.length ? Math.min(...childItems.map((item) => item.x)) : 0;
    const y = childItems.length ? Math.min(...childItems.map((item) => item.y)) : 0;
    addDocument(`group:${group.id}`, 'group', group.name, group.name, group.id, group.sectionId, x, y);
  }
  for (const item of state.items) {
    const content = searchableItemContent(item).trim();
    // Images, strokes and shapes are also selectable notebook materials.
    // Keep their lightweight directory entry even when there is no text.
    const label = itemSearchLabel(item, content);
    addDocument(`item:${item.id}`, item.type, label, content, item.id, item.sectionId, item.x, item.y);
  }

  const spatialRows = servicesRuntime.database
    .prepare('SELECT spatial_id FROM spatial_entities WHERE board_id = ?')
    .all(boardId);
  const deleteBounds = servicesRuntime.database.prepare('DELETE FROM board_bounds WHERE spatial_id = ?');
  for (const row of spatialRows) deleteBounds.run(row.spatial_id);
  servicesRuntime.database.prepare('DELETE FROM spatial_entities WHERE board_id = ?').run(boardId);
  const insertEntity = servicesRuntime.database.prepare(
    'INSERT INTO spatial_entities (board_id, entity_type, entity_id) VALUES (?, ?, ?)'
  );
  const insertBounds = servicesRuntime.database.prepare(
    'INSERT INTO board_bounds (spatial_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)'
  );
  const addBounds = (type, entity) => {
    const result = insertEntity.run(boardId, type, entity.id);
    insertBounds.run(result.lastInsertRowid, entity.x, entity.x + entity.w, entity.y, entity.y + entity.h);
  };
  
  state.sections.forEach((section) => {
    addBounds('section', section);
  });
  state.items.forEach((item) => {
    addBounds('item', item);
  });
}

function deleteSearchDocument(boardId, documentId) {
  servicesRuntime.database
    .prepare('DELETE FROM search_documents WHERE board_id = ? AND document_id = ?')
    .run(boardId, documentId);
  servicesRuntime.database
    .prepare('DELETE FROM search_index WHERE board_id = ? AND document_id = ?')
    .run(boardId, documentId);
}

function upsertSearchDocument(boardId, state, documentId, kind, label, content, targetId, sectionId, x, y) {
  deleteSearchDocument(boardId, documentId);
  const normalizedLabel = cleanString(label, 200, '');
  const normalizedContent = cleanString(content, 200000, '');
  if (!normalizedLabel && !normalizedContent) return;
  servicesRuntime.database
    .prepare(
      `
    INSERT INTO search_documents (board_id, document_id, kind, label, content, target_id, section_id, x, y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(boardId, documentId, kind, normalizedLabel, normalizedContent, targetId, sectionId, x, y);
  servicesRuntime.database
    .prepare(
      `
    INSERT INTO search_index (content, label, board_id, document_id, kind, target_id, section_id, x, y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(normalizedContent, normalizedLabel, boardId, documentId, kind, targetId, sectionId, x, y);
}

function upsertSpatialEntity(boardId, entityType, entity) {
  let row = servicesRuntime.database
    .prepare('SELECT spatial_id FROM spatial_entities WHERE board_id = ? AND entity_type = ? AND entity_id = ?')
    .get(boardId, entityType, entity.id);
  if (!row) {
    const result = servicesRuntime.database
      .prepare('INSERT INTO spatial_entities (board_id, entity_type, entity_id) VALUES (?, ?, ?)')
      .run(boardId, entityType, entity.id);
    row = { spatial_id: result.lastInsertRowid };
  } else {
    servicesRuntime.database.prepare('DELETE FROM board_bounds WHERE spatial_id = ?').run(row.spatial_id);
  }
  servicesRuntime.database
    .prepare('INSERT INTO board_bounds (spatial_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)')
    .run(row.spatial_id, entity.x, entity.x + entity.w, entity.y, entity.y + entity.h);
}

function deleteSpatialEntity(boardId, entityType, entityId) {
  const row = servicesRuntime.database
    .prepare('SELECT spatial_id FROM spatial_entities WHERE board_id = ? AND entity_type = ? AND entity_id = ?')
    .get(boardId, entityType, entityId);
  if (!row) return;
  servicesRuntime.database.prepare('DELETE FROM board_bounds WHERE spatial_id = ?').run(row.spatial_id);
  servicesRuntime.database.prepare('DELETE FROM spatial_entities WHERE spatial_id = ?').run(row.spatial_id);
}

function syncDerivedIndexes(boardId, state, operation) {
  let rebuild = false;
  const visit = (op) => {
    if (!op || rebuild) return;
    if (op.kind === 'batch') {
      for (const child of op.ops || []) visit(child);
      return;
    }
    if (op.kind === 'clear' || op.kind === 'delete-container') {
      rebuild = true;
      return;
    }

    if (op.kind === 'upsert' || op.kind === 'sheet-command') {
      const targetId = op.kind === 'sheet-command' ? op.itemId : op.item.id;
      const item = state.items.find((entry) => entry.id === targetId);
      if (!item) return;
      upsertSpatialEntity(boardId, 'item', item);
      const content = searchableItemContent(item).trim();
      if (item)
        upsertSearchDocument(
          boardId,
          state,
          `item:${item.id}`,
          item.type,
          itemSearchLabel(item, content),
          content,
          item.id,
          item.sectionId,
          item.x,
          item.y
        );
      else deleteSearchDocument(boardId, `item:${item.id}`);
      return;
    }
    if (op.kind === 'delete') {
      for (const id of op.ids || []) {
        deleteSpatialEntity(boardId, 'item', id);
        deleteSearchDocument(boardId, `item:${id}`);
      }
      return;
    }
    if (op.kind === 'section-upsert') {
      const section = state.sections.find((entry) => entry.id === op.section.id);
      if (!section) return;
      upsertSpatialEntity(boardId, 'section', section);
      upsertSearchDocument(
        boardId,
        state,
        `section:${section.id}`,
        'section',
        section.name,
        section.name,
        section.id,
        section.id,
        section.x,
        section.y
      );
      return;
    }
    if (op.kind === 'group-upsert') {
      const group = state.groups.find((entry) => entry.id === op.group.id);
      if (!group) return;
      const childItems = state.items.filter((item) => item.groupId === group.id);
      const x = childItems.length ? Math.min(...childItems.map((item) => item.x)) : 0;
      const y = childItems.length ? Math.min(...childItems.map((item) => item.y)) : 0;
      upsertSearchDocument(
        boardId,
        state,
        `group:${group.id}`,
        'group',
        group.name,
        group.name,
        group.id,
        group.sectionId,
        x,
        y
      );
      return;
    }
    if (op.kind === 'transform' || op.kind === 'layout') {
      for (const change of op.items || []) {
        const item = state.items.find((entry) => entry.id === change.id);
        if (item) {
          upsertSpatialEntity(boardId, 'item', item);
          const content = searchableItemContent(item).trim();
          if (item)
            upsertSearchDocument(
              boardId,
              state,
              `item:${item.id}`,
              item.type,
              itemSearchLabel(item, content),
              content,
              item.id,
              item.sectionId,
              item.x,
              item.y
            );
        }
      }
      return;
    }
    if (op.kind === 'reparent') {
      for (const id of op.itemIds || []) {
        const item = state.items.find((entry) => entry.id === id);
        const content = item ? searchableItemContent(item).trim() : '';
        if (item)
          upsertSearchDocument(
            boardId,
            state,
            `item:${item.id}`,
            item.type,
            content.replace(/\s+/g, ' ').slice(0, 120),
            content,
            item.id,
            item.sectionId,
            item.x,
            item.y
          );
      }
    }
  };
  visit(operation);
  if (rebuild) rebuildDerivedIndexes(boardId, state);
}

export {
  deleteSearchDocument,
  deleteSpatialEntity,
  rebuildDerivedIndexes,
  searchBoardState,
  searchableItemContent,
  sheetCellMatches,
  sheetSearchText,
  spreadsheetColumnName,
  syncDerivedIndexes,
  upsertSearchDocument,
  upsertSpatialEntity
};
