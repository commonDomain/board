import { canMutateItem } from './layers-model.js';

import { state } from './state.js';
import { getSticker } from './toolbar-model.js';
import { NAVIGATOR_ICON_ART } from './navigator-controller.js';

function itemNavigatorLabel(item) {
  if (item.navigatorName) return item.navigatorName;
  if (item.type === 'text' || item.type === 'note')
    return (item.text || (item.type === 'note' ? '空便签' : '空文本')).replace(/\s+/g, ' ').slice(0, 80);
  if (item.type === 'table') return `表格 · ${item.rows?.length || 0} 行`;
  if (item.type === 'sheet') return String(item.title || '').trim() || '工作表';
  if (item.type === 'mindmap') return item.tree?.text || '脑图';
  if (item.type === 'kdocs') return item.title || 'WPS 云文档';
  if (item.type === 'amap-map') return item.place?.name || '地图';
  if (item.type === 'amap-search') return item.selectedPoi?.name || item.query || '地点搜索';
  if (item.type === 'amap-route') return `${item.origin?.name || '起点'} → ${item.destination?.name || '终点'}`;
  const labels = { ink: '笔迹', image: '图片', shape: '形状', connector: '连接线', sticker: '贴纸' };
  return labels[item.type] || item.type;
}

function itemNavigatorIcon(item) {
  return (
    {
      text: 'type',
      note: 'sticky-note',
      table: 'table-2',
      sheet: 'table-2',
      mindmap: 'network',
      kdocs: 'file-text',
      ink: 'pen-tool',
      image: 'image',
      shape: 'shapes',
      connector: 'workflow',
      sticker: 'sparkles',
      'amap-map': 'map-pinned',
      'amap-search': 'search',
      'amap-route': 'route'
    }[item.type] || 'box'
  );
}

function createNavigatorTypeIcon(row) {
  const itemType = row.type === 'item' ? state.items.get(row.id)?.type : null;
  const kind = itemType === 'sheet' ? 'table' : itemType || row.type;
  const badge = document.createElement('span');
  badge.className = 'navigator-type-icon';
  badge.dataset.kind = kind;
  badge.setAttribute('aria-hidden', 'true');
  badge.innerHTML = `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">${NAVIGATOR_ICON_ART[kind] || NAVIGATOR_ICON_ART.fallback}</svg>`;
  return badge;
}

function itemNavigatorTypeLabel(type) {
  return (
    {
      text: '文本',
      note: '便签',
      table: '表格',
      sheet: '工作表',
      mindmap: '脑图',
      kdocs: '云文档',
      ink: '笔迹',
      image: '图片',
      shape: '形状',
      connector: '连接线',
      sticker: '贴纸',
      'amap-map': '地图',
      'amap-search': '地点搜索',
      'amap-route': '路线规划'
    }[type] || '元素'
  );
}

function itemNavigatorSearchText(item) {
  const parts = [itemNavigatorLabel(item), itemNavigatorTypeLabel(item.type), item.navigatorName];
  if (item.type === 'text' || item.type === 'note') parts.push(item.text);
  else if (item.type === 'table') parts.push(...(item.rows || []).flat());
  else if (item.type === 'mindmap') {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      parts.push(node.text, node.note, node.status);
      (node.children || []).forEach(visit);
    };
    visit(item.tree);
  } else if (item.type === 'kdocs') parts.push(item.title);
  else if (item.type === 'amap-map') parts.push(item.place?.name, item.place?.address, item.place?.district);
  else if (item.type === 'amap-search') {
    parts.push(item.query, ...(item.results || []).flatMap((poi) => [poi.name, poi.address, poi.district]));
  } else if (item.type === 'amap-route') {
    parts.push(item.origin?.name, item.origin?.address, item.destination?.name, item.destination?.address);
  } else if (item.type === 'sticker') {
    const sticker = getSticker(item.icon);
    parts.push(sticker?.name, sticker?.keywords);
  }
  return parts.filter(Boolean).join(' ');
}

