import crypto from 'node:crypto';
import { ensurePushSchema, enqueueChatPush } from './push-store.js';
import { chatStatement } from './chat-statements.js';
import chatHistory from '../chat-history.js';
import { ensureChatVideoSchema,videoInfo } from './chat-video-model.js';
import { ensureChatFeaturesSchema,normalizeChatMentions,chatFilters,decorateChatMessages } from './chat-features.js';
const {chatHistoryStart}=chatHistory;
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode, code: 'CHAT_INVALID' }); };
const searchCounts=new WeakMap();
const CHAT_REEDIT_WINDOW_MS=2*60*1000;
function cachedSearchCount(db,boardId,revision,userId,query,firstSequence,filter){
  let cache=searchCounts.get(db);if(!cache){cache=new Map();searchCounts.set(db,cache);}
  const folded=query.toLowerCase(),key=JSON.stringify([boardId,revision,userId,folded,firstSequence,filter]);
  if(cache.has(key))return cache.get(key);
  const count=chatStatement(db,`SELECT count(*) AS n FROM chat_messages m WHERE m.board_id=? AND m.withdrawn_at IS NULL
    AND m.sequence>=? AND instr(m.search_text,?)>0 AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)${filter.sql}`).get(boardId,firstSequence,folded,userId,...filter.values).n;
  cache.set(key,count);while(cache.size>128)cache.delete(cache.keys().next().value);return count;
}

