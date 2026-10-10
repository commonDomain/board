'use strict';
const crypto = require('node:crypto');
const { sha256, randomCrockford, grouped, normalizeInviteCode, httpError } = require('./account-helpers');

function groupForUser(account, userId) {
  return (
    account.database
      .prepare(
        `
      SELECT g.id, g.owner_user_id, g.invite_code_hash
      FROM share_members AS m JOIN share_groups AS g ON g.id = m.group_id
      WHERE m.user_id = ?
    `
      )
      .get(userId) || null
  );
}

function getSharing(account, userId) {
  if (!account.sharingEnabled)
    return { groupId: null, isOwner: false, hasInviteCode: false, members: [account.publicUser(userId)] };
  const group = account.groupForUser(userId);
  if (!group) return { groupId: null, isOwner: false, hasInviteCode: false, members: [account.publicUser(userId)] };
  const members = account.database
    .prepare(
      `
      SELECT u.id FROM share_members AS m JOIN user_accounts AS u ON u.id = m.user_id
      WHERE m.group_id = ? ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, m.joined_at, u.id
    `
    )
    .all(group.id, group.owner_user_id)
    .map((row) => account.publicUser(row.id));
  return {
    groupId: group.id,
    ownerUserId: group.owner_user_id,
    isOwner: group.owner_user_id === userId,
    hasInviteCode: Boolean(group.invite_code_hash),
    members
  };
}

function regenerateInviteCode(account, userId) {
  let group = account.groupForUser(userId);
  const now = Date.now();
  account.database.exec('BEGIN IMMEDIATE');
  try {
    if (!group) {
      const groupId = crypto.randomUUID();
      account.database
        .prepare(
          `
          INSERT INTO share_groups (id, owner_user_id, invite_code_hash, created_at, updated_at)
          VALUES (?, ?, NULL, ?, ?)
        `
        )
        .run(groupId, userId, now, now);
      account.database
        .prepare('INSERT INTO share_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
        .run(groupId, userId, now);
      group = { id: groupId, owner_user_id: userId };
    }
    if (group.owner_user_id !== userId) throw httpError(403, '只有共享所有者可以生成共享码', 'SHARING_OWNER_REQUIRED');
    const compact = randomCrockford(12);
    const inviteCode = grouped(compact);
    account.database
      .prepare('UPDATE share_groups SET invite_code_hash = ?, updated_at = ? WHERE id = ?')
      .run(sha256(compact), now, group.id);
    account.database.exec('COMMIT');
    return { inviteCode, sharing: account.getSharing(userId) };
  } catch (error) {
    try {
      account.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

function joinGroup(account, userId, codeInput) {
  if (account.groupForUser(userId)) throw httpError(409, '当前账号已经加入共享组', 'ALREADY_IN_SHARING_GROUP');
  const compact = normalizeInviteCode(codeInput);
  if (compact.length !== 12) throw httpError(400, '共享码格式不正确', 'INVALID_INVITE_CODE');
  const group = account.database.prepare('SELECT * FROM share_groups WHERE invite_code_hash = ?').get(sha256(compact));
  if (!group) throw httpError(400, '共享码无效或已经重新生成', 'INVALID_INVITE_CODE');
  account.database.exec('BEGIN IMMEDIATE');
  try {
    const count = Number(
      account.database.prepare('SELECT COUNT(*) AS count FROM share_members WHERE group_id = ?').get(group.id).count
    );
    if (count >= account.sharingMaxMembers) {
      throw httpError(409, `该共享组已经达到 ${account.sharingMaxMembers} 人上限`, 'SHARING_GROUP_FULL');
    }
    account.database
      .prepare('INSERT INTO share_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
      .run(group.id, userId, Date.now());
    account.database.exec('COMMIT');
  } catch (error) {
    try {
      account.database.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return account.getSharing(userId);
}

function removeMember(account, ownerUserId, targetUserId) {
  const group = account.groupForUser(ownerUserId);
  if (!group || group.owner_user_id !== ownerUserId)
    throw httpError(403, '只有共享所有者可以移除成员', 'SHARING_OWNER_REQUIRED');
  if (targetUserId === ownerUserId) throw httpError(400, '共享所有者不能移除自己', 'CANNOT_REMOVE_OWNER');
  const member = account.database
    .prepare('SELECT 1 FROM share_members WHERE group_id = ? AND user_id = ?')
    .get(group.id, targetUserId);
  if (!member) throw httpError(404, '共享成员不存在', 'SHARING_MEMBER_NOT_FOUND');
  account.database.prepare('DELETE FROM share_members WHERE group_id = ? AND user_id = ?').run(group.id, targetUserId);
  return { removedUserId: targetUserId, sharing: account.getSharing(ownerUserId) };
}

function leaveGroup(account, userId) {
  const group = account.groupForUser(userId);
  if (!group) throw httpError(409, '当前账号没有加入共享组', 'NOT_IN_SHARING_GROUP');
  if (group.owner_user_id === userId) {
    const count = Number(
      account.database.prepare('SELECT COUNT(*) AS count FROM share_members WHERE group_id = ?').get(group.id).count
    );
    if (count > 1) throw httpError(409, '请先移除其他成员后再结束共享', 'OWNER_MUST_REMOVE_MEMBERS');
    account.database.prepare('DELETE FROM share_groups WHERE id = ?').run(group.id);
  } else {
    account.database.prepare('DELETE FROM share_members WHERE group_id = ? AND user_id = ?').run(group.id, userId);
  }
  return account.getSharing(userId);
}

function visibleOwnerIds(account, userId) {
  if (!account.sharingEnabled) return [userId];
  const group = account.groupForUser(userId);
  if (!group) return [userId];
  return account.database
    .prepare('SELECT user_id FROM share_members WHERE group_id = ?')
    .all(group.id)
    .map((row) => row.user_id);
}

function canAccessBoard(account, userId, boardId) {
  const row = account.database
    .prepare('SELECT owner_user_id, visibility FROM canvas_catalog WHERE board_id = ?')
    .get(boardId);
  if (!account.sharingEnabled) return Boolean(row && row.owner_user_id === userId);
  if (!row?.owner_user_id) return false;
  if (row.owner_user_id === userId) return true;
  return row.visibility === 'shared' && account.visibleOwnerIds(userId).includes(row.owner_user_id);
}

function canReferenceAsset(account, userId, assetId) {
  if (!userId) return true;
  const grant = account.database
    .prepare(
      `
      SELECT 1 FROM asset_upload_grants
      WHERE asset_id = ? AND user_id = ? AND expires_at > ?
    `
    )
    .get(assetId, userId, Date.now());
  if (grant) return true;
  const references = account.database
    .prepare(
      `
      SELECT owner_id FROM asset_references WHERE owner_type = 'board' AND asset_id = ?
    `
    )
    .all(assetId);
  return references.some((reference) => account.canAccessBoard(userId, reference.owner_id));
}

function canManageBoard(account, userId, boardId) {
  return Boolean(
    account.database
      .prepare('SELECT 1 FROM canvas_catalog WHERE board_id = ? AND owner_user_id = ?')
      .get(boardId, userId)
  );
}
module.exports = {
  groupForUser,
  getSharing,
  regenerateInviteCode,
  joinGroup,
  removeMember,
  leaveGroup,
  visibleOwnerIds,
  canAccessBoard,
  canReferenceAsset,
  canManageBoard
};
