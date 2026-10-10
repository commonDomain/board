import { canMutateItem } from './layers-model.js';
import { intersectsRect } from './rendering-model.js';
import { state } from './state.js';

function countMindMapNodes(root) {
  if (!root || typeof root !== 'object') return 0;
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const node = pending.pop();
    count += 1;
    for (const child of node.children || []) {
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return count;
}

function getItemLoadMetrics(item) {
  let complexity = 1;
  const inkPoints = item?.type === 'ink' && Array.isArray(item.points) ? item.points.length : 0;
  if (item?.type === 'table') {
    complexity += (item.rows || []).reduce((sum, row) => sum + (Array.isArray(row) ? row.length : 0), 0) * 2;
  } else if (item?.type === 'mindmap') {
    complexity += countMindMapNodes(item.tree) * 4;
  } else if (item?.type === 'text' || item?.type === 'note') {
    complexity += Math.ceil(String(item.text || '').length / 80);
  } else if (item?.type === 'amap-search') {
    complexity += (item.results || []).length * 4;
  } else if (item?.type === 'amap-route') {
    complexity += (item.routes || []).reduce((sum, route) => sum + (route.steps || []).length * 2, 0);
  } else if (item?.type === 'sheet') {
    // Spreadsheet previews only paint their visible cells, but parsing,
    // formula indexes and backing-store pressure still scale with populated
    // cells. Count sparse entries instead of the declared row/column extent so
    // a lone far-away cell cannot incorrectly classify the whole canvas.
    const sheets = Array.isArray(item.workbook?.sheets) ? item.workbook.sheets : [];
    let populatedCells = 0;
    let formulaCells = 0;
    for (const sheet of sheets) {
      const cells = sheet?.cells && typeof sheet.cells === 'object' ? Object.values(sheet.cells) : [];
      populatedCells += cells.length;
      for (const cell of cells) {
        if (typeof cell?.formula === 'string' && cell.formula) formulaCells += 1;
      }
    }
    complexity += Math.ceil(populatedCells / 18) + Math.ceil(formulaCells / 6) + sheets.length * 3;
  }
  return { complexity, inkPoints };
}

function updateItemLoadMetrics(item) {
  if (!item?.id) return;
  const previousComplexity = state.renderComplexityByItem.get(item.id) || 0;
  const previousInkPoints = state.inkPointCountByItem.get(item.id) || 0;
  const { complexity, inkPoints } = getItemLoadMetrics(item);
  state.renderComplexityByItem.set(item.id, complexity);
  state.inkPointCountByItem.set(item.id, inkPoints);
  state.renderComplexity += complexity - previousComplexity;
  state.inkPointCount += inkPoints - previousInkPoints;
}

function removeItemLoadMetrics(id) {
  state.renderComplexity -= state.renderComplexityByItem.get(id) || 0;
  state.inkPointCount -= state.inkPointCountByItem.get(id) || 0;
  state.renderComplexityByItem.delete(id);
  state.inkPointCountByItem.delete(id);
}

function rebuildItemLoadMetrics() {
  state.renderComplexity = 0;
  state.inkPointCount = 0;
  state.renderComplexityByItem.clear();
  state.inkPointCountByItem.clear();
  for (const item of state.items.values()) updateItemLoadMetrics(item);
}

function removeConnectorFromIndex(connectorId) {
  const endpoints = state.connectorEndpoints.get(connectorId) || [];
  for (const endpointId of endpoints) {
    const connectors = state.connectorIndex.get(endpointId);
    connectors?.delete(connectorId);
    if (!connectors?.size) state.connectorIndex.delete(endpointId);
  }
  state.connectorEndpoints.delete(connectorId);
}

function indexConnector(item) {
  if (!item?.id) return;
  removeConnectorFromIndex(item.id);
  if (item.type !== 'connector') return;
  const endpoints = [item.source?.binding?.id, item.target?.binding?.id, item.startId, item.endId].filter(Boolean);
  state.connectorEndpoints.set(item.id, endpoints);
  for (const endpointId of endpoints) {
    let connectors = state.connectorIndex.get(endpointId);
    if (!connectors) {
      connectors = new Set();
      state.connectorIndex.set(endpointId, connectors);
    }
    connectors.add(item.id);
  }
}

function rebuildConnectorIndex() {
  state.connectorIndex = new Map();
  state.connectorEndpoints = new Map();
  for (const item of state.items.values()) indexConnector(item);
}

function geometryWorkerItem(item) {
  return {
    id: item.id,
    x: Number(item.x) || 0,
    y: Number(item.y) || 0,
    w: Number(item.w) || 0,
    h: Number(item.h) || 0,
    rotation: Number(item.rotation) || 0,
    selectable: canMutateItem(item)
  };
}

function queryItemsInRect(rect) {
  if (state.spatialIndexEnabled) return state.spatialIndex.search(rect);
  return Array.from(state.items.values()).filter((item) => intersectsRect(item, rect));
}

function queryItemsAtPoint(point) {
  if (state.spatialIndexEnabled) return state.spatialIndex.searchPoint(point);
  return Array.from(state.items.values());
}
export {
  countMindMapNodes,
  getItemLoadMetrics,
  updateItemLoadMetrics,
  removeItemLoadMetrics,
  rebuildItemLoadMetrics,
  removeConnectorFromIndex,
  indexConnector,
  rebuildConnectorIndex,
  geometryWorkerItem,
  queryItemsInRect,
  queryItemsAtPoint
};
