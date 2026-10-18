'use strict';

// A membership epoch has one fixed history boundary, including on leave/rejoin.
function chatHistoryStart(db, boardId, userId) {
  if (!db.prepare('SELECT 1 FROM canvas_chats WHERE board_id=?').get(boardId)) return 0;
  const membership = db.prepare(`SELECT m.group_id,max(m.joined_at,owner.joined_at) AS joined_at FROM share_members m
    JOIN canvas_catalog c ON c.board_id=? AND c.visibility='shared' AND c.owner_user_id<>m.user_id
    JOIN share_members owner ON owner.user_id=c.owner_user_id AND owner.group_id=m.group_id
    WHERE m.user_id=?`).get(boardId,userId);
  if (!membership) return 0;
  const stored = db.prepare('SELECT * FROM chat_member_history WHERE board_id=? AND user_id=?').get(boardId,userId);
  if (stored?.group_id===membership.group_id && stored.joined_at===membership.joined_at) return stored.first_sequence;
  const oldest = db.prepare(`SELECT min(sequence) AS first FROM
    (SELECT sequence FROM chat_messages WHERE board_id=? AND sent_at<=? ORDER BY sequence DESC LIMIT 30)`)
    .get(boardId,membership.joined_at).first;
  const first = oldest ?? ((db.prepare('SELECT max(sequence) AS last FROM chat_messages WHERE board_id=? AND sent_at<=?')
    .get(boardId,membership.joined_at).last || 0)+1);
  db.prepare(`INSERT INTO chat_member_history VALUES (?,?,?,?,?) ON CONFLICT(board_id,user_id)
    DO UPDATE SET group_id=excluded.group_id,joined_at=excluded.joined_at,first_sequence=excluded.first_sequence`)
    .run(boardId,userId,membership.group_id,membership.joined_at,first);
  return first;
}

function initializeJoinedChatHistory(db, userId) {
  // Accounts can also be used without the chat schema (standalone tools/tests).
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='chat_member_history'").get()) return;
  for (const row of db.prepare(`SELECT ch.board_id FROM canvas_chats ch JOIN canvas_catalog c ON c.board_id=ch.board_id
    JOIN share_members owner ON owner.user_id=c.owner_user_id
    JOIN share_members member ON member.group_id=owner.group_id AND member.user_id=?
    WHERE c.visibility='shared' AND c.owner_user_id<>?`).all(userId,userId)) chatHistoryStart(db,row.board_id,userId);
}

module.exports = {chatHistoryStart,initializeJoinedChatHistory};
