import { chatStatement } from './chat-statements.js';
import chatHistory from '../chat-history.js';
import { CHAT_REACTION_CHOICES,LEGACY_CHAT_REACTIONS } from '../../public/app/chat-reactions-model.js';

export const CHAT_REACTIONS = CHAT_REACTION_CHOICES.map(value=>value.id);
const fail=(statusCode,message,code='CHAT_INVALID')=>{throw Object.assign(new Error(message),{statusCode,code});};
export function ensureChatFeaturesSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS chat_mentions (
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    start INTEGER NOT NULL,end INTEGER NOT NULL,PRIMARY KEY(message_id,start)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS chat_mentions_user ON chat_mentions(user_id,message_id);
  CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,PRIMARY KEY(message_id,user_id,emoji)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS chat_announcements (
    board_id TEXT PRIMARY KEY REFERENCES canvas_chats(board_id) ON DELETE CASCADE,
    text TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,user_id TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS chat_preferences (
    board_id TEXT NOT NULL REFERENCES canvas_chats(board_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    notification_mode TEXT NOT NULL CHECK(notification_mode IN ('all','mentions','none')),
    PRIMARY KEY(board_id,user_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS chat_board_sender_sequence ON chat_messages(board_id,sender_id,sequence);`);
}
export function chatMemberIds(db,boardId){
  return chatStatement(db,`SELECT u.id FROM canvas_catalog c JOIN user_accounts u ON u.id=c.owner_user_id WHERE c.board_id=?
    UNION SELECT member.user_id AS id FROM canvas_catalog c JOIN share_members owner ON owner.user_id=c.owner_user_id
    JOIN share_members member ON member.group_id=owner.group_id WHERE c.board_id=? AND c.visibility='shared'`)
    .all(boardId,boardId).map(row=>row.id);
}
export function normalizeChatMentions(db,boardId,text,input){
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>20)fail(400,'每条消息最多提及 20 次');
  const roster=new Set(chatMemberIds(db,boardId)),result=[];let end=0;
  for(const value of input){
    if(!value||typeof value.userId!=='string'||!roster.has(value.userId)||!Number.isSafeInteger(value.start)||!Number.isSafeInteger(value.end)||value.start<end||value.end<=value.start||value.end>text.length||value.end-value.start>160||text[value.start]!=='@')fail(400,'提及的成员或文字位置已失效，请重新选择成员');
    const username=chatStatement(db,'SELECT username FROM user_accounts WHERE id=?').get(value.userId)?.username;
    if(text.slice(value.start,value.end)!==`@${username}`)fail(400,'成员名称已更新，请重新选择成员');
    result.push({userId:value.userId,start:value.start,end:value.end});end=value.end;
  }
  return result;
}
export function visibleChatMessage(db,boardId,userId,id){
  const row=chatStatement(db,`SELECT m.* FROM chat_messages m WHERE m.id=? AND m.board_id=? AND m.sequence>=?
    AND m.withdrawn_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`)
    .get(id,boardId,chatHistory.chatHistoryStart(db,boardId,userId),userId);
  if(!row)fail(404,'消息已不可用');return row;
}
export function chatFilters(params,userId){
  const clauses=[],values=[];
  const sender=params.get('sender'),media=params.get('media');
  if(sender){if(!/^[\w-]{1,128}$/.test(sender))fail(400,'发送成员无效');clauses.push('m.sender_id=?');values.push(sender);}
  if(media){if(!['image','video','attachment'].includes(media))fail(400,'附件类型无效');clauses.push(media==='image'?'m.image IS NOT NULL':media==='video'?"EXISTS(SELECT 1 FROM chat_videos fv WHERE fv.id=m.video_id AND fv.status='ready')":"(m.image IS NOT NULL OR EXISTS(SELECT 1 FROM chat_videos fv WHERE fv.id=m.video_id AND fv.status='ready'))");}
  for(const [key,operator] of [['from','>='],['to','<']])if(params.has(key)){
    const value=Number(params.get(key));if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)fail(400,'搜索日期无效');
    clauses.push(`m.sent_at${operator}?`);values.push(value);
  }
  if(params.has('from')&&params.has('to')&&Number(params.get('from'))>=Number(params.get('to')))fail(400,'结束日期不能早于开始日期');
  if(params.get('mentioned')==='1'){clauses.push('EXISTS(SELECT 1 FROM chat_mentions fm WHERE fm.message_id=m.id AND fm.user_id=?)');values.push(userId);}
  const active=clauses.length>0;if(active)clauses.unshift('m.withdrawn_at IS NULL');
  return {sql:clauses.length?` AND ${clauses.join(' AND ')}`:'',values,active};
}
export function decorateChatMessages(db,messages){
  const active=messages.filter(m=>!m.deleted&&!m.withdrawnAt);if(!active.length)return;
  // Fixed SQL shape, bounded IDs and two queries per batch; no per-message queries.
  const index=new Map(active.map(m=>[m.id,m]));
  const ids=JSON.stringify([...index.keys()]);
  for(const message of active){message.mentions=[];message.reactions=[];}
  for(const row of chatStatement(db,`SELECT t.* FROM json_each(?) j JOIN chat_mentions t ON t.message_id=j.value ORDER BY t.start`).all(ids))index.get(row.message_id)?.mentions.push({userId:row.user_id,start:row.start,end:row.end});
  const groups=new Map();
  for(const row of chatStatement(db,`SELECT t.* FROM json_each(?) j JOIN chat_reactions t ON t.message_id=j.value ORDER BY t.emoji,t.user_id`).all(ids)){
    if(!index.has(row.message_id))continue;const key=`${row.message_id}:${row.emoji}`;
    if(!groups.has(key)){const group={emoji:row.emoji,userIds:[]};groups.set(key,group);index.get(row.message_id).reactions.push(group);}groups.get(key).userIds.push(row.user_id);
  }
}
export function chatFeatureSummary(db,boardId){
  const ownerId=chatStatement(db,'SELECT owner_user_id FROM canvas_catalog WHERE board_id=?').get(boardId)?.owner_user_id;
  const row=chatStatement(db,'SELECT * FROM chat_announcements WHERE board_id=?').get(boardId);
  return {ownerId,announcement:row?{text:row.text,revision:row.revision,updatedAt:row.updated_at}: {text:'',revision:0,updatedAt:null}};
}
export function chatReactionState(db,boardId,id){
  const revision=chatStatement(db,'SELECT changed_revision FROM chat_messages WHERE board_id=? AND id=?').get(boardId,id)?.changed_revision;
  const groups=new Map();
  for(const row of chatStatement(db,'SELECT emoji,user_id FROM chat_reactions WHERE message_id=? ORDER BY emoji,user_id').all(id)){
    if(!groups.has(row.emoji))groups.set(row.emoji,{emoji:row.emoji,userIds:[]});
    groups.get(row.emoji).userIds.push(row.user_id);
  }
  return {id,changedRevision:revision,reactions:[...groups.values()]};
}
export function chatSenders(db,boardId,userId){
  return chatStatement(db,`SELECT DISTINCT m.sender_id AS id,COALESCE(u.username,'已离开的成员') AS username
    FROM chat_messages m LEFT JOIN user_accounts u ON u.id=m.sender_id WHERE m.board_id=? AND m.sequence>=? AND m.withdrawn_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?) ORDER BY username,id`)
    .all(boardId,chatHistory.chatHistoryStart(db,boardId,userId),userId);
}
export function mutateChatFeature(db,boardId,userId,action,id,input){
  const isOwner=chatStatement(db,'SELECT owner_user_id FROM canvas_catalog WHERE board_id=?').get(boardId)?.owner_user_id===userId;
  // Membership/history is resolved before the transaction; it may persist a boundary.
  if(action==='reaction')visibleChatMessage(db,boardId,userId,id);
  if(!chatStatement(db,'SELECT 1 FROM canvas_chats WHERE board_id=?').get(boardId))fail(409,'请先添加画布群聊');
  db.exec('BEGIN IMMEDIATE');try{
    let changed=false;
    if(action==='reaction'){
      if(typeof input?.active!=='boolean'||(!CHAT_REACTIONS.includes(input.emoji)&&(input.active||!LEGACY_CHAT_REACTIONS.includes(input.emoji))))fail(400,'表情回应无效');
      changed=Boolean(input.active?chatStatement(db,'INSERT OR IGNORE INTO chat_reactions VALUES (?,?,?)').run(id,userId,input.emoji).changes:chatStatement(db,'DELETE FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?').run(id,userId,input.emoji).changes);
    }else if(action==='announcement'){
      if(!isOwner)fail(403,'只有画布所有者可以编辑群公告');
      if(typeof input?.text!=='string'||input.text.length>2000||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0)fail(400,'公告内容或版本无效');
      const old=chatStatement(db,'SELECT text,revision FROM chat_announcements WHERE board_id=?').get(boardId);
      const text=input.text.trim();changed=text!==(old?.text||'');
      // Retrying a lost acknowledgement of the same content is a safe no-op.
      if(changed&&(old?.revision||0)!==input.baseRevision)fail(409,'公告已在其他窗口更新，请重新打开后编辑','CHAT_ANNOUNCEMENT_CONFLICT');
      if(changed)chatStatement(db,`INSERT INTO chat_announcements VALUES (?,?,?,?,?) ON CONFLICT(board_id) DO UPDATE SET text=excluded.text,revision=excluded.revision,updated_at=excluded.updated_at,user_id=excluded.user_id`).run(boardId,text,(old?.revision||0)+1,Date.now(),userId);
    }else if(action==='preferences'){
      if(!['all','mentions','none'].includes(input?.notificationMode))fail(400,'提醒设置无效');
      chatStatement(db,`INSERT INTO chat_preferences VALUES (?,?,?) ON CONFLICT(board_id,user_id) DO UPDATE SET notification_mode=excluded.notification_mode`).run(boardId,userId,input.notificationMode);
    }else fail(400,'聊天操作无效');
    if(changed){const revision=chatStatement(db,'UPDATE canvas_chats SET revision=revision+1 WHERE board_id=? RETURNING revision').get(boardId).revision;
      if(id)chatStatement(db,'UPDATE chat_messages SET changed_revision=? WHERE id=? AND board_id=?').run(revision,id,boardId);
    }
    db.exec('COMMIT');return changed;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
