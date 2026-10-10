'use strict';
const {
  providerConfig,
  XMindError,
  normalizeSyncCapabilities,
  buildStructuredPatch,
  treeNodeMap
} = require('./xmind-document');

function registerLink(service, { boardId, itemId, userId, remoteMapId, remoteName, hash, tree, relations = [] }) {
  const existing = service.database
    .prepare('SELECT user_id, remote_map_id FROM xmind_board_links WHERE board_id=? AND item_id=?')
    .get(boardId, itemId);
  if (existing && (existing.user_id !== userId || existing.remote_map_id !== remoteMapId))
    throw new XMindError('XMind 连接来源不可更改', { code: 'XMIND_LINK_IMMUTABLE', statusCode: 403 });
  const connection = service.database.prepare('SELECT provider FROM xmind_connections WHERE user_id=?').get(userId);
  const provider = providerConfig(connection?.provider || 'global').id;
  const duplicate = service.database
    .prepare('SELECT item_id FROM xmind_board_links WHERE board_id=? AND provider=? AND remote_map_id=? AND item_id<>?')
    .get(boardId, provider, remoteMapId, itemId);
  if (duplicate)
    throw new XMindError('当前画布已连接该 XMind 脑图', {
      code: 'XMIND_MAP_ALREADY_LINKED',
      statusCode: 409,
      details: { itemId: duplicate.item_id }
    });
  service.database
    .prepare(
      `INSERT INTO xmind_board_links (board_id,item_id,user_id,provider,remote_map_id,remote_name,remote_hash,baseline_tree_json,baseline_relations_json,synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(board_id,item_id) DO NOTHING`
    )
    .run(
      boardId,
      itemId,
      userId,
      provider,
      remoteMapId,
      String(remoteName || '').slice(0, 200),
      hash,
      JSON.stringify(tree),
      JSON.stringify(relations || []),
      Date.now()
    );
}

function link(service, boardId, itemId) {
  return service.database
    .prepare('SELECT * FROM xmind_board_links WHERE board_id=? AND item_id=?')
    .get(boardId, itemId);
}

async function checkRemoteChanges(service, userId, boardId, itemIds = [], options = {}) {
  const requested = new Set((Array.isArray(itemIds) ? itemIds : []).map(String).slice(0, 50));
  const rows = service.database
    .prepare('SELECT * FROM xmind_board_links WHERE board_id=? AND user_id=? ORDER BY item_id')
    .all(boardId, userId)
    .filter((row) => !requested.size || requested.has(row.item_id));
  const remoteResults = new Map();
  const changes = [];
  for (const row of rows) {
    const cacheKey = `${userId}:${row.provider}:${row.remote_map_id}`;
    let remote = remoteResults.get(cacheKey);
    const cached = service.remoteCheckCache.get(cacheKey);
    if (!remote && !options.force && cached?.expiresAt > Date.now()) remote = cached.value;
    if (!remote) {
      remote = await service.readMap(userId, row.remote_map_id);
      service.remoteCheckCache.set(cacheKey, { value: remote, expiresAt: Date.now() + 20_000 });
    }
    remoteResults.set(cacheKey, remote);
    const expectedHash = row.pending_remote_hash || row.remote_hash;
    if (remote.hash !== expectedHash)
      changes.push({ itemId: row.item_id, remoteHash: remote.hash, remoteName: row.remote_name });
  }
  return { checked: rows.length, changes };
}

async function withLinkMutation(service, boardId, itemId, callback) {
  const key = `${boardId}:${itemId}`;
  const previous = service.linkMutationTails.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => current);
  service.linkMutationTails.set(key, tail);
  await previous.catch(() => {});
  try {
    return await callback();
  } finally {
    release();
    if (service.linkMutationTails.get(key) === tail) service.linkMutationTails.delete(key);
  }
}

function stageLinkState(service, boardId, itemId, hash, tree, relations = [], syncedAt = Date.now()) {
  if (typeof relations === 'number') {
    syncedAt = relations;
    relations = [];
  }
  service.database
    .prepare(
      `UPDATE xmind_board_links
      SET pending_remote_hash=?, pending_tree_json=?, pending_relations_json=?, pending_synced_at=?
      WHERE board_id=? AND item_id=?`
    )
    .run(hash, JSON.stringify(tree), JSON.stringify(relations || []), syncedAt, boardId, itemId);
  return { hash, syncedAt };
}

