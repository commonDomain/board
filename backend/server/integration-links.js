import { XMindError } from '../xmind-service.js';
import { getBoard } from './board-cache.js';
import {AMAP_ITEM_TYPES} from './item-schema.js';
import {AMAP_MAX_NAV_ITEMS_PER_USER} from './amap-config.js';
import { xmindDetachGrants } from './integration-state.js';
import { ProtocolError } from './protocol-error.js';
import { servicesRuntime } from './runtime/services.js';

function prepareAmapItems(previousState, draft, userId) {
  const previousById = new Map(
    previousState.items.filter((item) => AMAP_ITEM_TYPES.has(item.type)).map((item) => [item.id, item])
  );
  const seenTypes = new Set();
  for (const item of draft.items) {
    if (!AMAP_ITEM_TYPES.has(item.type)) continue;
    if (!userId) {
      throw new ProtocolError('AMAP_AUTH_REQUIRED', '登录后才能创建或修改导航组件。');
    }
    if (seenTypes.has(item.type)) {
      throw new ProtocolError('AMAP_CANVAS_ITEM_LIMIT', '每个画布每类只能放置一个导航组件。');
    }
    seenTypes.add(item.type);
    const previous = previousById.get(item.id);
    item.createdByUserId = previous?.createdByUserId || userId;
  }
}

