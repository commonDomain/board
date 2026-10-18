import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { servicesRuntime } from './runtime/services.js';
import { requireCatalogBoardId } from './catalog-access.js';
import { readJsonBody,readRequestBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { notifyChatChanged } from './chat-events.js';
import { createMemoryRateLimiter } from './rate-limits.js';
import { VIDEO_CHUNK_BYTES,VIDEO_UPLOAD_TTL,VIDEO_FORMATS,VIDEO_DELETED_TEXT,videoError,videoInfo,videoStorageStatus,visibleVideo,listChatVideos } from './chat-video-model.js';
import { VIDEO_DIR,videoPath,processChatVideo,removeVideoFiles,streamVideo } from './chat-video-files.js';
import { assertWriteCapacity } from './resources.js';

const uploadLimit=createMemoryRateLimiter(20,60000),downloadLimit=createMemoryRateLimiter(10,60000),locks=new Set();let processing=0,cleanupPromise=null;
function atomic(db,action){db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
function canDelete(account,row,userId){return row.user_id===userId || account.canManageBoard(userId,row.board_id);}
function ticketRow(db,token,boardId,userId,id){
  const row=typeof token==='string' && db.prepare('SELECT * FROM chat_video_downloads WHERE token=? AND board_id=? AND user_id=? AND video_id=? AND expires_at>?').get(token,boardId,userId,id,Date.now());
  if(!row)throw videoError(403,'下载凭据无效或已过期，请重新保存视频');return row;
}

export async function collectChatVideos(db=servicesRuntime.database,{scan=true}={}) {
  if(cleanupPromise)return cleanupPromise;
  cleanupPromise=(async()=>{
    db.prepare("UPDATE chat_videos SET status='deleting' WHERE expires_at<? AND status IN ('uploading','processing','ready')").run(Date.now());
    db.prepare('DELETE FROM chat_video_downloads WHERE expires_at<?').run(Date.now());
    for(const row of db.prepare("SELECT * FROM chat_videos WHERE status='deleting'").all()){
      if(locks.has(row.id))continue;locks.add(row.id);
      try{await removeVideoFiles(row);db.prepare("UPDATE chat_videos SET status='deleted',deleted_at=COALESCE(deleted_at,?),byte_size=0 WHERE id=?").run(Date.now(),row.id);}
      finally{locks.delete(row.id);}
    }
    // Canvas deletion cascades metadata; clean its files too. Only generated filenames are touched.
    const names=scan ? await fsp.readdir(VIDEO_DIR).catch(error=>{if(error.code==='ENOENT')return [];throw error;}) : [];
    for(const name of names){const match=/^([a-f0-9]{32})\.(original|preview|thumb)\.(mp4|m4v|mov|webm|jpg)$/.exec(name);if(!match || locks.has(match[1]))continue;
      if(!db.prepare('SELECT 1 FROM chat_videos WHERE id=?').get(match[1]))await fsp.rm(videoPath(match[1],match[2],match[3]==='jpg' ? 'mp4' : match[3]),{force:true});}
  })().finally(()=>{cleanupPromise=null;});return cleanupPromise;
}

export async function handleChatVideoApi(req,res,url) {
  const match=url.pathname.match(/^\/api\/canvases\/([^/]+)\/chat\/videos(?:\/(uploads|downloads|delete)|\/([a-f0-9]{32})(?:\/(chunks|complete|original|preview|thumb))?)?$/);
  if(!match)return false;
  const db=servicesRuntime.database,account=servicesRuntime.accountService;
  const session=account.requireSession(req,{requireCsrf:!['GET','HEAD'].includes(req.method)});
  if(!session?.userId)throw videoError(401,'登录后才能使用聊天视频');
  const requireBoard=()=>{try{return requireCatalogBoardId(match[1],session.userId);}catch(error){if(error.code==='CANVAS_NOT_FOUND')error.statusCode=404;throw error;}};
  const boardId=requireBoard(),userId=session.userId;
  const revalidate=()=>{account.requireSession(req,{requireCsrf:!['GET','HEAD'].includes(req.method)});requireBoard();};
  if(!db.prepare('SELECT 1 FROM canvas_chats WHERE board_id=?').get(boardId))throw videoError(409,'请先添加画布群聊');
  const action=match[2] || match[4],id=match[3];
  if(req.method==='GET' && !action && !id){
    sendJson(res,200,{...videoStorageStatus(db,boardId),videos:listChatVideos(db,boardId,userId,account.canManageBoard(userId,boardId))});
  }else if(req.method==='POST' && action==='uploads'){
    const body=await readJsonBody(req,2048);revalidate();
    if(!uploadLimit(userId))throw videoError(429,'视频上传过于频繁，请稍后重试');
    const extension=typeof body.name==='string' ? body.name.split('.').at(-1).toLowerCase() : '';
    const name=String(body.name || '').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(-180);
    const storage=videoStorageStatus(db,boardId);
    if(!Object.hasOwn(VIDEO_FORMATS,extension))throw videoError(415,'支持 MP4、MOV、WebM、M4V 视频');
    if(!Number.isSafeInteger(body.bytes) || body.bytes<16 || body.bytes>storage.maxFileBytes)throw videoError(413,'视频文件大小超出单文件上限');
    if(storage.usedBytes+storage.reservedBytes+body.bytes>storage.limitBytes)throw videoError(409,'此画布原视频空间不足，请先保存并清理视频','CHAT_VIDEO_LIMIT_REACHED');
    if(db.prepare("SELECT count(*) AS n FROM chat_videos WHERE user_id=? AND status IN ('uploading','processing')").get(userId).n>=3)throw videoError(429,'请等待当前视频上传完成');
    const videoId=crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO chat_videos(id,board_id,user_id,name,extension,byte_size,status,created_at,expires_at) VALUES (?,?,?,?,?,?,\'uploading\',?,?)').run(videoId,boardId,userId,name,extension,body.bytes,Date.now(),Date.now()+VIDEO_UPLOAD_TTL);
    try{await fsp.mkdir(VIDEO_DIR,{recursive:true,mode:0o700});await fsp.writeFile(videoPath(videoId,'original',extension),Buffer.alloc(0),{flag:'wx',mode:0o600});}
    catch(error){db.prepare('DELETE FROM chat_videos WHERE id=?').run(videoId);throw error;}
    sendJson(res,201,{id:videoId,chunkBytes:VIDEO_CHUNK_BYTES});
  }else if(id && ['chunks','complete'].includes(action) && req.method==='POST' || id && !action && req.method==='DELETE'){
    if(locks.has(id))throw videoError(409,'该视频正在处理，请稍后重试');locks.add(id);
    try{
      const row=db.prepare('SELECT * FROM chat_videos WHERE id=? AND board_id=? AND user_id=? AND expires_at>?').get(id,boardId,userId,Date.now());
      if(!row || !['uploading','ready'].includes(row.status))throw videoError(404,'上传已失效，请重新选择视频');
      if(req.method==='DELETE'){await removeVideoFiles(row);db.prepare('DELETE FROM chat_videos WHERE id=?').run(id);sendJson(res,200,{ok:true});}
      else if(action==='chunks'){
        const buffer=await readRequestBody(req,VIDEO_CHUNK_BYTES);revalidate();const offset=Number(url.searchParams.get('offset'));
        if(row.status!=='uploading' || !url.searchParams.has('offset') || !Number.isSafeInteger(offset) || offset<0 || !buffer.length || offset+buffer.length>row.byte_size)throw videoError(400,'上传分块无效');
        if(offset===row.received_bytes){await assertWriteCapacity(buffer.length);revalidate();}
        const handle=await fsp.open(videoPath(id,'original',row.extension),'r+');
        try{
          if(offset<row.received_bytes){const existing=Buffer.alloc(buffer.length);await handle.read(existing,0,existing.length,offset);if(offset+buffer.length>row.received_bytes || !existing.equals(buffer))throw videoError(409,'上传分块内容冲突');}
          else{if(offset!==row.received_bytes)throw videoError(409,'上传分块顺序无效');let written=0;while(written<buffer.length)written+=(await handle.write(buffer,written,buffer.length-written,offset+written)).bytesWritten;await handle.sync();
            db.prepare('UPDATE chat_videos SET received_bytes=?,expires_at=? WHERE id=?').run(offset+buffer.length,Date.now()+VIDEO_UPLOAD_TTL,id);}
        }finally{await handle.close();}
        sendJson(res,200,{receivedBytes:Math.max(row.received_bytes,offset+buffer.length)});
      }else{
        if(row.status==='ready'){sendJson(res,200,videoInfo(row));return true;}
        if(row.received_bytes!==row.byte_size)throw videoError(409,'视频尚未上传完整');
        if(processing>=1)throw videoError(429,'视频处理繁忙，请稍后重试','CHAT_VIDEO_BUSY');
        processing++;db.prepare("UPDATE chat_videos SET status='processing',expires_at=? WHERE id=?").run(Date.now()+VIDEO_UPLOAD_TTL,id);
        const processingController=new AbortController(),abortProcessing=()=>{if(!res.writableFinished)processingController.abort();};res.once('close',abortProcessing);
        const processingSignal=AbortSignal.any([processingController.signal,AbortSignal.timeout(330000)]);
        try{const info=await processChatVideo(row,processingSignal,async bytes=>{await assertWriteCapacity(bytes);revalidate();});revalidate();
          if(!db.prepare('SELECT 1 FROM chat_videos WHERE id=?').get(id))throw videoError(404,'画布已删除');
          db.prepare("UPDATE chat_videos SET status='ready',width=?,height=?,duration=?,sha256=?,expires_at=? WHERE id=?").run(info.width,info.height,info.duration,info.sha256,Date.now()+VIDEO_UPLOAD_TTL,id);
          sendJson(res,200,videoInfo({...row,...info}));
        }catch(error){await removeVideoFiles(row);db.prepare('DELETE FROM chat_videos WHERE id=?').run(id);throw error;}finally{res.removeListener('close',abortProcessing);processing--;}
      }
    }finally{locks.delete(id);}
  }else if(['GET','HEAD'].includes(req.method) && ['original','preview','thumb'].includes(action)){
    const row=visibleVideo(db,boardId,userId,id),token=url.searchParams.get('download');
    if(token && action!=='original')throw videoError(400,'只能保存原视频');
    if(token)ticketRow(db,token,boardId,userId,id);
    await streamVideo(req,res,row,action,token,()=>{db.prepare('UPDATE chat_video_downloads SET finished=1 WHERE token=?').run(token);},()=>{revalidate();visibleVideo(db,boardId,userId,id);});
  }else if(action==='downloads' && req.method==='GET'){
    const tokens=(url.searchParams.get('tokens') || '').split(',');if(tokens.length>40)throw videoError(400,'一次最多保存 40 个视频');
    const complete=tokens.every(token=>db.prepare('SELECT 1 FROM chat_video_downloads WHERE token=? AND user_id=? AND board_id=? AND expires_at>? AND finished=1').get(token,userId,boardId,Date.now()));
    sendJson(res,200,{complete});
  }else if(action==='downloads' && req.method==='POST'){
    const body=await readJsonBody(req,8192);revalidate();
    if(!downloadLimit(userId))throw videoError(429,'视频保存请求过于频繁，请稍后重试');
    if(!Array.isArray(body.ids) || !body.ids.length || body.ids.length>40 || body.ids.some(id=>typeof id!=='string' || !/^[a-f0-9]{32}$/.test(id)) || new Set(body.ids).size!==body.ids.length)throw videoError(400,'一次请选择 1 到 40 个视频');
    const rows=body.ids.map(id=>visibleVideo(db,boardId,userId,id));for(const row of rows)if(!canDelete(account,row,userId))throw videoError(403,'只能清理自己上传的视频；画布所有者可以清理全部视频');
    const tickets=atomic(db,()=>rows.map(row=>{const token=crypto.randomBytes(24).toString('hex');db.prepare('INSERT INTO chat_video_downloads VALUES (?,?,?,?,?,0)').run(token,row.id,boardId,userId,Date.now()+VIDEO_UPLOAD_TTL);return {id:row.id,token,url:`${videoInfo(row).original}?download=${token}`,name:row.name,bytes:row.byte_size};}));
    sendJson(res,201,{tickets});
  }else if(action==='delete' && req.method==='POST'){
    const body=await readJsonBody(req,16384);revalidate();
    if(body.saved!==true || !Array.isArray(body.tickets) || !body.tickets.length || body.tickets.length>40 || body.tickets.some(ticket=>!ticket || typeof ticket.id!=='string' || !/^[a-f0-9]{32}$/.test(ticket.id) || typeof ticket.token!=='string' || !/^[a-f0-9]{48}$/.test(ticket.token)) || new Set(body.tickets.map(ticket=>ticket.id)).size!==body.tickets.length)throw videoError(400,'请先完成下载并确认原视频已保存');
    const rows=body.tickets.map(ticket=>{
      const receipt=ticketRow(db,ticket.token,boardId,userId,ticket.id);
      const row=db.prepare('SELECT * FROM chat_videos WHERE id=? AND board_id=?').get(ticket.id,boardId);
      if(!receipt.finished)throw videoError(409,'原视频下载尚未完成，云端文件已保留');
      if(!row || !canDelete(account,row,userId))throw videoError(403,'没有清理该视频的权限');
      if(row.status==='ready')visibleVideo(db,boardId,userId,ticket.id);
      if(!['ready','deleted','deleting'].includes(row.status))throw videoError(409,'视频状态已变化，请刷新');return row;
    });
    atomic(db,()=>{
      const revision=db.prepare('UPDATE canvas_chats SET revision=revision+1 WHERE board_id=? RETURNING revision').get(boardId).revision;
      for(const row of rows){
        const source=db.prepare('SELECT id FROM chat_messages WHERE board_id=? AND video_id=?').get(boardId,row.id);
        if(source)db.prepare('UPDATE chat_messages SET changed_revision=? WHERE board_id=? AND reply_id=?').run(revision,boardId,source.id);
        db.prepare("UPDATE chat_messages SET video_id=NULL,video_deleted_at=?,text=?,search_text=?,image=NULL,reply_id=NULL,element_ref=NULL,changed_revision=? WHERE board_id=? AND video_id=?").run(Date.now(),VIDEO_DELETED_TEXT,VIDEO_DELETED_TEXT,revision,boardId,row.id);
        db.prepare("UPDATE chat_videos SET status=CASE WHEN status='deleted' THEN status ELSE 'deleting' END,expires_at=NULL WHERE id=?").run(row.id);}
    });notifyChatChanged(boardId);
    await collectChatVideos(db);sendJson(res,200,{ok:true,...videoStorageStatus(db,boardId)});
  }else sendJson(res,405,{error:'不支持的视频操作'});
  return true;
}
