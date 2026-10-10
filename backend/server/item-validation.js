import crypto from 'node:crypto';
import SheetProtocol from '../../public/sheet-protocol.js';
import ConnectorCore from '../../public/connector-core.js';
import {AMAP_ITEM_TYPES,ITEM_TYPES,STICKER_TYPES} from './item-schema.js';
import {
  applyTextFormatting,
  sanitizeAmapPoi,
  sanitizeAmapPoint,
  sanitizeAmapRoute,
  sanitizeBrushOpts,
  sanitizeInkPoints,
  sanitizeKdocsUrl,
  sanitizeMindStyle,
  sanitizeRichText,
  sanitizeTableRows,
  sanitizeTextAppearance,
  sanitizeTree
} from './content-validation.js';
import { ProtocolError } from './protocol-error.js';
import { clampNumber, cleanString, isSafeId } from './validation.js';

function sanitizeItem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const id = cleanString(input.id, 128, '');
  const type = input.type;
  if (!isSafeId(id) || !ITEM_TYPES.has(type)) {
    return null;
  }
  const item = {
    id,
    type,
    x: clampNumber(input.x, -100000000, 100000000, 0),
    y: clampNumber(input.y, -100000000, 100000000, 0),
    w: clampNumber(input.w, 8, 1000000, 120),
    h: clampNumber(input.h, 8, 1000000, 80),
    rotation: clampNumber(input.rotation, -36000, 36000, 0),
    z: clampNumber(input.z, -1000000000, 1000000000, 1),
    navigatorOrder: clampNumber(input.navigatorOrder, -1000000000, 1000000000, input.z),
    layerId: cleanString(input.layerId, 64, 'layer_default') || 'layer_default',
    sectionId: input.sectionId === null || input.sectionId === undefined ? null : cleanString(input.sectionId, 128, ''),
    groupId: input.groupId === null || input.groupId === undefined ? null : cleanString(input.groupId, 128, ''),
    locked: Boolean(input.locked),
    hidden: Boolean(input.hidden)
  };

  const navigatorName = cleanString(input.navigatorName, 100, '').trim();
  if (input.taskRef && ['text', 'note'].includes(type)) {
    if (!isSafeId(input.taskRef.planId) || !isSafeId(input.taskRef.taskId)) return null;
    item.taskRef = { planId: input.taskRef.planId, taskId: input.taskRef.taskId };
  }
  if (type === 'planning') {
    if (!isSafeId(input.planRef)) return null;
    item.planRef = input.planRef;
    item.planView = ['list', 'kanban', 'calendar'].includes(input.planView) ? input.planView : 'list';
  }
  if (navigatorName) {
    item.navigatorName = navigatorName;
  }
  if (AMAP_ITEM_TYPES.has(type)) {
    const creatorUserId = cleanString(input.createdByUserId, 128, '');
    if (creatorUserId && isSafeId(creatorUserId)) item.createdByUserId = creatorUserId;
  }

  if (!isSafeId(item.layerId)) {
    return null;
  }
  if ((item.sectionId && !isSafeId(item.sectionId)) || (item.groupId && !isSafeId(item.groupId))) {
    return null;
  }

  if (type === 'ink') {
    item.baseW = clampNumber(input.baseW, 8, 1000000, item.w);
    item.baseH = clampNumber(input.baseH, 8, 1000000, item.h);
    item.stroke = cleanString(input.stroke, 64, '#111111') || '#111111';
    item.strokeWidth = clampNumber(input.strokeWidth, 0.1, 500, 4);
    item.opacity = clampNumber(input.opacity, 0, 1, 1);
    const brushType = cleanString(input.brushType, 32, 'brush');
    item.brushType = new Set([
      'brush',
      'pencil',
      'calligraphy',
      'spray',
      'oil',
      'crayon',
      'marker',
      'normal-pencil',
      'watercolor'
    ]).has(brushType)
      ? brushType
      : 'brush';
    item.pts = sanitizeInkPoints(input.pts);
    item.seed = input.seed === undefined ? undefined : Math.floor(clampNumber(input.seed, 0, 4294967295, 0));
    item.brushOpts = sanitizeBrushOpts(input.brushOpts);
  } else if (type === 'shape') {
    item.shape = cleanString(input.shape, 32, 'rect');
    item.flipX = Boolean(input.flipX);
    item.flipY = Boolean(input.flipY);
    item.stroke = cleanString(input.stroke, 64, '#111111') || '#111111';
    item.strokeWidth = clampNumber(input.strokeWidth, 0.1, 500, 4);
    item.fill = cleanString(input.fill, 64, 'none');
  } else if (type === 'image') {
    const src = cleanString(input.src, 18 * 1024 * 1024, '');
    if (
      !/^(\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)|data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+)$/i.test(src)
    ) {
      return null;
    }
    item.src = src;
    const assetMatch = src.match(/^\/assets\/([a-f0-9]{64})\.(?:png|jpg|webp)$/i);
    const requestedAssetId = cleanString(input.assetId, 64, '').toLowerCase();
    item.assetId =
      assetMatch?.[1].toLowerCase() || (/^[a-f0-9]{64}$/.test(requestedAssetId) ? requestedAssetId : undefined);
    item.naturalWidth = Math.floor(clampNumber(input.naturalWidth, 1, 100000, item.w));
    item.naturalHeight = Math.floor(clampNumber(input.naturalHeight, 1, 100000, item.h));
  } else if (type === 'kdocs') {
    item.url = sanitizeKdocsUrl(input.url);
    if (!item.url) {
      return null;
    }
    item.title = cleanString(input.title, 200, 'WPS 云文档') || 'WPS 云文档';
  } else if (type === 'text' || type === 'note') {
    item.color = cleanString(input.color, 64, '#111111') || '#111111';
    applyTextFormatting(item, input, 18);
    const richText = sanitizeRichText(input.richText, item);
    if (richText?.length) {
      item.richText = richText;
      item.text = richText.map((run) => run.text).join('');
    } else {
      item.text = cleanString(input.text, 100000, '');
    }
    const allowedLineStyles = new Set(['none', 'number', 'bullet', 'todo']);
    const legacyListMode = cleanString(input.listMode, 16, 'none');
    const legacyStyle = allowedLineStyles.has(legacyListMode) ? legacyListMode : 'none';
    const lineCount = item.text.split(/\r?\n/).length;
    item.listMode = 'none';
    item.lineStyles = Array.from({ length: lineCount }, (_, index) => {
      const style = Array.isArray(input.lineStyles)
        ? cleanString(input.lineStyles[index], 16, legacyStyle)
        : legacyStyle;
      return allowedLineStyles.has(style) ? style : 'none';
    });
    item.completedLines = Array.isArray(input.completedLines)
      ? [
          ...new Set(
            input.completedLines
              .map((index) => Math.floor(Number(index)))
              .filter(
                (index) =>
                  Number.isFinite(index) && index >= 0 && index < lineCount && item.lineStyles[index] === 'todo'
              )
          )
        ]
          .slice(0, 10000)
          .sort((left, right) => left - right)
      : [];
    if (type === 'text') sanitizeTextAppearance(item, input);
    if (type === 'note') {
      const noteFill = cleanString(input.noteFill, 16, '#fff4b2').toLowerCase();
      item.noteFill = /^#[0-9a-f]{6}$/.test(noteFill) ? noteFill : '#fff4b2';
      item.noteBorder = input.noteBorder === 'solid' ? 'solid' : 'none';
      item.noteShadow = input.noteShadow !== false;
      item.noteOpacity = clampNumber(input.noteOpacity, 0, 1, 1);
    }
  } else if (type === 'table') {
    item.rows = sanitizeTableRows(input.rows || [['']]);
    item.header = Boolean(input.header);
    item.color = cleanString(input.color, 64, '#111111') || '#111111';
    item.columnWidths = Array.isArray(input.columnWidths)
      ? input.columnWidths.slice(0, 50).map((width) => clampNumber(width, 8, 10000, 92))
      : [];
    item.rowHeights = Array.isArray(input.rowHeights)
      ? input.rowHeights.slice(0, 200).map((height) => clampNumber(height, 8, 10000, 34))
      : [];
    applyTextFormatting(item, input, 15);
  } else if (type === 'mindmap') {
    item.tree = sanitizeTree(input.tree || { text: '中心主题', children: [] });
    item.branchStyle = new Set(['smart', 'curve', 'elbow']).has(input.branchStyle) ? input.branchStyle : 'smart';
    item.layoutMode = new Set([
      'mindmap',
      'logic-left',
      'logic-right',
      'tree-left',
      'tree-right',
      'org-down',
      'timeline'
    ]).has(input.layoutMode)
      ? input.layoutMode
      : 'mindmap';
    const nodeIds = new Set();
    const nodeStack = [item.tree];
    while (nodeStack.length) {
      const node = nodeStack.pop();
      nodeIds.add(node.id);
      nodeStack.push(...node.children);
    }
    item.relations = Array.isArray(input.relations)
      ? input.relations
          .slice(0, 1000)
          .map((relation, index) => ({
            id: isSafeId(relation?.id) ? relation.id : `mr_${index}_${crypto.randomUUID()}`,
            startId: cleanString(relation?.startId, 128, ''),
            endId: cleanString(relation?.endId, 128, ''),
            label: cleanString(relation?.label, 200, ''),
            lineStyle: sanitizeMindStyle(relation?.lineStyle)
          }))
          .filter((relation) => nodeIds.has(relation.startId) && nodeIds.has(relation.endId))
      : [];
    if (input.source?.provider === 'xmind') {
      item.source = {
        provider: 'xmind',
        remoteMapId: cleanString(input.source.remoteMapId, 512, ''),
        remoteName: cleanString(input.source.remoteName, 200, 'XMind 脑图'),
        connectedUserId: cleanString(input.source.connectedUserId, 128, ''),
        accountProvider: new Set(['global', 'china']).has(input.source.accountProvider)
          ? input.source.accountProvider
          : 'global',
        remoteHash: cleanString(input.source.remoteHash, 128, ''),
        localOnlyFields: Array.isArray(input.source.localOnlyFields)
          ? input.source.localOnlyFields.filter((field) => field === 'note' || field === 'status')
          : ['note', 'status'],
        syncState: new Set(['synced', 'pending', 'reauthorize', 'remote-changed']).has(input.source.syncState)
          ? input.source.syncState
          : 'synced',
        syncedAt: Math.max(0, Math.trunc(Number(input.source.syncedAt) || 0))
      };
      if (!item.source.remoteMapId || !item.source.connectedUserId) delete item.source;
    }
  } else if (type === 'connector') {
    item.startId = input.startId === null || input.startId === undefined ? null : cleanString(input.startId, 128, '');
    item.endId = input.endId === null || input.endId === undefined ? null : cleanString(input.endId, 128, '');
    if ((item.startId && !isSafeId(item.startId)) || (item.endId && !isSafeId(item.endId))) {
      return null;
    }
    item.startX = clampNumber(input.startX, -100000000, 100000000, item.x);
    item.startY = clampNumber(input.startY, -100000000, 100000000, item.y);
    item.endX = clampNumber(input.endX, -100000000, 100000000, item.x + item.w);
    item.endY = clampNumber(input.endY, -100000000, 100000000, item.y + item.h);
    item.stroke = cleanString(input.stroke, 64, '#111111') || '#111111';
    item.strokeWidth = clampNumber(input.strokeWidth, 0.1, 500, 3);
    item.arrowStart = Boolean(input.arrowStart);
    item.arrowEnd = input.arrowEnd !== false;
    item.dasharray = cleanString(input.dasharray, 64, '');
  } else if (type === 'sticker') {
    const icon = cleanString(input.icon, 32, '');
    if (!STICKER_TYPES.has(icon)) {
      return null;
    }
    item.icon = icon;
    item.color = cleanString(input.color, 64, '#111111') || '#111111';
  } else if (type === 'amap-map') {
    item.createdByUserId = cleanString(input.createdByUserId, 128, '');
    item.center = sanitizeAmapPoint(input.center) || { lng: 116.397428, lat: 39.90923 };
    item.zoom = clampNumber(input.zoom, 3, 20, 11);
    item.viewMode = '2D';
    item.pitch = 0;
    item.heading = clampNumber(input.heading, 0, 360, 0);
    const place = sanitizeAmapPoi(input.place || input.locatedPlace);
    if (place) item.place = place;
  } else if (type === 'amap-search') {
    item.createdByUserId = cleanString(input.createdByUserId, 128, '');
    item.query = cleanString(input.query, 80, '');
    item.city = cleanString(input.city, 40, '');
    item.results = Array.isArray(input.results) ? input.results.slice(0, 10).map(sanitizeAmapPoi).filter(Boolean) : [];
    const selectedPoi = sanitizeAmapPoi(input.selectedPoi);
    if (selectedPoi) item.selectedPoi = selectedPoi;
  } else if (type === 'amap-route') {
    item.createdByUserId = cleanString(input.createdByUserId, 128, '');
    item.mode = new Set(['driving', 'transit', 'walking', 'riding']).has(input.mode) ? input.mode : 'driving';
    item.city = cleanString(input.city, 40, '');
    const origin = sanitizeAmapPoi(input.origin);
    const destination = sanitizeAmapPoi(input.destination);
    if (origin) item.origin = origin;
    if (destination) item.destination = destination;
    item.routes = Array.isArray(input.routes)
      ? input.routes
          .slice(0, 3)
          .map((route, index) => sanitizeAmapRoute(route, `route-${index + 1}`))
          .filter(Boolean)
      : [];
    item.selectedRouteId = cleanString(input.selectedRouteId, 40, item.routes[0]?.id || '');
  }

  if (item.type === 'connector' && input.connectorVersion) {
    if (input.connectorVersion && input.connectorVersion !== ConnectorCore.VERSION)
      throw new ProtocolError('CONNECTOR_VERSION', 'Update the client to edit these connections.');
    Object.assign(
      item,
      ConnectorCore.normalize({
        ...input,
        ...item,
        source: input.source,
        target: input.target,
        connectorVersion: input.connectorVersion
      })
    );
    ConnectorCore.apply(item);
  }
  if (item.type === 'table') {
    item.rowIds = input.rowIds;
    item.columnIds = input.columnIds;
    ConnectorCore.ensureTableIds(item);
  }
  // The spreadsheet payload is opaque to the server and validated by size, like
  // every other item field; the client owns its shape.
  if (item.type === 'sheet') {
    item.workbook =
      input.workbook && typeof input.workbook === 'object' && !Array.isArray(input.workbook) ? input.workbook : null;
    try {
      item.workbook = SheetProtocol.normalizeWorkbook(item.workbook);
    } catch (error) {
      throw new ProtocolError(error.code || 'INVALID_SHEET_WORKBOOK', error.message);
    }
    if (typeof input.title === 'string') item.title = cleanString(input.title, 120, '工作表');
    item.sheetEditedAt = Math.max(0, Math.trunc(clampNumber(input.sheetEditedAt, 0, Number.MAX_SAFE_INTEGER, 0)));
  }
  if (['text', 'note', 'table', 'mindmap', 'sheet'].includes(item.type))
    item.contentVersion = Math.max(0, Math.trunc(clampNumber(input.contentVersion, 0, 1e12, 0)));

  for (const key of Object.keys(item)) {
    if (item[key] === undefined) {
      delete item[key];
    }
  }
  return item;
}

export { sanitizeItem };