function buildNavigatorRows() {
  const query = state.navigatorQuery.trim().toLocaleLowerCase('zh-CN');
  const filtering = Boolean(query);
  const rows = [];
  
  const items = Array.from(state.items.values()).sort((a, b) => (a.z || 0) - (b.z || 0) || a.id.localeCompare(b.id));
  const groups = Array.from(state.groups.values());
  const navigatorOrder = (entry, fallback) =>
    Number.isFinite(Number(entry.navigatorOrder)) ? Number(entry.navigatorOrder) : fallback;
  const orderedChildren = (sectionId, parentGroupId) => {
    const childGroups = groups
      .filter((group) => (group.sectionId || null) === sectionId && (group.parentGroupId || null) === parentGroupId)
      .map((entry, index) => ({ type: 'group', entry, fallback: index }));
    const childItems = items
      .filter((item) => (item.sectionId || null) === sectionId && (item.groupId || null) === parentGroupId)
      .map((entry, index) => ({ type: 'item', entry, fallback: childGroups.length + index }));
    return [...childGroups, ...childItems].sort(
      (a, b) =>
        navigatorOrder(a.entry, a.fallback) - navigatorOrder(b.entry, b.fallback) ||
        a.entry.id.localeCompare(b.entry.id)
    );
  };
  const addGroup = (group, depth, parentKey, sortOrder) => {
    const key = `group:${group.id}`;
    const expanded = filtering || state.navigatorExpanded.has(key);
    rows.push({
      type: 'group',
      id: group.id,
      label: group.name,
      searchText: `${group.name} 分组`,
      depth,
      expanded,
      hasChildren: true,
      hidden: group.hidden,
      locked: group.locked,
      canReorder: !filtering && !group.locked,
      parentKey,
      sortOrder
    });
    if (!expanded) return;
    addScope(group.sectionId || null, depth + 1, group.id, key);
  };
  const addScope = (
    sectionId,
    depth,
    parentGroupId = null,
    parentKey = sectionId ? `section:${sectionId}` : 'root:unframed'
  ) => {
    for (const child of orderedChildren(sectionId, parentGroupId)) {
      const sortOrder = navigatorOrder(child.entry, child.fallback);
      if (child.type === 'group') addGroup(child.entry, depth, parentKey, sortOrder);
      else {
        const label = itemNavigatorLabel(child.entry);
        rows.push({
          type: 'item',
          id: child.entry.id,
          label,
          icon: itemNavigatorIcon(child.entry),
          searchText: itemNavigatorSearchText(child.entry),
          depth,
          hidden: child.entry.hidden,
          locked: !canMutateItem(child.entry),
          canReorder: !filtering && canMutateItem(child.entry),
          parentKey,
          sortOrder
        });
      }
    }
  };
  const sections = Array.from(state.sections.values()).sort(
    (a, b) => navigatorOrder(a, a.order) - navigatorOrder(b, b.order) || a.id.localeCompare(b.id)
  );
  for (const [index, section] of sections.entries()) {
    const key = `section:${section.id}`;
    const expanded = filtering || state.navigatorExpanded.has(key);
    rows.push({
      type: 'section',
      id: section.id,
      label: section.name,
      searchText: `${section.name} 画框`,
      depth: 0,
      expanded,
      hasChildren: true,
      hidden: section.hidden,
      locked: section.locked || section.lockChildren,
      canReorder: !filtering && !section.locked,
      parentKey: 'navigator-root',
      sortOrder: navigatorOrder(section, index)
    });
    if (expanded) addScope(section.id, 1);
  }
  if (groups.some((group) => !group.sectionId) || items.some((item) => !item.sectionId)) {
    const expanded = filtering || state.navigatorExpanded.has('root:unframed');
    rows.push({
      type: 'root',
      id: 'unframed',
      label: '未归入画框',
      searchText: '未归入画框',
      depth: 0,
      expanded,
      hasChildren: true,
      canReorder: false,
      parentKey: 'navigator-root'
    });
    if (expanded) addScope(null, 1);
  }
  if (filtering) {
    const byKey = new Map(rows.map((row) => [`${row.type}:${row.id}`, row]));
    const included = new Set();
    for (const row of rows) {
      if (!(row.searchText || row.label || '').toLocaleLowerCase('zh-CN').includes(query)) continue;
      let key = `${row.type}:${row.id}`;
      while (key && key !== 'navigator-root' && !included.has(key)) {
        included.add(key);
        key = byKey.get(key)?.parentKey;
      }
    }
    return rows.filter((row) => included.has(`${row.type}:${row.id}`));
  }
  return rows;
}
export {
  itemNavigatorLabel,
  itemNavigatorIcon,
  createNavigatorTypeIcon,
  itemNavigatorTypeLabel,
  itemNavigatorSearchText,
  buildNavigatorRows
};

