import { sideUser,sideIdentity,sideApi,node,action,sideDialog } from './side-tools-ui.js';
import { QUICK_MAX,toUrl64,signalKey,sealSignal,openSignal,parseQuickLink,safeQuickName } from './quick-transfer-crypto.js';
import { createQuickPeer,localDescription,delay } from './quick-transfer-peer.js';
import { QuickTransferSession } from './quick-transfer-session.js';

export function initializeQuickTransfer({standalone=false}={}) {
  const {dialog,body,feedback}=sideDialog('跨设备快传','quickTransferDialog');
  const badge=node('div','quick-transfer-security','端到端加密 · 文件不经过服务器');
  const intro=node('div','quick-transfer-intro');
  const pairing=node('p','','任一设备登录后生成配对二维码，另一台免登录扫码，即可双向收发。');
  const guidelines=node('ul','quick-transfer-guidelines');
  const confirmation=node('li');confirmation.append('一次只连接',node('strong','','两台设备'),'；每个文件由',node('strong','','接收方确认保存'),'。');
  const limit=node('li');limit.append('单文件最多 ',node('strong','','100 MiB'),'。');
  const reminder=node('li');reminder.append('请保持两端',node('strong','','页面打开、设备亮屏、尽量处于同一网络中'),'。');
  guidelines.append(confirmation,limit,reminder);intro.append(pairing,guidelines);
  const setup=node('section','quick-transfer-section'),setupTitle=node('h3','',standalone?'请扫描已登录设备生成的配对二维码':'连接另一台设备');
  const create=action('生成配对二维码',()=>createPair(),'primary');create.hidden=standalone;
  setup.append(setupTitle,create);
  const output=node('div','quick-transfer-output');output.hidden=true;
  const qr=node('img','quick-transfer-qr');qr.alt='另一台设备扫码后可双向发送和接收文件';qr.hidden=true;
  const expiry=node('p','side-tool-muted');output.append(qr,expiry);
  const connectionInfo=node('p','quick-transfer-connection','尚未配对');connectionInfo.dataset.quickConnection='offline';connectionInfo.setAttribute('role','status');
  const workspace=node('div','quick-transfer-workspace');workspace.hidden=true;
  const sendArea=node('section','quick-transfer-section'),heading=node('h3','','发送到对方设备'),file=node('input');file.type='file';file.setAttribute('aria-label','选择要发送的文件');
  const selection=node('p','side-tool-muted','文件仅在对方主动接收后传输，不自动打开或执行。');
  const send=action('发送文件',()=>sendFile(),'primary');sendArea.append(heading,file,selection,send);
  const receiveArea=node('section','quick-transfer-section'),receiveHeading=node('h3','','接收对方文件'),details=node('p','quick-transfer-name','连接后可等待对方发送文件');
  const receiveActions=node('div','side-tool-row'),save=action('保存文件',()=>saveFile(),'primary'),decline=action('拒绝接收',()=>declineFile());save.hidden=true;decline.hidden=true;receiveActions.append(save,decline);receiveArea.append(receiveHeading,details,receiveActions);
  workspace.append(sendArea,receiveArea);
  const progress=node('progress');progress.max=100;progress.hidden=true;progress.setAttribute('aria-label','传输进度');
  const metrics=node('p','quick-transfer-metrics');metrics.hidden=true;
  const actions=node('div','side-tool-row quick-transfer-actions'),cancel=action('取消当前文件',()=>cancelFile()),disconnect=action('断开连接',()=>stop('连接已断开，请重新生成二维码配对'));cancel.hidden=true;disconnect.hidden=true;actions.hidden=true;actions.append(cancel,disconnect);
  body.append(badge,intro,setup,output,connectionInfo,workspace,progress,metrics);body.after(actions);
  let controller=null,generation=0,operation=0,room=null,peer=null,session=null,pending=null,writer=null,objectUrl=null,identity=sideIdentity();
  let connecting=false,working=false,fileCommitted=false,expiryTimer=null,startedAt=0,lastPaint=0;
  const tokenHeaders=target=>({'x-transfer-token':target.token,...(target.ownerToken?{'x-transfer-owner':target.ownerToken}:{}),...(target.claim?{'x-transfer-claim':target.claim}:{})});
  function api(target,path='',options={}) {return sideApi(`/api/quick-transfer${target?`/${target.id}`:''}${path}`,{...options,...(standalone?{credentials:'omit'}:{}),signal:controller?.signal,headers:{...options.headers,...(target?tokenHeaders(target):{})}});}
  function available(login=false) {
    if(login&&!sideUser()){dialog.close();window.MuseAccount?.showAuth?.();return false;}
    if(!window.isSecureContext||!crypto.subtle||!window.RTCPeerConnection){feedback('请使用 HTTPS 下支持 WebRTC 的新版浏览器进行安全直传');return false;}
    return true;
  }
  function check(version,op) {if(version!==generation||identity!==sideIdentity()||op!==undefined&&op!==operation)throw new DOMException('操作已取消','AbortError');controller?.signal.throwIfAborted();}
  function render() {
    const ready=!!session?.ready,occupied=working||!!session?.outgoing||!!session?.incoming;
    dialog.dataset.transferBusy=String(occupied);
    setup.hidden=!!controller;workspace.hidden=!ready;create.disabled=connecting;
    file.disabled=!ready||occupied;send.disabled=!ready||occupied||!file.files?.[0];
    save.hidden=!pending;decline.hidden=!pending;save.disabled=working||!ready;decline.disabled=working;
    cancel.hidden=!working||fileCommitted;disconnect.hidden=!controller;disconnect.textContent=ready?'断开连接':'取消配对';actions.hidden=!controller;
    progress.hidden=!working;metrics.hidden=!working&&metrics.textContent==='';
  }
  function hideQr() {output.hidden=true;qr.hidden=true;qr.removeAttribute('src');}
  function revoke() {if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
  async function remove(target) {if(target)await sideApi(`/api/quick-transfer/${target.id}`,{method:'DELETE',...(standalone?{credentials:'omit'}:{}),headers:tokenHeaders(target),body:{}}).catch(()=>{});}
  function stop(message='配对已取消') {
    const target=room;generation++;operation++;controller?.abort();controller=null;clearTimeout(expiryTimer);expiryTimer=null;
    session?.close();session=null;peer?.close();peer=null;
    if(writer){void writer.abort().catch(()=>{});writer=null;}
    room=null;pending=null;connecting=false;working=false;file.value='';details.textContent='等待对方发送文件';metrics.textContent='';progress.value=0;hideQr();
    connectionInfo.textContent='尚未配对';connectionInfo.dataset.quickConnection='offline';render();feedback(message);void remove(target);
  }
  function begin() {stop('');identity=sideIdentity();controller=new AbortController();connecting=true;connectionInfo.textContent='正在建立加密连接…';connectionInfo.dataset.quickConnection='connecting';render();return generation;}
  function phase(version,name) {
    check(version);
    const labels={preparing:'正在准备配对二维码…',waiting:'等待另一台设备扫码…',reading:'正在读取配对信息…',gathering:'正在获取设备网络地址…',submitting:'正在发送配对确认…',negotiating:'已收到配对确认，正在协商设备连接…',checking:'已交换连接信息，正在尝试设备直连…',securing:'直连已建立，正在建立加密通道…',verifying:'设备已连通，正在验证加密握手…'};
    connectionInfo.textContent=labels[name]||'正在连接设备…';connectionInfo.dataset.quickConnection=name;
  }
  function expireAt(time) {clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>stop('本次配对已到期，请重新扫码'),Math.max(0,time-Date.now()));}
  async function retry(run,version) {
    for(let attempt=0;;attempt++){
      check(version);try{return await run();}catch(error){if(attempt>=3||error.name==='AbortError'||error.status&&![429,502,503,504].includes(error.status))throw error;
        feedback('网络不稳定，正在重试连接…');await delay(Math.min(5000,700*2**attempt)+Math.random()*200,controller.signal);}
    }
  }
  function attach(connection,raw,role,version) {
    peer=connection.peer;
    session=new QuickTransferSession({...connection,raw,role,signal:controller.signal,
      onOffer:offer=>{if(version!==generation)return;pending=offer;details.textContent=`${offer.name} · ${formatSize(offer.size)}`;feedback('对方希望发送文件，请确认来源后保存或拒绝');render();},
      onIdle:message=>{if(version!==generation)return;operation++;pending=null;working=false;details.textContent='等待对方发送文件';feedback(message);render();},
      onError:error=>{if(version===generation)stop(error.message||'连接验证失败，请重新扫码');}
    });
    return session;
  }
  function paired(version) {check(version);connecting=false;hideQr();connectionInfo.textContent=`已连接 · 双向加密直传 · 有效至 ${new Date(room.expiresAt).toLocaleTimeString()}`;connectionInfo.dataset.quickConnection='connected';feedback('');render();}
  async function monitor(version,target) {
    try{while(version===generation){await delay(10000,controller.signal);await retry(()=>api(target,'?status=1'),version);check(version);}}
    catch(error){if(version===generation)stop(error.message||'授权已失效，请重新配对');}
  }
  async function createPair() {
    if(standalone||controller||!available(true))return;
    const version=begin();let created=null;
    try{
      phase(version,'preparing');const raw=crypto.getRandomValues(new Uint8Array(32)),prefix=crypto.getRandomValues(new Uint8Array(8)),signing=await signalKey(raw),config=await api(null,'/config');check(version);
      const connection=createQuickPeer(config.iceServers),active=attach(connection,raw,'host',version);
      phase(version,'gathering');
      const offer=await sealSignal(signing,'offer',await localDescription(peer,'offer',controller.signal));check(version);
      created=await api(null,'',{method:'POST',body:{version:3,offer}});check(version);room=created;expireAt(created.expiresAt);
      const url=new URL('quick-transfer.html',location.href);url.search='';url.hash=`quick=${created.id}.${created.token}.${toUrl64(raw)}.${toUrl64(prefix)}`;
      const {toDataURL}=await import('../vendor/quick-qr.js');
      const image=await toDataURL(url.href,{width:240,margin:2,errorCorrectionLevel:'M'});check(version);
      qr.src=image;qr.hidden=false;output.hidden=false;expiry.textContent=`有效至 ${new Date(created.expiresAt).toLocaleTimeString()}。仅限一台设备加入；连接后二维码失效。`;
      phase(version,'waiting');feedback('');
      let answer;
      for(;;){const data=await retry(()=>api(created,'?status=1'),version);check(version);if(data.answer){answer=data.answer;break;}await delay(2000,controller.signal);}
      const remote=await openSignal(signing,'answer',answer);check(version);
      phase(version,'negotiating');await Promise.all([peer.setRemoteDescription(remote),active.start({onStage:stage=>phase(version,stage)})]);paired(version);void monitor(version,created);
    }catch(error){if(version===generation)stop(error.message||'无法建立连接，请重试');else void remove(created);}
  }
  async function joinPair(value) {
    if(!available())return;
    let target;try{target=parseQuickLink(value,location.href);}catch(error){feedback(error.message);return;}
    const version=begin();
    try{
      phase(version,'reading');const data=await retry(()=>api(target),version);check(version);
      if(data.version!==3)throw new Error('请让已登录设备刷新页面，重新生成配对二维码');
      if(data.answer)throw new Error('此二维码已配对其他设备，请重新生成');
      if(!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now())throw new Error('配对二维码已过期');
      const config=await api(null,'/config');check(version);
      const connection=createQuickPeer(config.iceServers),active=attach(connection,target.raw,'guest',version),signing=await signalKey(target.raw);check(version);
      await peer.setRemoteDescription(await openSignal(signing,'offer',data.offer));check(version);
      phase(version,'gathering');
      const answer=await sealSignal(signing,'answer',await localDescription(peer,'answer',controller.signal));check(version);
      target={...target,expiresAt:data.expiresAt,claim:hex(crypto.getRandomValues(new Uint8Array(16)))};room=target;expireAt(data.expiresAt);
      phase(version,'submitting');await retry(()=>api(target,'/answer',{method:'POST',body:{claim:target.claim,answer}}),version);check(version);
      await active.start({onStage:stage=>phase(version,stage)});paired(version);
    }catch(error){if(version===generation)stop(error.message||'配对失败，请重新扫码');}
  }
  const hex=bytes=>Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
  function formatSize(size) {return size<1024*1024?`${(size/1024).toFixed(1)} KiB`:`${(size/1024/1024).toFixed(1)} MiB`;}
  function startFile() {working=true;fileCommitted=false;startedAt=performance.now();lastPaint=0;metrics.textContent='';progress.value=0;render();return ++operation;}
  function paint(bytes,total) {const now=performance.now();if(now-lastPaint<150&&bytes!==total)return;lastPaint=now;
    const elapsed=(now-startedAt)/1000,speed=elapsed>.2?bytes/elapsed:0,percent=Math.min(100,Math.floor(bytes/total*100));progress.value=percent;progress.setAttribute('aria-valuetext',`${percent}%`);
    metrics.hidden=false;metrics.textContent=`${percent}% · ${formatSize(bytes)} / ${formatSize(total)}${speed?` · ${formatSize(speed)}/s · 约剩 ${Math.ceil((total-bytes)/speed)} 秒`:''}`;}
  async function sendFile() {
    const source=file.files?.[0],active=session;if(!active?.ready||working||pending)return;
    if(!source||source.size<1||source.size>QUICK_MAX){feedback('请选择 1 字节至 100 MiB 的文件');return;}
    const version=generation,op=startFile();feedback('等待对方确认接收…');
    try{await active.sendFile(source,bytes=>{check(version,op);feedback('正在加密发送，等待对方写入确认…');paint(bytes,source.size);});check(version,op);file.value='';selection.textContent='可以继续选择文件，或接收对方文件';details.textContent='等待对方发送文件';feedback('对方已确认文件完整，并已保存或交给浏览器下载');}
    catch(error){if(version===generation&&op===operation)feedback(error.message||'文件传输失败，可重新发送');}
    finally{if(version===generation){if(op===operation)working=false;render();}}
  }
  async function saveFile() {
    const target=pending,active=session;if(!target||!active?.ready||working)return;
    if(!window.showSaveFilePicker&&target.size>32*1024*1024){feedback('此浏览器最多接收 32 MiB，可拒绝此文件或改用桌面 Chrome / Edge');return;}
    const version=generation,op=startFile();let sink=null;
    try{
      if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:target.name});check(version,op);sink=await handle.createWritable();check(version,op);writer=sink;}
      check(version,op);if(active.incoming!==target)throw new Error('对方已取消此文件');
      const parts=[];feedback('正在接收并校验…');
      await active.receiveFile(async bytes=>{check(version,op);if(sink)await sink.write(bytes);else parts.push(bytes);},async()=>{
        check(version,op);if(sink){await sink.close();sink=null;writer=null;}
        else{revoke();objectUrl=URL.createObjectURL(new Blob(parts,{type:'application/octet-stream'}));const address=objectUrl,a=node('a');a.href=address;a.download=target.name;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(address);if(objectUrl===address)objectUrl=null;},60000);}
        fileCommitted=true;render();
      },bytes=>{check(version,op);paint(bytes,target.size);});
      check(version,op);pending=null;details.textContent='文件接收完成，可以继续双向收发';feedback(window.showSaveFilePicker?'文件已完整校验并保存':'文件已完整校验并交给浏览器下载，请检查下载列表');
    }catch(error){if(version===generation&&op===operation){feedback(error.name==='AbortError'?'已取消保存，可以重新选择保存或拒绝':error.message||'接收失败');if(active.incoming!==target){pending=null;details.textContent='等待对方重新发送文件';}}}
    finally{if(sink)await sink.abort().catch(()=>{});if(writer===sink)writer=null;if(version===generation){if(op===operation)working=false;render();}}
  }
  async function declineFile() {try{await session?.decline();}catch(error){feedback(error.message);}}
  function cancelFile() {if(fileCommitted)return;operation++;session?.cancelFile();if(writer){void writer.abort().catch(()=>{});writer=null;}pending=null;details.textContent='当前文件已取消，等待对方发送文件';working=false;metrics.textContent='';feedback('当前文件已取消，设备连接保留');render();}
  file.addEventListener('change',()=>{const source=file.files?.[0];selection.textContent=source?`${safeQuickName(source.name)} · ${formatSize(source.size)}`:'选择文件发送到对方';render();});
  function open(pendingLink) {
    if(document.documentElement.classList.contains('privacy-locked'))return;
    if(identity!==sideIdentity()){stop('');identity=sideIdentity();}
    if(!dialog.open)dialog.showModal();if(pendingLink)void joinPair(pendingLink);render();
  }
  dialog.addEventListener('close',()=>{stop('面板已关闭，设备连接已断开');revoke();document.getElementById(standalone?'openQuickReceiver':'quickTransferButton')?.focus({preventScroll:true});});
  for(const event of ['muse:account-changing','muse:logout','muse:auth-expired'])window.addEventListener(event,()=>{stop('账号状态已变化，配对已结束');identity=sideIdentity();revoke();dialog.close();});
  window.addEventListener('pagehide',()=>{stop();revoke();});render();return {open};
}
