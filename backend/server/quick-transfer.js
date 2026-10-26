import { servicesRuntime } from './runtime/services.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { createMemoryRateLimiter } from './rate-limits.js';
import { clientIp,isOriginAllowed } from './http-security.js';
import { QuickTransferStore,TRANSFER_MAX } from './quick-transfer-store.js';

const store=new QuickTransferStore(),controls=createMemoryRateLimiter(30,60000),polls=createMemoryRateLimiter(120,60000);
const guestReads=createMemoryRateLimiter(240,60000),guestWrites=createMemoryRateLimiter(30,60000);
let maintenance=null;
export function startQuickTransferMaintenance() {
  if(maintenance)return;
  maintenance=setInterval(()=>{void store.sweep();},60000);maintenance.unref();
}
export async function stopQuickTransferMaintenance() {clearInterval(maintenance);maintenance=null;store.rooms.clear();}
function iceServers() {
  // STUN discovers routes only. No TURN or file-relay fallback.
  const urls=(process.env.QUICK_TRANSFER_STUN_URLS??'stun:stun.cloudflare.com:3478').split(',').map(v=>v.trim()).filter(v=>/^stun:[a-zA-Z0-9.\-:[\]]+(?:\?transport=udp)?$/.test(v)).slice(0,4);
  return urls.length?[{urls}]:[];
}
export async function handleQuickTransferApi(req,res,url) {
  if(url.pathname!=='/api/quick-transfer'&&!url.pathname.startsWith('/api/quick-transfer/'))return false;
  const account=servicesRuntime.accountService;
  // Guest access uses explicit high-entropy capabilities, never ambient cookies.
  // Custom headers + JSON also prevent cross-origin simple/form requests.
  if(req.headers.origin&&!isOriginAllowed(req,{requireOrigin:true})||req.headers['sec-fetch-site']==='cross-site')throw Object.assign(new Error('不允许跨站访问快传'),{statusCode:403});
  const limiter=req.method==='GET'?guestReads:guestWrites;
  if(!limiter(clientIp(req)))throw Object.assign(new Error('操作过于频繁，请稍后重试'),{statusCode:429});
  if(url.pathname==='/api/quick-transfer/config'&&req.method==='GET'){sendJson(res,200,{iceServers:iceServers(),maximum:TRANSFER_MAX});return true;}
  startQuickTransferMaintenance();
  if(url.pathname==='/api/quick-transfer'&&req.method==='POST') {
    const session=account.requireSession(req,{requireCsrf:true});
    if(!controls(session.userId))throw Object.assign(new Error('操作过于频繁，请稍后重试'),{statusCode:429});
    const body=await readJsonBody(req,48000);
    const fresh=account.requireSession(req,{requireCsrf:true});
    if(fresh?.tokenHash!==session.tokenHash)throw Object.assign(new Error('会话已失效'),{statusCode:401});
    if(body?.version!==3||Object.keys(body).some(key=>!['version','offer'].includes(key)))throw Object.assign(new Error('请刷新页面后重新生成配对二维码'),{statusCode:400});
    const {room,token,ownerToken}=await store.create(session.userId,body.offer);
    sendJson(res,201,{id:room.id,token,ownerToken,version:3,expiresAt:room.expiresAt});return true;
  }
  const part=url.pathname.match(/^\/api\/quick-transfer\/([a-f0-9]{32})(?:\/(answer))?$/);
  if(!part)throw Object.assign(new Error('快传不存在；文件分块接口已停用'),{statusCode:404});
  const room=store.get(part[1],req.headers['x-transfer-token']);
  if(req.method==='GET'&&!part[2]){
    if(url.searchParams.get('status')==='1'){
      const session=account.requireSession(req);
      if(!store.isOwner(room,session.userId,req.headers['x-transfer-owner']))throw Object.assign(new Error('仅发送端可以查看连接状态'),{statusCode:403});
      if(!polls(session.userId))throw Object.assign(new Error('操作过于频繁，请稍后重试'),{statusCode:429});
    }
    sendJson(res,200,url.searchParams.get('status')==='1'?{answer:room.answer,expiresAt:room.expiresAt}:{version:3,offer:room.offer,answer:room.answer,expiresAt:room.expiresAt});return true;
  }
  if(req.method==='POST'&&part[2]==='answer'){
    const body=await readJsonBody(req,34000);
    store.get(part[1],req.headers['x-transfer-token']);
    store.answer(room,body?.claim,body?.answer);sendJson(res,200,{ok:true});return true;
  }
  if(req.method==='DELETE'&&!part[2]){
    if(!store.isReceiver(room,req.headers['x-transfer-claim'])){
      if(!req.headers['x-transfer-owner'])throw Object.assign(new Error('仅发送端或已连接的接收端可以撤销'),{statusCode:403});
      const session=account.requireSession(req,{requireCsrf:true});
      if(!store.isOwner(room,session.userId,req.headers['x-transfer-owner']))throw Object.assign(new Error('撤销凭据无效'),{statusCode:403});
    }
    await store.remove(room);sendJson(res,200,{ok:true});return true;
  }
  throw Object.assign(new Error('不支持的操作'),{statusCode:405});
}
