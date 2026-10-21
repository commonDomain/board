'use strict';

// Applied exclusively to the copied database, never the live chat.
function prepareChatTextBackup(db){
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  if(!tables.has('chat_messages'))return;
  const columns=new Set(db.prepare('PRAGMA table_info(chat_messages)').all().map(row=>row.name));
  const media=['image','video_id','element_ref'].filter(column=>columns.has(column));
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('BEGIN IMMEDIATE');try{
    if(tables.has('chat_reedit_drafts'))db.exec('DELETE FROM chat_reedit_drafts;');
    if(media.length){
      db.exec(`DELETE FROM chat_messages WHERE text='' AND withdrawn_at IS NULL AND (${media.map(column=>`${column} IS NOT NULL`).join(' OR ')});`);
      db.exec(`UPDATE chat_messages SET ${media.map(column=>`${column}=NULL`).join(',')}${columns.has('video_deleted_at') ? ',video_deleted_at=NULL' : ''};`);
    }
    if(tables.has('asset_references'))db.exec("DELETE FROM asset_references WHERE owner_type='chat';");
    if(tables.has('chat_upload_assets'))db.exec('DELETE FROM chat_upload_assets;');
    if(tables.has('chat_video_downloads'))db.exec('DELETE FROM chat_video_downloads;');
    if(tables.has('chat_videos'))db.exec('DELETE FROM chat_videos;');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={prepareChatTextBackup};
