import { QUICK_CHUNK,seal,unseal } from './quick-transfer-crypto.js';

// At most 1 MiB of unacknowledged plaintext, enough to keep WAN links busy
// without letting a slow receiver grow an unbounded queue.
const WINDOW=64;
const networkError=()=>new Error('文件通道已中断或长时间无响应，请保持两端在线后重试；设备连接断开时请重新扫码配对');
export function delay(ms,signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason||new DOMException('已取消','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
export function waitUntil(target,event,predicate,signal,timeout=30000,timeoutError=networkError) {
  return new Promise((resolve,reject)=>{
    const events=Array.isArray(event)?event:[event];
    const finish=error=>{clearTimeout(timer);for(const type of events)target.removeEventListener(type,check);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    const check=()=>{try{if(predicate())finish();}catch(error){finish(error);}};
    const abort=()=>finish(signal.reason||new DOMException('已取消','AbortError'));
    const timer=setTimeout(()=>finish(timeoutError()),timeout);
    for(const type of events)target.addEventListener(type,check);signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();else check();
  });
}
export function quickConnectionError(peer) {
  const types=description=>[...new Set([...String(description?.sdp||'').matchAll(/\btyp (host|srflx|prflx|relay)\b/g)].map(match=>match[1]))];
  const local=types(peer.localDescription),remote=types(peer.remoteDescription);
  const bothPublic=local.includes('srflx')&&remote.includes('srflx');
  return Object.assign(new Error(bothPublic
    ?'两端已交换公网连接地址，但未能建立直连，可能受运营商 NAT 或防火墙限制。请让手机和电脑连接同一 Wi-Fi 后重新扫码'
    :'设备直连未能建立，可能是网络、STUN 或防火墙限制。请让两端连接同一 Wi-Fi、保持页面打开，并使用系统浏览器重新扫码'),{
    code:'QUICK_CONNECTION_FAILED',
    // Only state/type names; never log SDP, IP addresses, link tokens or keys.
    diagnostic:{iceState:peer.iceConnectionState,connectionState:peer.connectionState,localCandidateTypes:local,remoteCandidateTypes:remote}
  });
}
export async function waitForQuickChannel(peer,channel,signal,{timeout=30000,onStage=()=>{}}={}) {
  const pulse=new EventTarget();let previous='';
  const changed=()=>pulse.dispatchEvent(new Event('change'));
  for(const type of ['iceconnectionstatechange','connectionstatechange'])peer.addEventListener(type,changed);
  for(const type of ['open','close','error'])channel.addEventListener(type,changed);
  try{
    await waitUntil(pulse,'change',()=>{
      if(peer.connectionState==='failed'||peer.iceConnectionState==='failed'||peer.connectionState==='closed'||channel.readyState==='closed'||channel.readyState==='closing')throw quickConnectionError(peer);
      const stage=channel.readyState==='open'?'verifying':['connected','completed'].includes(peer.iceConnectionState)?'securing':peer.iceConnectionState==='checking'?'checking':'negotiating';
      if(stage!==previous){previous=stage;onStage(stage);}
      return channel.readyState==='open';
    },signal,timeout,()=>quickConnectionError(peer));
  }finally{
    for(const type of ['iceconnectionstatechange','connectionstatechange'])peer.removeEventListener(type,changed);
    for(const type of ['open','close','error'])channel.removeEventListener(type,changed);
  }
}
export function createQuickPeer(iceServers) {
  const peer=new RTCPeerConnection({iceServers,bundlePolicy:'max-bundle'});
  const channel=peer.createDataChannel('muse-quick-v2',{negotiated:true,id:0,ordered:true});
  channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=64*1024;
  return {peer,channel};
}
export async function localDescription(peer,role,signal) {
  await peer.setLocalDescription(await (role==='offer'?peer.createOffer():peer.createAnswer()));
  // Use gathered candidates; a slow/unreachable STUN service must not block LAN use.
  try{await waitUntil(peer,'icegatheringstatechange',()=>peer.iceGatheringState==='complete',signal,8000);}
  catch(error){if(signal.aborted)throw error;}
  signal.throwIfAborted();return {type:role,sdp:peer.localDescription.sdp};
}
function streamState(channel,signal) {
  const pulse=new EventTarget();let failure=null;
  const notify=()=>pulse.dispatchEvent(new Event('change'));
  const close=()=>{failure=networkError();notify();};
  channel.addEventListener('close',close);channel.addEventListener('error',close);
  return {
    notify,fail(error){failure=error;notify();},
    wait(predicate,timeout){return waitUntil(pulse,'change',()=>{if(failure)throw failure;return predicate();},signal,timeout);},
    dispose(){channel.removeEventListener('close',close);channel.removeEventListener('error',close);}
  };
}
async function opened(channel,signal) {
  await waitUntil(channel,['open','close','error'],()=>{if(channel.readyState==='closed'||channel.readyState==='closing')throw networkError();return channel.readyState==='open';},signal,30000);
}
async function send(channel,value,signal) {
  signal.throwIfAborted();
  if(channel.bufferedAmount>192*1024)await waitUntil(channel,['bufferedamountlow','close','error'],()=>{
    if(channel.readyState!=='open')throw networkError();return channel.bufferedAmount<=64*1024;
  },signal);
  if(channel.readyState!=='open')throw networkError();channel.send(value);
}
export async function sendQuickFile(channel,source,key,prefix,signal,onProgress) {
  const state=streamState(channel,signal);let started=false,saved=false,sent=0,ack=0;
  const message=event=>{
    try{
      if(typeof event.data!=='string'||event.data.length>256)throw new Error('接收确认无效');
      const data=JSON.parse(event.data);
      if(data.type==='start'&&!started)started=true;
      else if(data.type==='ack'&&Number.isSafeInteger(data.count)&&data.count>=ack&&data.count<=sent){ack=data.count;onProgress(Math.min(source.size,ack*QUICK_CHUNK));}
      else if(data.type==='saved'&&ack===Math.ceil(source.size/QUICK_CHUNK))saved=true;
      else throw new Error('接收确认无效');
      state.notify();
    }catch(error){state.fail(error);}
  };
  channel.addEventListener('message',message);
  try{
    await opened(channel,signal);await state.wait(()=>started);
    for(let offset=0,index=0;offset<source.size;offset+=QUICK_CHUNK,index++){
      await state.wait(()=>sent-ack<WINDOW);
      const bytes=await source.slice(offset,offset+QUICK_CHUNK).arrayBuffer();signal.throwIfAborted();
      const cipher=await seal(key,prefix,index+1,source.size,bytes);signal.throwIfAborted();
      const frame=new Uint8Array(4+cipher.byteLength);new DataView(frame.buffer).setUint32(0,index,false);frame.set(new Uint8Array(cipher),4);
      sent++;await send(channel,frame,signal);
    }
    await state.wait(()=>ack===sent);await send(channel,JSON.stringify({type:'done'}),signal);
    await state.wait(()=>saved,60000);
  }finally{channel.removeEventListener('message',message);state.dispose();}
}
export async function receiveQuickFile(channel,target,signal,write,finish,onProgress) {
  const state=streamState(channel,signal),queue=[];let total=0,index=0;
  const message=event=>{
    // The sender's window bounds queued ciphertext even while disk writes are slow.
    if(queue.length>=WINDOW+1||!(event.data instanceof ArrayBuffer)&&typeof event.data!=='string'||event.data.byteLength>16384||typeof event.data==='string'&&event.data.length>256){state.fail(new Error('传输队列或数据帧无效'));return;}
    queue.push(event.data);state.notify();
  };
  channel.addEventListener('message',message);
  try{
    await opened(channel,signal);await send(channel,JSON.stringify({type:'start'}),signal);
    for(;;){
      await state.wait(()=>queue.length>0);signal.throwIfAborted();const frame=queue.shift();
      if(typeof frame==='string'){
        if(JSON.parse(frame).type!=='done'||total!==target.size)throw new Error('文件不完整，已停止保存');
        await finish();signal.throwIfAborted();await send(channel,JSON.stringify({type:'saved'}),signal);
        // Let SCTP deliver the receipt before the receiver closes its connection.
        await delay(300,signal);return;
      }
      const expected=Math.min(QUICK_CHUNK,target.size-total);
      if(expected<=0||frame.byteLength!==expected+20||new DataView(frame).getUint32(0,false)!==index)throw new Error('文件顺序或长度校验失败');
      let plaintext;
      try{plaintext=await unseal(target.key,target.prefix,index+1,target.size,frame.slice(4));}catch{throw new Error('文件完整性校验失败，已停止保存');}
      signal.throwIfAborted();await write(plaintext);signal.throwIfAborted();total+=plaintext.byteLength;index++;
      onProgress(total);await send(channel,JSON.stringify({type:'ack',count:index}),signal);
    }
  }finally{channel.removeEventListener('message',message);state.dispose();queue.length=0;}
}
