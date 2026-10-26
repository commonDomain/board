import { QUICK_MAX,controlKey,sealControl,openControl,quickKey,toUrl64,fromBase64,safeQuickName } from './quick-transfer-crypto.js';
import { sendQuickFile,receiveQuickFile,waitUntil,waitForQuickChannel,quickConnectionError } from './quick-transfer-peer.js';

const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const cancelled=()=>new DOMException('文件传输已取消','AbortError');
const failure=()=>new Error('设备连接已断开，请重新扫码配对');

// One authenticated control channel, one bounded file operation at a time. A new
// key/nonce prefix and data channel are allocated for EVERY file, in either direction.
export class QuickTransferSession {
  constructor({peer,channel,raw,role,signal,onOffer=()=>{},onIdle=()=>{},onError=()=>{}}) {
    this.peer=peer;this.channel=channel;this.signal=signal;this.onOffer=onOffer;this.onIdle=onIdle;this.onError=onError;
    this.keys=Promise.all([controlKey(raw,role),controlKey(raw,role==='host'?'guest':'host')]);
    void this.keys.catch(error=>this.fail(error));
    this.pulse=new EventTarget();this.sequence=0;this.expected=0;this.incoming=null;this.outgoing=null;this.closed=false;this.hello=false;this.ready=false;this.retired=new Set();
    this.queued=0;this.processing=Promise.resolve();this.sending=Promise.resolve();this.lastMessage=Date.now();this.rate={start:Date.now(),count:0};
    this.message=event=>{
      if(this.closed)return;
      if(typeof event.data!=='string'||event.data.length>4096||++this.queued>32){this.fail(new Error('设备消息超出安全限制'));return;}
      this.processing=this.processing.then(async()=>{
        if(this.closed)return;
        const [,key]=await this.keys,value=await openControl(key,event.data);this.signal.throwIfAborted();
        if(!value||value.seq!==this.expected++)throw new Error('设备消息顺序校验失败');
        if(Date.now()-this.rate.start>10000)this.rate={start:Date.now(),count:0};
        if(++this.rate.count>100)throw new Error('设备消息过于频繁');
        this.lastMessage=Date.now();await this.handle(value);
      }).catch(error=>this.fail(error)).finally(()=>{this.queued--;});
    };
    this.closedChannel=()=>this.fail(this.ready?failure():quickConnectionError(this.peer));
    this.dataChannel=event=>{
      const current=this.incoming;
      if(!current?.accepted||current.channel||event.channel.label!==`file:${current.id}`){
        event.channel.close();if(!this.retired.has(event.channel.label.replace(/^file:/,'')))this.fail(new Error('未授权的文件通道'));return;
      }
      current.channel=event.channel;event.channel.binaryType='arraybuffer';event.channel.bufferedAmountLowThreshold=64*1024;this.notify();
    };
    this.abort=()=>this.close();
    channel.addEventListener('message',this.message);channel.addEventListener('close',this.closedChannel);channel.addEventListener('error',this.closedChannel);
    peer.addEventListener('datachannel',this.dataChannel);signal.addEventListener('abort',this.abort,{once:true});
    if(signal.aborted)this.close();
  }
  notify(){this.pulse.dispatchEvent(new Event('change'));}
  retire(id){this.retired.add(id);if(this.retired.size>32)this.retired.delete(this.retired.values().next().value);}
  check(){this.signal.throwIfAborted();if(this.closed)throw failure();}
  wait(predicate,signal=this.signal,timeout=30000){return waitUntil(this.pulse,'change',()=>{this.check();return predicate();},signal,timeout);}
  async start({onStage=()=>{},timeout=30000}={}) {
    await this.keys;this.check();
    await waitForQuickChannel(this.peer,this.channel,this.signal,{onStage,timeout});
    await this.send({type:'hello',version:3});
    await waitUntil(this.pulse,'change',()=>{this.check();return this.hello;},this.signal,10000,()=>Object.assign(new Error('设备已连通，但加密握手未完成。请刷新两端页面后重新扫码'),{code:'QUICK_HANDSHAKE_TIMEOUT'}));this.ready=true;
    this.heartbeat=setInterval(()=>{
      if(Date.now()-this.lastMessage>35000){this.fail(failure());return;}
      void this.send({type:'ping'}).catch(error=>this.fail(error));
    },10000);
  }
  send(value) {
    // Serialize encryption as well as send(), so async WebCrypto cannot reorder control messages.
    const task=this.sending.then(async()=>{
      this.check();if(this.channel.readyState!=='open'||this.channel.bufferedAmount>32768)throw failure();
      const [key]=await this.keys,frame=await sealControl(key,{...value,seq:this.sequence++});this.check();this.channel.send(frame);
    });
    this.sending=task.catch(error=>this.fail(error));return task;
  }
  async handle(value) {
    if(value.type==='hello'){
      if(this.hello||value.version!==3)throw new Error('设备协议不匹配');this.hello=true;this.notify();return;
    }
    if(!this.hello)throw new Error('设备尚未通过连接校验');
    if(value.type==='ping'){await this.send({type:'pong'});return;}
    if(value.type==='pong')return;
    if(!/^[a-f0-9]{32}$/.test(value.id||''))throw new Error('文件编号无效');
    if(value.type==='offer'){
      if(this.retired.has(value.id))throw new Error('文件编号不能重复使用');
      if(this.incoming||this.outgoing){await this.send({type:'reject',id:value.id,reason:'busy'});return;}
      if(typeof value.name!=='string'||value.name.length>180||!Number.isSafeInteger(value.size)||value.size<1||value.size>QUICK_MAX||typeof value.raw!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(value.raw)||typeof value.prefix!=='string'||!/^[-_A-Za-z0-9]{11}$/.test(value.prefix))throw new Error('文件信息无效');
      this.incoming={id:value.id,name:safeQuickName(value.name),size:value.size,key:await quickKey(fromBase64(value.raw)),prefix:fromBase64(value.prefix),accepted:false};
      this.onOffer(this.incoming);return;
    }
    if(value.type==='accept'){
      if(this.retired.has(value.id))return; // A save click can cross an in-flight cancellation.
      if(!this.outgoing||this.outgoing.id!==value.id||this.outgoing.accepted)throw new Error('文件确认无效');
      this.outgoing.accepted=true;this.notify();return;
    }
    if(value.type==='reject'){
      const message=value.reason==='busy'?'对方正在处理文件，请稍后再发送':value.reason==='declined'?'对方已拒绝此文件':'对方已取消此文件';
      if(this.outgoing?.id===value.id){this.outgoing.control.abort(new Error(message));this.notify();}
      if(this.incoming?.id===value.id){
        const current=this.incoming;if(current.control)current.control.abort(new Error(message));else{this.retire(current.id);this.incoming=null;this.onIdle(message);}
        this.notify();
      }
      return;
    }
    throw new Error('未知设备消息');
  }
  async sendFile(source,onProgress) {
    this.check();if(!this.ready||this.incoming||this.outgoing)throw new Error('请先完成配对或处理当前文件');
    if(!source||source.size<1||source.size>QUICK_MAX)throw new Error('请选择 1 字节至 100 MiB 的文件');
    const current={id:id(),control:new AbortController(),accepted:false,channel:null};this.outgoing=current;
    const signal=AbortSignal.any([this.signal,current.control.signal]);
    try{
      const raw=crypto.getRandomValues(new Uint8Array(32)),prefix=crypto.getRandomValues(new Uint8Array(8)),key=await quickKey(raw);signal.throwIfAborted();
      await this.send({type:'offer',id:current.id,name:safeQuickName(source.name),size:source.size,raw:toUrl64(raw),prefix:toUrl64(prefix)});
      await this.wait(()=>current.accepted,signal,120000);signal.throwIfAborted();
      current.channel=this.peer.createDataChannel(`file:${current.id}`,{ordered:true});current.channel.binaryType='arraybuffer';current.channel.bufferedAmountLowThreshold=64*1024;
      await sendQuickFile(current.channel,source,key,prefix,signal,onProgress);
    }catch(error){if(!this.closed)await this.send({type:'reject',id:current.id,reason:'cancelled'}).catch(()=>{});throw error;}
    finally{this.retire(current.id);current.channel?.close();if(this.outgoing===current)this.outgoing=null;this.notify();}
  }
  async receiveFile(write,finish,onProgress) {
    this.check();const current=this.incoming;
    if(!current||current.accepted||this.outgoing)throw new Error('没有待接收的文件');
    current.control=new AbortController();current.accepted=true;
    const signal=AbortSignal.any([this.signal,current.control.signal]);
    try{
      await this.send({type:'accept',id:current.id});await this.wait(()=>!!current.channel,signal);
      await receiveQuickFile(current.channel,current,signal,write,finish,onProgress);
    }catch(error){if(!this.closed)await this.send({type:'reject',id:current.id,reason:'cancelled'}).catch(()=>{});throw error;}
    finally{this.retire(current.id);current.channel?.close();if(this.incoming===current)this.incoming=null;this.notify();}
  }
  async decline() {
    const current=this.incoming;if(!current||current.accepted)return;
    this.retire(current.id);this.incoming=null;await this.send({type:'reject',id:current.id,reason:'declined'});this.onIdle('已拒绝此文件，可以继续双向传输');
  }
  cancelFile() {
    const current=this.outgoing||this.incoming;
    if(current?.control)current.control.abort(cancelled());else if(this.incoming)void this.decline().catch(error=>this.fail(error));
  }
  fail(error){if(this.closed)return;this.close();try{this.onError(error);}finally{this.channel.close();this.peer.close();}}
  close() {
    if(this.closed)return;this.closed=true;this.ready=false;clearInterval(this.heartbeat);
    this.outgoing?.control.abort(failure());this.incoming?.control?.abort(failure());
    this.outgoing?.channel?.close();this.incoming?.channel?.close();this.incoming=null;this.outgoing=null;
    this.channel.removeEventListener('message',this.message);this.channel.removeEventListener('close',this.closedChannel);this.channel.removeEventListener('error',this.closedChannel);
    this.peer.removeEventListener('datachannel',this.dataChannel);this.signal.removeEventListener('abort',this.abort);this.retired.clear();this.notify();
  }
}