export function ensureChatSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_chats (
      board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS chat_messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE, board_id TEXT NOT NULL REFERENCES canvas_chats(board_id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL, text TEXT NOT NULL, image TEXT,
      reply_id TEXT, sent_at INTEGER NOT NULL, withdrawn_at INTEGER,
      changed_revision INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS chat_board_sequence ON chat_messages(board_id, sequence);
    CREATE INDEX IF NOT EXISTS chat_board_changes ON chat_messages(board_id, changed_revision);
    CREATE TABLE IF NOT EXISTS chat_reedit_drafts (
      message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
      text TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS chat_reedit_expiry ON chat_reedit_drafts(expires_at);
    CREATE TABLE IF NOT EXISTS chat_hidden_messages (
      message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
      PRIMARY KEY(message_id, user_id)
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS chat_asset_cleanup AFTER DELETE ON chat_messages BEGIN
      DELETE FROM asset_references WHERE owner_type='chat' AND owner_id=OLD.id;
    END;
  `);
  // Additive migrations also support canvases created before receipts/references.
  const chatColumns = db.prepare('PRAGMA table_info(canvas_chats)').all();
  if (!chatColumns.some(column => column.name === 'reset_revision')) db.exec('ALTER TABLE canvas_chats ADD COLUMN reset_revision INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(chat_messages)').all().some(column => column.name === 'element_ref')) db.exec('ALTER TABLE chat_messages ADD COLUMN element_ref TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS chat_read_positions (
    board_id TEXT NOT NULL REFERENCES canvas_chats(board_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(board_id,user_id)
  ) STRICT;`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_send_receipts (
    id TEXT PRIMARY KEY,board_id TEXT NOT NULL REFERENCES canvas_chats(board_id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS chat_receipts_age ON chat_send_receipts(created_at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_member_history (
    board_id TEXT NOT NULL REFERENCES canvas_chats(board_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,joined_at INTEGER NOT NULL,first_sequence INTEGER NOT NULL,
    PRIMARY KEY(board_id,user_id)
  ) STRICT;`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_upload_assets (
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,asset_id)
  ) STRICT;
  INSERT OR IGNORE INTO chat_upload_assets(user_id,asset_id,created_at)
    SELECT m.sender_id,substr(m.image,9,64),m.sent_at FROM chat_messages m JOIN assets a ON a.asset_id=substr(m.image,9,64)
    JOIN user_accounts u ON u.id=m.sender_id WHERE m.image IS NOT NULL;`);
  if(!db.prepare('PRAGMA table_info(chat_messages)').all().some(column=>column.name==='search_text')){
    db.exec("ALTER TABLE chat_messages ADD COLUMN search_text TEXT NOT NULL DEFAULT ''");
    const update=db.prepare('UPDATE chat_messages SET search_text=? WHERE id=?');
    transaction(db,()=>{for(const row of db.prepare('SELECT id,text FROM chat_messages').all())update.run(row.text.toLowerCase(),row.id);});
  }
  ensureChatVideoSchema(db);
  ensureChatFeaturesSchema(db);
  ensurePushSchema(db);
  // Correct temporary drafts created by versions that timed from withdrawal.
  db.prepare(`UPDATE chat_reedit_drafts SET expires_at=min(expires_at,
    (SELECT sent_at+? FROM chat_messages WHERE id=message_id))`).run(CHAT_REEDIT_WINDOW_MS);
  db.prepare('DELETE FROM chat_reedit_drafts WHERE expires_at<=?').run(Date.now());
}

export function createChat(db, boardId) {
  return Boolean(db.prepare('INSERT OR IGNORE INTO canvas_chats(board_id, created_at) VALUES (?, ?)').run(boardId, Date.now()).changes);
}

function nextRevision(db, boardId) {
  return db.prepare('UPDATE canvas_chats SET revision=revision+1 WHERE board_id=? RETURNING revision').get(boardId)?.revision
    ?? fail(409, '请先添加画布群聊');
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function sendChatMessage(db, boardId, userId, input) {
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  const image = input?.image || null;
  const videoId = input?.videoId || null;
  const id = input?.id;
  const reference = input?.reference || null;
  const mentions=input?.mentions ?? [];
  if(!Array.isArray(mentions)||mentions.length>20)fail(400,'提及成员无效');
  if (typeof id !== 'string' || !/^[\w-]{8,80}$/.test(id)) fail(400, '消息标识无效');
  if (input.replyId && (typeof input.replyId !== 'string' || !/^[\w-]{8,80}$/.test(input.replyId))) fail(400, '引用标识无效');
  if (reference && (typeof reference.itemId !== 'string' || !/^[\w.-]{1,128}$/.test(reference.itemId) ||
    typeof reference.label !== 'string' || reference.label.length > 120 || typeof reference.type !== 'string' ||
    !/^[a-z-]{1,40}$/.test(reference.type) || ['frame','section'].includes(reference.type))) fail(400, '画布元素引用无效');
  if (text.length > 4000 || (!text && !image && !reference && !videoId)) fail(400, '请输入消息，文字最多 4000 字');
  if(videoId && (typeof videoId!=='string' || !/^[a-f0-9]{32}$/.test(videoId) || image))fail(400,'视频标识无效');
  if (image && (typeof image !== 'string' || !/^\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(image))) fail(400, '图片格式无效');
  const hashParts=[text,image,input.replyId || null,reference ? [reference.itemId,reference.type,reference.label] : null];
  if(videoId)hashParts.push(videoId);
  if(mentions.length)hashParts.push(mentions.map(value=>[value?.userId,value?.start,value?.end]));
  const payloadHash=crypto.createHash('sha256').update(JSON.stringify(hashParts)).digest('hex');
  const receipt=chatStatement(db,'SELECT * FROM chat_send_receipts WHERE id=?').get(id);
  if(receipt){
    if(receipt.board_id!==boardId || receipt.sender_id!==userId || receipt.payload_hash!==payloadHash)fail(409,'消息标识已被用于不同内容');
    return id;
  }
  const existing = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(id);
  if (existing) {
    if (existing.board_id !== boardId || existing.sender_id !== userId) fail(409, '消息标识已被使用');
    return existing.id;
  }
  const generation=chatStatement(db,'SELECT reset_revision FROM canvas_chats WHERE board_id=?').get(boardId)?.reset_revision || 0;
  const normalizedMentions=normalizeChatMentions(db,boardId,text,mentions);
  if((input.generation!==undefined && input.generation!==generation) || (generation>0 && input.generation===undefined))
    throw Object.assign(new Error('聊天记录已清理，请刷新后重新发送'),{statusCode:409,code:'CHAT_GENERATION_CHANGED'});
  if (input.replyId && !db.prepare(`SELECT 1 FROM chat_messages m WHERE m.id=? AND m.board_id=? AND m.sequence>=? AND m.withdrawn_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`).get(input.replyId, boardId, chatHistoryStart(db,boardId,userId),userId)) fail(400, '引用的消息已不可用');
  return transaction(db, () => {
    if(videoId && !db.prepare(`SELECT 1 FROM chat_videos v WHERE v.id=? AND v.board_id=? AND v.user_id=? AND v.status='ready' AND v.expires_at>?
      AND NOT EXISTS(SELECT 1 FROM chat_messages m WHERE m.video_id=v.id)`).get(videoId,boardId,userId,Date.now()))fail(403,'请重新上传视频');
    if(image && (!db.prepare('SELECT 1 FROM assets WHERE asset_id=?').get(image.slice(8,72)) ||
      !db.prepare('SELECT 1 FROM asset_upload_grants WHERE asset_id=? AND user_id=? AND expires_at>?').get(image.slice(8,72),userId,Date.now())))fail(403,'请重新上传图片');
    const revision = nextRevision(db, boardId);
    db.prepare(`INSERT INTO chat_messages(id,board_id,sender_id,text,image,reply_id,sent_at,changed_revision,element_ref,search_text,video_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, boardId, userId, text, image, input.replyId || null, Date.now(), revision,
        reference ? JSON.stringify({itemId:reference.itemId,type:reference.type,label:reference.label}) : null,text.toLowerCase(),videoId);
    if(videoId)db.prepare('UPDATE chat_videos SET expires_at=NULL WHERE id=?').run(videoId);
    for(const mention of normalizedMentions)chatStatement(db,'INSERT INTO chat_mentions VALUES (?,?,?,?)').run(id,mention.userId,mention.start,mention.end);
    enqueueChatPush(db,id);
    db.prepare('INSERT INTO chat_send_receipts VALUES (?,?,?,?,?)').run(id,boardId,userId,payloadHash,Date.now());
    if (image) db.prepare(`INSERT INTO asset_references(owner_type,owner_id,asset_id,ref_count,updated_at)
      VALUES ('chat',?,?,1,?)`).run(id, image.slice(8,72), Date.now());
    if(image)db.prepare('INSERT OR IGNORE INTO chat_upload_assets VALUES (?,?,?)').run(userId,image.slice(8,72),Date.now());
    return id;
  });
}

export function changeChatMessage(db, boardId, userId, id, action) {
  const message = db.prepare('SELECT * FROM chat_messages WHERE board_id=? AND id=? AND sequence>=?').get(boardId, id,chatHistoryStart(db,boardId,userId));
  if (!message) fail(404, '消息不存在');
  if (action === 'withdraw' && message.sender_id !== userId) fail(403, '只能撤回自己发送的消息');
  if (!['withdraw', 'hide'].includes(action)) fail(400, '消息操作无效');
  if(action==='withdraw'&&message.withdrawn_at || action==='hide'&&chatStatement(db,'SELECT 1 FROM chat_hidden_messages WHERE message_id=? AND user_id=?').get(id,userId))return false;
  transaction(db, () => {
    const revision = nextRevision(db, boardId);
    if (action === 'withdraw') {
      const now=Date.now();
      db.prepare('DELETE FROM chat_reedit_drafts WHERE expires_at<=?').run(now);
      const reeditUntil=message.sent_at+CHAT_REEDIT_WINDOW_MS;
      if(message.text && reeditUntil>now)db.prepare('INSERT INTO chat_reedit_drafts VALUES (?,?,?)').run(id,message.text,reeditUntil);
      db.prepare('UPDATE chat_messages SET text=\'\',search_text=\'\',image=NULL,video_id=NULL,video_deleted_at=NULL,reply_id=NULL,element_ref=NULL,withdrawn_at=COALESCE(withdrawn_at,?),changed_revision=? WHERE id=?').run(now,revision,id);
      db.prepare("DELETE FROM asset_references WHERE owner_type='chat' AND owner_id=?").run(id);
      for(const table of ['chat_mentions','chat_reactions'])chatStatement(db,`DELETE FROM ${table} WHERE message_id=?`).run(id);
      if(message.image){
        const assetId=message.image.slice(8,72);
        // Other canvases/notebooks/avatars can legitimately share identical bytes.
        if(!db.prepare('SELECT 1 FROM asset_references WHERE asset_id=? LIMIT 1').get(assetId) &&
          !db.prepare('SELECT 1 FROM user_accounts WHERE avatar_asset_id=? LIMIT 1').get(assetId)){
          db.prepare('DELETE FROM asset_upload_grants WHERE asset_id=? AND user_id=?').run(assetId,userId);
          db.prepare('UPDATE assets SET orphaned_at=? WHERE asset_id=?').run(Date.now(),assetId);
        }
      }
    } else {
      db.prepare('INSERT OR IGNORE INTO chat_hidden_messages VALUES (?,?)').run(id,userId);
      db.prepare('UPDATE chat_messages SET changed_revision=? WHERE id=?').run(revision,id);
    }
    // Refresh quotes when the source disappears or changes.
    db.prepare('UPDATE chat_messages SET changed_revision=? WHERE board_id=? AND reply_id=?').run(revision,boardId,id);
  });
  return true;
}

export function readChatMessages(db, boardId, userId, params) {
  db.prepare('DELETE FROM chat_reedit_drafts WHERE expires_at<=?').run(Date.now());
  const chat = db.prepare('SELECT revision,reset_revision FROM canvas_chats WHERE board_id=?').get(boardId);
  if (!chat) return { exists:false, messages:[], revision:0, before:null };
  const firstSequence=chatHistoryStart(db,boardId,userId);
  const query = (params.get('q') || '').trim().slice(0,200);
  const filter=chatFilters(params,userId);
  const since = params.has('since') ? Number(params.get('since')) : null;
  const around=params.has('around') ? Number(params.get('around')) : null;
  if(around!==null && (!Number.isSafeInteger(around) || around<1 || !db.prepare(`SELECT 1 FROM chat_messages m WHERE m.board_id=? AND m.sequence=? AND m.sequence>=? AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`).get(boardId,around,firstSequence,userId)))fail(404,'消息已不可用');
  const before = around!==null ? Math.min(Number.MAX_SAFE_INTEGER,around+41) : params.has('before') ? Number(params.get('before')) : Number.MAX_SAFE_INTEGER;
  if(!Number.isSafeInteger(before) || before<1)fail(400,'历史位置无效');
  if (since !== null && (!Number.isSafeInteger(since) || since < 0)) fail(400, '同步版本无效');
  const reset = since !== null && since < chat.reset_revision;
  const changes = since !== null && !reset;
  const select = `SELECT m.*, a.width AS image_width,a.height AS image_height,v.id AS video_exists,v.name AS video_name,v.extension AS video_extension,v.byte_size AS video_bytes,v.width AS video_width,v.height AS video_height,v.duration AS video_duration,h.user_id AS hidden, r.id AS reply_exists, r.text AS reply_text, r.image AS reply_image, r.video_id AS reply_video,r.element_ref AS reply_ref,
      r.withdrawn_at AS reply_withdrawn, r.sender_id AS reply_sender, r.sequence AS reply_sequence, rh.user_id AS reply_hidden,
      ra.width AS reply_image_width,ra.height AS reply_image_height,rv.id AS reply_video_exists
    FROM chat_messages m
    LEFT JOIN assets a ON a.asset_id=substr(m.image,9,64)
    LEFT JOIN chat_videos v ON v.id=m.video_id AND v.status='ready'
    LEFT JOIN chat_hidden_messages h ON h.message_id=m.id AND h.user_id=?
    LEFT JOIN chat_messages r ON r.id=m.reply_id AND r.board_id=m.board_id AND r.sequence>=?
    LEFT JOIN assets ra ON ra.asset_id=substr(r.image,9,64)
    LEFT JOIN chat_videos rv ON rv.id=r.video_id AND rv.status='ready'
    LEFT JOIN chat_hidden_messages rh ON rh.message_id=r.id AND rh.user_id=?`;
  const rows = chatStatement(db,`${select} WHERE m.board_id=? AND m.sequence>=? AND ${changes ? 'm.changed_revision>?' : 'm.sequence<? AND h.user_id IS NULL'}
    ${!changes && query ? "AND m.withdrawn_at IS NULL AND instr(m.search_text,?)>0" : ''}
    ${!changes ? filter.sql : ''}
    ORDER BY ${changes ? 'm.changed_revision ASC, m.sequence ASC' : 'm.sequence DESC'} LIMIT ${changes ? 1001 : 81}`)
    .all(userId,firstSequence,userId,boardId,firstSequence,changes ? since : before,...(!changes && query ? [query.toLowerCase()] : []),...(!changes ? filter.values : []));
  // Do not split a revision: quotes and their source share one revision.
  let selected = changes ? rows : rows.slice(0,80);
  let revision = chat.revision;
  if (changes && rows.length > 1000) {
    const cutoff = rows.at(-1).changed_revision;
    selected = rows.filter(row => row.changed_revision < cutoff);
    if (!selected.length) selected = db.prepare(`${select} WHERE m.board_id=? AND m.sequence>=? AND m.changed_revision=? ORDER BY m.sequence`).all(userId,firstSequence,userId,boardId,firstSequence,cutoff);
    revision = selected.at(-1)?.changed_revision || since;
  }
  const messages = selected.map(row => row.hidden ? {id:row.id,sequence:row.sequence,deleted:true} : ({ id:row.id, sequence:row.sequence, changedRevision:row.changed_revision, senderId:row.sender_id, text:row.text,
    image:row.image, sentAt:row.sent_at, withdrawnAt:row.withdrawn_at, deleted:Boolean(row.hidden),
    imageInfo:row.image ? chatImageInfo(row.image,row.image_width,row.image_height) : null,
    videoDeletedAt:row.video_deleted_at,video:row.video_exists ? videoInfo({id:row.video_id,board_id:row.board_id,name:row.video_name,byte_size:row.video_bytes,width:row.video_width,height:row.video_height,duration:row.video_duration}) : null,
    reference:row.element_ref ? JSON.parse(row.element_ref) : null,
    reply:chatReply(row) }));
  if (!changes) messages.reverse();
  const reeditDrafts=new Map(chatStatement(db,`SELECT d.message_id,d.expires_at FROM json_each(?) j
    JOIN chat_messages m ON m.id=j.value JOIN chat_reedit_drafts d ON d.message_id=m.id
    WHERE m.sender_id=? AND m.withdrawn_at IS NOT NULL AND d.expires_at>?`)
    .all(JSON.stringify(messages.filter(message=>!message.deleted).map(message=>message.id)),userId,Date.now()).map(row=>[row.message_id,row.expires_at]));
  for(const message of messages)if(reeditDrafts.has(message.id))message.reeditUntil=reeditDrafts.get(message.id);
  decorateChatMessages(db,messages);
  if(changes&&(query||filter.active)){
    // Changed rows still include removals, while matching rows can update a filtered view in place.
    const matching=new Set(chatStatement(db,`SELECT m.id FROM json_each(?) j JOIN chat_messages m ON m.id=j.value
      WHERE m.board_id=? AND m.sequence>=? AND m.withdrawn_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)
      ${query?'AND instr(m.search_text,?)>0':''}${filter.sql}`)
      .all(JSON.stringify(messages.map(message=>message.id)),boardId,firstSequence,userId,...(query?[query.toLowerCase()]:[]),...filter.values).map(row=>row.id));
    for(const message of messages)message.matchesFilter=matching.has(message.id);
  }
  const totalMatches=query || filter.active ? cachedSearchCount(db,boardId,chat.revision,userId,query,firstSequence,filter) : null;
  return {exists:true,messages,revision,reset,generation:chat.reset_revision,totalMatches,before:!changes && rows.length>80 ? messages[0].sequence : null};
}

export function readChatReeditDraft(db,boardId,userId,id){
  const now=Date.now();
  db.prepare('DELETE FROM chat_reedit_drafts WHERE expires_at<=?').run(now);
  const draft=db.prepare(`SELECT d.text,d.expires_at FROM chat_reedit_drafts d JOIN chat_messages m ON m.id=d.message_id
    WHERE m.id=? AND m.board_id=? AND m.sender_id=? AND m.withdrawn_at IS NOT NULL AND m.sequence>=?
    AND d.expires_at>? AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`)
    .get(id,boardId,userId,chatHistoryStart(db,boardId,userId),now,userId);
  if(!draft)fail(410,'消息已过期或不可重新编辑');
  return {text:draft.text,reeditUntil:draft.expires_at};
}

function chatReply(row){
  if(!row.reply_id)return null;
  const available=Boolean(row.reply_exists&&!row.reply_withdrawn&&!row.reply_hidden);
  const image=available ? row.reply_image : null;
  return {id:row.reply_id,senderId:row.reply_sender,sequence:available ? row.reply_sequence : null,
    text:!available ? '原消息已不可用' : row.reply_text || (row.reply_ref ? '画布元素引用' : row.reply_video ? '视频' : '图片'),
    image,imageInfo:image ? chatImageInfo(image,row.reply_image_width,row.reply_image_height) : null,
    video:available&&row.reply_video_exists ? {thumb:videoInfo({id:row.reply_video,board_id:row.board_id}).thumb} : null};
}

function chatImageInfo(original,width,height){
  const longest=Math.max(width || 0,height || 0),base=original.replace(/\.(png|jpg|webp)$/,'');
  return {width:width || null,height:height || null,thumb:longest>320 ? `${base}.thumb.webp` : original,
    medium:longest>1600 ? `${base}.medium.webp` : original,original};
}

export function markChatRead(db,boardId,userId,sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) fail(400, '已读位置无效');
  const latest = db.prepare('SELECT max(sequence) AS n FROM chat_messages WHERE board_id=?').get(boardId).n || 0;
  if (sequence > latest) fail(400, '已读位置超出聊天记录');
  if (!db.prepare('SELECT 1 FROM canvas_chats WHERE board_id=?').get(boardId)) fail(409, '请先添加画布群聊');
  return Boolean(db.prepare(`INSERT INTO chat_read_positions(board_id,user_id,sequence) VALUES (?,?,?)
    ON CONFLICT(board_id,user_id) DO UPDATE SET sequence=excluded.sequence WHERE excluded.sequence>sequence`).run(boardId,userId,sequence).changes);
}

export function chatReadStatus(db,boardId,userId,memberIds) {
  const positions = Object.fromEntries(db.prepare('SELECT user_id,sequence FROM chat_read_positions WHERE board_id=?').all(boardId)
    .filter(row => memberIds.includes(row.user_id)).map(row => [row.user_id,row.sequence]));
  const unreadCount = db.prepare(`SELECT count(*) AS n FROM chat_messages m WHERE m.board_id=? AND m.sender_id<>?
    AND m.sequence>=? AND m.sequence>? AND m.withdrawn_at IS NULL AND NOT EXISTS
    (SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`).get(boardId,userId,chatHistoryStart(db,boardId,userId),positions[userId] || 0,userId).n;
  const latestSequence = db.prepare('SELECT max(sequence) AS n FROM chat_messages WHERE board_id=?').get(boardId).n || 0;
  const unreadMentionCount=chatStatement(db,`SELECT count(*) AS n FROM chat_messages m WHERE m.board_id=? AND m.sender_id<>?
    AND m.sequence>=? AND m.sequence>? AND m.withdrawn_at IS NULL AND EXISTS(SELECT 1 FROM chat_mentions t WHERE t.message_id=m.id AND t.user_id=?)
    AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`).get(boardId,userId,chatHistoryStart(db,boardId,userId),positions[userId] || 0,userId,userId).n;
  const notificationMode=chatStatement(db,'SELECT notification_mode AS mode FROM chat_preferences WHERE board_id=? AND user_id=?').get(boardId,userId)?.mode || 'all';
  return {positions,unreadCount,unreadMentionCount,notificationMode,latestSequence};
}