function stagedLinkMatches(service, boardId, itemId, tree, relations, sourceHash, capabilities = {}) {
  const link = service.link(boardId, itemId);
  if (!link?.pending_remote_hash || sourceHash !== link.pending_remote_hash) return false;
  let pendingTree;
  let pendingRelations;
  try {
    pendingTree = JSON.parse(link.pending_tree_json);
    pendingRelations = JSON.parse(link.pending_relations_json || '[]');
  } catch {
    return false;
  }
  return buildStructuredPatch(pendingTree, tree, pendingRelations, relations || [], capabilities).length === 0;
}

function commitStagedLink(service, boardId, itemId, tree, relations, sourceHash, capabilities = {}) {
  if (typeof relations === 'string' && sourceHash === undefined) {
    sourceHash = relations;
    relations = [];
  }
  const link = service.link(boardId, itemId);
  if (!link || !service.stagedLinkMatches(boardId, itemId, tree, relations, sourceHash, capabilities)) return false;
  service.database
    .prepare(
      `UPDATE xmind_board_links
      SET remote_hash=pending_remote_hash, baseline_tree_json=pending_tree_json,
          baseline_relations_json=COALESCE(pending_relations_json, '[]'),
          synced_at=COALESCE(pending_synced_at, synced_at),
          pending_remote_hash=NULL, pending_tree_json=NULL, pending_relations_json=NULL, pending_synced_at=NULL
      WHERE board_id=? AND item_id=?`
    )
    .run(boardId, itemId);
  return true;
}

function assertCanMutate(service, userId, boardId, itemId) {
  const link = service.link(boardId, itemId);
  if (link && link.user_id !== userId)
    throw new XMindError('该 XMind 脑图由其他共享成员连接，只能查看', {
      code: 'XMIND_LINK_READ_ONLY',
      statusCode: 403
    });
  if (link) {
    const connection = service.database
      .prepare('SELECT provider, status FROM xmind_connections WHERE user_id=?')
      .get(userId);
    if (
      !connection ||
      connection.status !== 'connected' ||
      String(connection.provider || 'global') !== String(link.provider || 'global')
    ) {
      throw new XMindError('当前授权站点与此脑图不一致，请切回原站点授权或解除连接', {
        code: 'XMIND_LINK_PROVIDER_MISMATCH',
        statusCode: 409
      });
    }
  }
  return link;
}

function syncSummary(service, userId, boardId, itemId, tree, relations = []) {
  const link = service.assertCanMutate(userId, boardId, itemId);
  if (!link) throw new XMindError('XMind 连接不存在', { code: 'XMIND_LINK_NOT_FOUND', statusCode: 404 });
  let baseline;
  try {
    baseline = JSON.parse(link.baseline_tree_json);
  } catch {
    baseline = null;
  }
  const capabilities = normalizeSyncCapabilities(service.syncCapabilityCache.get(userId));
  const before = treeNodeMap(baseline, capabilities);
  const after = treeNodeMap(tree, capabilities);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, value] of after) {
    if (!before.has(id)) added += 1;
    else if (before.get(id) !== value) changed += 1;
  }
  for (const id of before.keys()) if (!after.has(id)) removed += 1;
  let baselineRelations = [];
  try {
    baselineRelations = JSON.parse(link.baseline_relations_json || '[]');
  } catch {}
  const operations = buildStructuredPatch(baseline, tree, baselineRelations, relations, capabilities);
  return {
    added,
    removed,
    changed,
    total: after.size,
    styleChanges: operations.filter((operation) => operation.op === 'set-topic-style').length,
    relationChanges: operations.filter((operation) => /relationship$/.test(operation.op)).length,
    moves: operations.filter((operation) => operation.op === 'move-topic').length,
    syncMode: 'structured-patch'
  };
}
module.exports = {
  registerLink,
  link,
  checkRemoteChanges,
  withLinkMutation,
  stageLinkState,
  stagedLinkMatches,
  commitStagedLink,
  assertCanMutate,
  syncSummary
};
