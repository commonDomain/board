import { servicesRuntime } from './runtime/services.js';
import { requireCatalogBoardId } from './catalog-access.js';
import { boards, clients } from './board-registry.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { createChat, sendChatMessage, changeChatMessage, readChatMessages, markChatRead, chatReadStatus } from './chat-store.js';
import { notifyChatChanged } from './chat-events.js';
import { assertClientAccess } from './client-access.js';
import { createMemoryRateLimiter } from './rate-limits.js';
import chatHistory from '../chat-history.js';
import { videoStorageStatus } from './chat-video-model.js';
import { collectChatVideos } from './chat-videos.js';
import { chatFeatureSummary,chatSenders,mutateChatFeature,visibleChatMessage,chatReactionState } from './chat-features.js';
import { chatStatement } from './chat-statements.js';

const readLimit=createMemoryRateLimiter(180,60000);
const searchLimit=createMemoryRateLimiter(60,60000);
const mutationLimit=createMemoryRateLimiter(120,60000);

export async function handleChatApi(req,res,url) {
  const match = url.pathname.match(/^\/api\/canvases\/([^/]+)\/chat(?:\/(read|announcement|preferences)|\/messages(?:\/([^/]+)(?:\/(withdraw|reaction|material))?)?)?$/);
  if (!match) return false;
  const account = servicesRuntime.accountService, db = servicesRuntime.database;
  const session = account.requireSession(req,{requireCsrf:req.method !== 'GET'});
  if (!session?.userId) throw Object.assign(new Error('登录后才能与画布成员聊天'),{statusCode:401,code:'AUTH_REQUIRED'});
  const boardId = requireCatalogBoardId(match[1],session.userId);
  const revalidate=()=>{account.requireSession(req,{requireCsrf:true});requireCatalogBoardId(boardId,session.userId);};
  if(req.method==='GET' && match[4]==='material'){
    if(!readLimit(session.userId))throw Object.assign(new Error('查询过于频繁，请稍后重试'),{statusCode:429});
    const message=visibleChatMessage(db,boardId,session.userId,match[3]);
    // A copy receives its own asset dependency via the existing destination save.
    if(message.image)db.prepare(`INSERT INTO asset_upload_grants VALUES (?,?,?) ON CONFLICT(asset_id,user_id) DO UPDATE SET expires_at=max(expires_at,excluded.expires_at)`).run(message.image.slice(8,72),session.userId,Date.now()+3600000);
    sendJson(res,200,{id:message.id,sequence:message.sequence,text:message.text,image:message.image,
      reference:message.element_ref?JSON.parse(message.element_ref):null,senderId:message.sender_id,sentAt:message.sent_at});
  }else if(match[4]==='reaction' && req.method==='PUT' || ['announcement','preferences'].includes(match[2]) && req.method==='PUT'){
    if(!mutationLimit(session.userId))throw Object.assign(new Error('操作过于频繁，请稍后重试'),{statusCode:429});
    const input=await readJsonBody(req,12*1024);revalidate();
    const action=match[4]||match[2],changed=mutateChatFeature(db,boardId,session.userId,action,match[3],input);
    if(changed||action==='preferences')notifyChatChanged(boardId,action==='preferences'?session.userId:null);
    sendJson(res,200,{ok:true,...(action==='reaction'?{reaction:chatReactionState(db,boardId,match[3])}:{})});
  }else if (req.method === 'GET' && !match[2] && !match[3]) {
    if(!(url.searchParams.get('q') ? searchLimit : readLimit)(session.userId))
      throw Object.assign(new Error('聊天查询过于频繁，请稍后重试'),{statusCode:429,code:'CHAT_READ_LIMITED'});
    const onlineIds=new Set();
    for(const client of clients){if(client.socket.readyState!==1)continue;try{assertClientAccess(client);onlineIds.add(client.userId);}catch{}}
    const members = account.getSharing(session.userId).members.filter(member => member && account.canAccessBoard(member.id,boardId)).map(member => ({
      id:member.id,username:member.username,avatarUrl:member.avatarUrl,
      online:member.id === session.userId || onlineIds.has(member.id)
    }));
    const result = url.searchParams.get('status') === '1'
      ? {exists:Boolean(db.prepare('SELECT 1 FROM canvas_chats WHERE board_id=?').get(boardId)),messages:[]}
      : readChatMessages(db,boardId,session.userId,url.searchParams);
    const authors = new Map(members.map(member => [member.id,member]));
    const missingAuthors=new Set();
    for(const message of result.messages)for(const id of [message.senderId,message.reply?.senderId,...(message.reactions||[]).flatMap(group=>group.userIds)])if(id&&!authors.has(id))missingAuthors.add(id);
    if(missingAuthors.size){
      // Only identities already present in visible messages are resolved, in one batch.
      for(const user of chatStatement(db,'SELECT u.id,u.username,u.avatar_asset_id FROM json_each(?) j JOIN user_accounts u ON u.id=j.value').all(JSON.stringify([...missingAuthors])))
        authors.set(user.id,{id:user.id,username:user.username,avatarUrl:user.avatar_asset_id?`/api/avatars/${user.avatar_asset_id}`:null,online:false});
    }
    sendJson(res,200,{...result,...chatReadStatus(db,boardId,session.userId,members.map(member => member.id)),...chatFeatureSummary(db,boardId),
      ...(url.searchParams.get('status')==='1'?{}:{senders:chatSenders(db,boardId,session.userId)}),videoStorage:videoStorageStatus(db,boardId),members,authors:[...authors.values()]});
  } else if (req.method === 'PUT' && url.pathname.endsWith('/chat')) {
    if (createChat(db,boardId)) notifyChatChanged(boardId);
    sendJson(res,200,{ok:true});
  } else if (req.method === 'POST' && url.pathname.endsWith('/messages')) {
    const input = await readJsonBody(req,16*1024);
    // Body reading is asynchronous; membership must still be valid before the write.
    revalidate();
    if (input?.reference && !db.prepare('SELECT 1 FROM chat_send_receipts WHERE id=? AND board_id=? AND sender_id=?').get(input.id,boardId,session.userId) && !db.prepare('SELECT 1 FROM chat_messages WHERE id=? AND board_id=? AND sender_id=?').get(input.id,boardId,session.userId)) {
      const state = boards.get(boardId)?.state || JSON.parse(db.prepare('SELECT state_json FROM boards WHERE id=?').get(boardId).state_json);
      const item = state.items?.find(item => item.id === input.reference.itemId && !['frame','section'].includes(item.type));
      if (!item) throw Object.assign(new Error('引用的画布元素已不存在'),{statusCode:400,code:'CHAT_REFERENCE_INVALID'});
      input.reference = {...input.reference,type:item.type};
    }
    const previousRevision = db.prepare('SELECT revision FROM canvas_chats WHERE board_id=?').get(boardId)?.revision;
    const id = sendChatMessage(db,boardId,session.userId,input);
    void collectChatVideos(db,{scan:false}).catch(error=>console.error('Chat media cleanup failed:',error));
    if (db.prepare('SELECT revision FROM canvas_chats WHERE board_id=?').get(boardId)?.revision !== previousRevision) notifyChatChanged(boardId);
    sendJson(res,201,{id});
  } else if (req.method === 'POST' && match[2]==='read') {
    const input = await readJsonBody(req,1024);
    revalidate();
    if (markChatRead(db,boardId,session.userId,input.sequence)) notifyChatChanged(boardId,null,'read');
    const memberIds=account.getSharing(session.userId).members.filter(member=>member && account.canAccessBoard(member.id,boardId)).map(member=>member.id);
    sendJson(res,200,{ok:true,...chatReadStatus(db,boardId,session.userId,memberIds)});
  } else if (match[3] && (req.method === 'DELETE' && !match[4] || req.method === 'POST' && match[4]==='withdraw')) {
    const changed=changeChatMessage(db,boardId,session.userId,match[3],req.method === 'DELETE' ? 'hide' : 'withdraw');
    if(changed&&match[4])void collectChatVideos(db,{scan:false}).catch(error=>console.error('Chat media cleanup failed:',error));
    if(changed)notifyChatChanged(boardId,req.method === 'DELETE' ? session.userId : null);
    sendJson(res,200,{ok:true});
  } else sendJson(res,405,{error:'不支持的聊天操作'});
  return true;
}

export function canReadChatAsset(db,userId,assetId) {
  return chatStatement(db,`SELECT m.board_id,m.sequence FROM asset_references r JOIN chat_messages m ON m.id=r.owner_id
    WHERE r.owner_type='chat' AND r.asset_id=? AND m.withdrawn_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?)`)
    .all(assetId,userId).some(row => servicesRuntime.accountService.canAccessBoard(userId,row.board_id) && row.sequence>=chatHistory.chatHistoryStart(db,row.board_id,userId));
}
