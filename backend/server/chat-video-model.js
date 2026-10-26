import { integerSetting } from './environment-settings.js';
import chatHistory from '../chat-history.js';

export const VIDEO_LIMIT_BYTES = integerSetting('CHAT_VIDEO_LIMIT_BYTES', 3 * 1024 ** 3);
export const VIDEO_MAX_BYTES = integerSetting('CHAT_VIDEO_MAX_BYTES', 512 * 1024 ** 2);
export const VIDEO_CHUNK_BYTES = 4 * 1024 ** 2;
export const VIDEO_UPLOAD_TTL = 60 * 60 * 1000;
export const VIDEO_FORMATS = {mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm'};
export const VIDEO_DELETED_TEXT = '该视频因达到此画布视频文件总大小限制已被用户选择删除';
export function videoError(statusCode,message,code='CHAT_VIDEO_INVALID') {return Object.assign(new Error(message),{statusCode,code});}

export function ensureChatVideoSchema(db) {
  const columns=db.prepare('PRAGMA table_info(chat_messages)').all();
  if(!columns.some(row=>row.name==='video_id'))db.exec('ALTER TABLE chat_messages ADD COLUMN video_id TEXT');
  if(!columns.some(row=>row.name==='video_deleted_at'))db.exec('ALTER TABLE chat_messages ADD COLUMN video_deleted_at INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS chat_videos (
    id TEXT PRIMARY KEY,board_id TEXT NOT NULL REFERENCES canvas_chats(board_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,name TEXT NOT NULL,extension TEXT NOT NULL,byte_size INTEGER NOT NULL,
    received_bytes INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,
    width INTEGER,height INTEGER,duration REAL,sha256 TEXT,
    created_at INTEGER NOT NULL,expires_at INTEGER,deleted_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS chat_videos_board ON chat_videos(board_id,status);
  CREATE UNIQUE INDEX IF NOT EXISTS chat_message_video ON chat_messages(video_id) WHERE video_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS chat_video_downloads (
    token TEXT PRIMARY KEY,video_id TEXT NOT NULL REFERENCES chat_videos(id) ON DELETE CASCADE,
    board_id TEXT NOT NULL,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,finished INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX IF NOT EXISTS chat_video_download_expiry ON chat_video_downloads(expires_at);
  CREATE TRIGGER IF NOT EXISTS chat_video_cleanup AFTER DELETE ON chat_messages WHEN OLD.video_id IS NOT NULL BEGIN
    UPDATE chat_videos SET status='deleting',expires_at=NULL WHERE id=OLD.video_id AND status<>'deleted';
  END;
  CREATE TRIGGER IF NOT EXISTS chat_video_withdraw AFTER UPDATE OF video_id ON chat_messages
    WHEN OLD.video_id IS NOT NULL AND NEW.video_id IS NOT OLD.video_id BEGIN
    UPDATE chat_videos SET status='deleting',expires_at=NULL WHERE id=OLD.video_id AND status<>'deleted';
  END;`);
}

export function videoStorageStatus(db,boardId) {
  const rows=db.prepare(`SELECT CASE WHEN status='ready' AND expires_at IS NOT NULL THEN 'pending' ELSE status END AS status,sum(byte_size) AS bytes
    FROM chat_videos WHERE board_id=? AND status<>'deleted' GROUP BY 1`).all(boardId);
  const usedBytes=rows.filter(row=>['ready','deleting'].includes(row.status)).reduce((sum,row)=>sum+row.bytes,0);
  const reservedBytes=rows.filter(row=>['uploading','processing','pending'].includes(row.status)).reduce((sum,row)=>sum+row.bytes,0);
  const limitBytes=VIDEO_LIMIT_BYTES;
  return {usedBytes,reservedBytes,limitBytes,maxFileBytes:Math.min(VIDEO_MAX_BYTES,limitBytes),chunkBytes:VIDEO_CHUNK_BYTES,formats:Object.keys(VIDEO_FORMATS)};
}

export function videoInfo(row) {
  const base=`/api/canvases/${encodeURIComponent(row.board_id)}/chat/videos/${row.id}`;
  return {id:row.id,name:row.name,bytes:row.byte_size,width:row.width,height:row.height,duration:row.duration,
    thumb:`${base}/thumb`,preview:`${base}/preview`,original:`${base}/original`};
}

export function visibleVideo(db,boardId,userId,id) {
  const row=db.prepare(`SELECT v.* FROM chat_videos v JOIN chat_messages m ON m.video_id=v.id
    WHERE v.id=? AND v.board_id=? AND v.status='ready' AND m.withdrawn_at IS NULL AND m.sequence>=?
    AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`)
    .get(id,boardId,chatHistory.chatHistoryStart(db,boardId,userId),userId);
  if(!row)throw videoError(404,'视频已不可用');
  return row;
}

export function listChatVideos(db,boardId,userId,canManage=false) {
  return db.prepare(`SELECT v.*,m.id AS message_id,m.sender_id,m.sent_at FROM chat_videos v JOIN chat_messages m ON m.video_id=v.id
    WHERE v.board_id=? AND v.status='ready' AND m.withdrawn_at IS NULL AND m.sequence>=?
    AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?) ORDER BY m.sequence DESC`)
    .all(boardId,chatHistory.chatHistoryStart(db,boardId,userId),userId)
    .map(row=>({...videoInfo(row),messageId:row.message_id,senderId:row.sender_id,sentAt:row.sent_at,canDelete:canManage || row.user_id===userId}));
}