function syncAmapComponentRegistry(boardId, previousState, draft) {
  const previous = new Map(
    previousState.items.filter((item) => AMAP_ITEM_TYPES.has(item.type)).map((item) => [item.id, item])
  );
  const next = new Map(draft.items.filter((item) => AMAP_ITEM_TYPES.has(item.type)).map((item) => [item.id, item]));
  for (const item of previous.values()) {
    if (!next.has(item.id) || next.get(item.id).type !== item.type) {
      servicesRuntime.database
        .prepare('DELETE FROM amap_component_registry WHERE board_id = ? AND item_id = ?')
        .run(boardId, item.id);
    }
  }
  for (const item of next.values()) {
    const old = previous.get(item.id);
    if (old?.type === item.type && old.createdByUserId === item.createdByUserId) continue;
    if (old) {
      servicesRuntime.database
        .prepare('DELETE FROM amap_component_registry WHERE board_id = ? AND item_id = ?')
        .run(boardId, item.id);
    }
    const count = Number(
      servicesRuntime.database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM amap_component_registry
      WHERE creator_user_id = ? AND component_type = ?
    `
        )
        .get(item.createdByUserId, item.type).count
    );
    if (count >= AMAP_MAX_NAV_ITEMS_PER_USER) {
      throw new ProtocolError(
        'AMAP_ACCOUNT_ITEM_LIMIT',
        `每个账号最多可创建 ${AMAP_MAX_NAV_ITEMS_PER_USER} 个同类导航组件。`
      );
    }
    servicesRuntime.database
      .prepare(
        `
      INSERT INTO amap_component_registry (board_id, item_id, component_type, creator_user_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(boardId, item.id, item.type, item.createdByUserId, Date.now());
  }
}

function prepareXmindItems(boardId, previousState, draft, userId) {
  const previous = new Map(previousState.items.map((item) => [item.id, item]));
  const next = new Map(draft.items.map((item) => [item.id, item]));
  const links = servicesRuntime.database.prepare('SELECT * FROM xmind_board_links WHERE board_id = ?').all(boardId);
  for (const link of links) {
    const before = previous.get(link.item_id);
    const after = next.get(link.item_id);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    const grantKey = `${userId || ''}:${boardId}:${link.item_id}`;
    const grantExpiry = Number(xmindDetachGrants.get(grantKey));
    if (grantExpiry && grantExpiry <= Date.now()) xmindDetachGrants.delete(grantKey);
    const detachGranted = after && after.source?.provider !== 'xmind' && grantExpiry > Date.now();
    if (changed && (!servicesRuntime.xmindService.enabled || link.user_id !== userId)) {
      throw new ProtocolError('XMIND_LINK_READ_ONLY', '该 XMind 脑图由其他共享成员连接，只能查看。');
    }
    if (changed && link.user_id === userId && !detachGranted) {
      const connected = servicesRuntime.database
        .prepare("SELECT 1 FROM xmind_connections WHERE user_id = ? AND status = 'connected'")
        .get(userId);
      if (!connected) throw new ProtocolError('XMIND_REAUTH_REQUIRED', 'XMind 授权已失效，请重新授权后继续编辑。');
    }
    if (after) {
      if (after.type !== 'mindmap' || (after.source?.provider !== 'xmind' && !detachGranted))
        throw new ProtocolError('XMIND_LINK_IMMUTABLE', '不能移除或替换 XMind 连接来源。');
      if (detachGranted) continue;
      after.source.connectedUserId = link.user_id;
      after.source.remoteMapId = link.remote_map_id;
      after.source.remoteName = link.remote_name;
      const syncCapabilities = {
        note: !after.source.localOnlyFields.includes('note'),
        status: !after.source.localOnlyFields.includes('status')
      };
      const matchesPendingTree = servicesRuntime.xmindService.stagedLinkMatches(
        boardId,
        link.item_id,
        after.tree,
        after.relations || [],
        after.source.remoteHash,
        syncCapabilities
      );
      after.source.remoteHash = matchesPendingTree ? link.pending_remote_hash : link.remote_hash;
    }
  }
  for (const item of draft.items) {
    if (item.type !== 'mindmap' || item.source?.provider !== 'xmind' || previous.has(item.id)) continue;
    if (!servicesRuntime.xmindService.enabled || !userId || item.source.connectedUserId !== userId)
      throw new ProtocolError('XMIND_AUTH_REQUIRED', '只有已授权账号可以连接 XMind 脑图。');
    const connection = servicesRuntime.database
      .prepare("SELECT 1 FROM xmind_connections WHERE user_id = ? AND status = 'connected'")
      .get(userId);
    if (!connection) throw new ProtocolError('XMIND_REAUTH_REQUIRED', '请先连接或重新授权 XMind。');
  }
}

function syncXmindLinkRegistry(boardId, previousState, draft, userId) {
  const previous = new Map(previousState.items.map((item) => [item.id, item]));
  const next = new Map(draft.items.map((item) => [item.id, item]));
  for (const item of previous.values()) {
    const nextItem = next.get(item.id);
    if (item.source?.provider === 'xmind' && (!nextItem || nextItem.source?.provider !== 'xmind')) {
      servicesRuntime.database
        .prepare('DELETE FROM xmind_board_links WHERE board_id = ? AND item_id = ?')
        .run(boardId, item.id);
    }
  }
  for (const item of next.values()) {
    if (item.source?.provider !== 'xmind') continue;
    const existingLink = servicesRuntime.xmindService.link(boardId, item.id);
    if (existingLink) {
      const syncCapabilities = {
        note: !item.source.localOnlyFields.includes('note'),
        status: !item.source.localOnlyFields.includes('status')
      };
      servicesRuntime.xmindService.commitStagedLink(
        boardId,
        item.id,
        item.tree,
        item.relations || [],
        item.source.remoteHash,
        syncCapabilities
      );
    } else {
      const connection = servicesRuntime.database
        .prepare('SELECT provider, status FROM xmind_connections WHERE user_id = ?')
        .get(userId);
      if (!connection || connection.status !== 'connected')
        throw new ProtocolError('XMIND_REAUTH_REQUIRED', '请先连接或重新授权 XMind。');
      if (item.source.connectedUserId !== userId)
        throw new ProtocolError('XMIND_LINK_READ_ONLY', '该 XMind 脑图由其他共享成员连接，只能查看。');
      if (String(item.source.accountProvider || 'global') !== String(connection.provider || 'global')) {
        throw new ProtocolError(
          'XMIND_LINK_PROVIDER_MISMATCH',
          '当前授权站点与此脑图不一致，请切回原站点授权或解除连接。'
        );
      }
      servicesRuntime.xmindService.registerLink({
        boardId,
        itemId: item.id,
        userId,
        remoteMapId: item.source.remoteMapId,
        remoteName: item.source.remoteName,
        hash: item.source.remoteHash,
        tree: item.tree,
        relations: item.relations || []
      });
    }
  }
}

function ensureXmindBoardLink(boardId, itemId, userId) {
  const existing = servicesRuntime.xmindService.assertCanMutate(userId, boardId, itemId);
  if (existing) return { link: existing, item: null };
  const board = getBoard(boardId);
  const item = board.state.items.find((entry) => entry.id === itemId && entry.type === 'mindmap');
  if (!item || item.source?.provider !== 'xmind') {
    throw new XMindError('连接脑图不存在', { code: 'XMIND_LINK_NOT_FOUND', statusCode: 404 });
  }
  if (item.source.connectedUserId !== userId) {
    throw new XMindError('该 XMind 脑图由其他共享成员连接，只能查看', {
      code: 'XMIND_LINK_READ_ONLY',
      statusCode: 403
    });
  }
  const connection = servicesRuntime.database
    .prepare('SELECT provider, status FROM xmind_connections WHERE user_id = ?')
    .get(userId);
  if (!connection || connection.status !== 'connected') {
    throw new XMindError('XMind 授权已失效，请重新授权后继续编辑', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
  }
  if (String(item.source.accountProvider || 'global') !== String(connection.provider || 'global')) {
    throw new XMindError('当前授权站点与此脑图不一致，请切回原站点授权或解除连接', {
      code: 'XMIND_LINK_PROVIDER_MISMATCH',
      statusCode: 409
    });
  }
  servicesRuntime.xmindService.registerLink({
    boardId,
    itemId,
    userId,
    remoteMapId: item.source.remoteMapId,
    remoteName: item.source.remoteName,
    hash: item.source.remoteHash,
    tree: item.tree,
    relations: item.relations || []
  });
  return { link: servicesRuntime.xmindService.assertCanMutate(userId, boardId, itemId), item };
}

function rebuildAmapComponentRegistry() {
  servicesRuntime.database.exec('BEGIN IMMEDIATE');
  try {
    servicesRuntime.database.prepare('DELETE FROM amap_component_registry').run();
    const insert = servicesRuntime.database.prepare(`
      INSERT OR IGNORE INTO amap_component_registry (board_id, item_id, component_type, creator_user_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of servicesRuntime.database.prepare('SELECT id, state_json, updated_at FROM boards').all()) {
      let state;
      try {
        state = JSON.parse(row.state_json);
      } catch {
        continue;
      }
      const seen = new Set();
      for (const item of state.items || []) {
        if (!AMAP_ITEM_TYPES.has(item?.type) || seen.has(item.type)) continue;
        seen.add(item.type);
        insert.run(row.id, item.id, item.type, item.createdByUserId || null, Number(row.updated_at) || Date.now());
      }
    }
    servicesRuntime.database.exec('COMMIT');
  } catch (error) {
    try {
      servicesRuntime.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

export {
  ensureXmindBoardLink,
  prepareAmapItems,
  prepareXmindItems,
  rebuildAmapComponentRegistry,
  syncAmapComponentRegistry,
  syncXmindLinkRegistry
};

