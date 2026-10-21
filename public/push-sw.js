// Notification-only worker: no fetch handler or application/offline cache.
const appUrl=new URL('./',self.location.href);
function chatTarget(data){
  if(data?.feature==='gomoku')return {feature:'gomoku',...(/^[\w-]{1,64}$/.test(data.boardId||'')&&/^[0-9a-f-]{36}$/.test(data.gameId||'')?{boardId:data.boardId,gameId:data.gameId}:{})};
  const boardId=data?.boardId,sequence=data?.sequence;
  return /^[\w-]{1,128}$/.test(boardId||'')&&Number.isSafeInteger(sequence)&&sequence>0?{boardId,sequence}:null;
}
// Persist per-window handoff across worker suspension and slow page/login startup.
async function handoff(action){
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('muse-push-handoff',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('pending');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending');let value;
    action(store,result=>{value=result;});tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
async function deliver(client){
  const target=await handoff((store,done)=>{const request=store.get(client.id);request.onsuccess=()=>done(request.result);});
  if(!target)return;
  if(target.expiresAt<Date.now()){await handoff(store=>store.delete(client.id));return;}
  client.postMessage({type:'muse:push-open',...target});
}
self.addEventListener('message',event=>{
  const client=event.source;
  if(!client?.id||new URL(client.url).origin!==appUrl.origin||new URL(client.url).pathname!==appUrl.pathname)return;
  if(event.data?.type==='muse:push-ready')event.waitUntil(deliver(client));
  if(event.data?.type==='muse:push-ack')event.waitUntil(handoff(store=>{
    const request=store.get(client.id);request.onsuccess=()=>{if(request.result?.handoffId===event.data.handoffId)store.delete(client.id);};
  }));
});
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data={};try{data=event.data?.json()||{};}catch{}
    const target=chatTarget(data);
    await self.registration.showNotification('Museboard',{
      body:typeof data.body==='string'?data.body.slice(0,160):'你有新的画布消息',
      icon:new URL('favicon.png',appUrl).href,tag:typeof data.tag==='string'?data.tag.slice(0,100):'museboard-chat',
      data:target||{}
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=chatTarget(event.notification.data);
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    let client=windows.find(item=>new URL(item.url).origin===appUrl.origin&&new URL(item.url).pathname===appUrl.pathname);
    if(client)await client.focus();else client=await self.clients.openWindow(appUrl.href);
    if(!client||!target)return;
    await handoff(store=>{
      const cursor=store.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(row){if(row.value.expiresAt<Date.now())row.delete();row.continue();}};
      store.put({...target,handoffId:crypto.randomUUID(),expiresAt:Date.now()+3600000},client.id);
    });
    await deliver(client);
  })());
});
