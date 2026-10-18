const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const workerUrl=()=>new URL('push-sw.js',document.baseURI);
const identity=()=>`${window.MuseAccount?.session?.user?.id||''}:${window.MuseAccount?.csrfToken?.()||''}`;
const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
async function subscribe(manager,options){
  let timer;
  try{return await Promise.race([manager.subscribe(options),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('连接浏览器推送服务超时，请检查网络后重试')),20000);
  })]);}finally{clearTimeout(timer);}
}
async function request(method='GET',body){
  const owner=identity();
  const response=await fetch('/api/push/subscription',{method,cache:'no-store',signal:AbortSignal.timeout(15000),
    headers:{'content-type':'application/json','x-csrf-token':window.MuseAccount?.csrfToken?.()||''},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(owner!==identity())throw new Error('账号已切换，请重试');
  const data=await response.json();if(!response.ok)throw new Error(data.error||'通知设置失败');return data;
}
function active(registration){
  if(registration.active)return Promise.resolve(registration);
  return new Promise((resolve,reject)=>{
    const worker=registration.installing||registration.waiting;
    const timeout=setTimeout(()=>{worker?.removeEventListener('statechange',check);reject(new Error('通知服务启动超时，请重试'));},15000);
    function check(){if(worker.state==='activated'){clearTimeout(timeout);worker.removeEventListener('statechange',check);resolve(registration);}}
    worker?.addEventListener('statechange',check);if(worker)check();
  });
}
export function mountPushControl(container,feedback){
  const button=document.createElement('button');button.type='button';button.className='chat-feature-button chat-filter-action chat-push-toggle';
  button.textContent='开启桌面通知';container.append(button);
  let enabled=false,busy=false,revision=0;
  async function refresh(){
    if(busy)return;
    const version=++revision,owner=identity();
    const current=()=>!busy&&version===revision&&owner===identity();
    if(!supported()){button.disabled=true;button.textContent='当前环境不支持桌面通知';return;}
    try{
      const config=await request(),registration=await navigator.serviceWorker.getRegistration(workerUrl());
      const subscription=await registration?.pushManager.getSubscription();
      if(!current())return;
      enabled=Notification.permission==='granted'&&Boolean(subscription&&config.endpoints.includes(subscription.endpoint));
      button.disabled=!config.enabled&&!enabled;button.textContent=enabled?'关闭此浏览器桌面通知':!config.enabled?'桌面通知尚未配置':'开启桌面通知';
      if(enabled)void registration.update().catch(()=>{});
    }catch{if(current()){button.disabled=false;button.textContent='开启桌面通知';enabled=false;}}
  }
  button.addEventListener('click',async()=>{
    if(busy)return;busy=true;revision++;button.disabled=true;const owner=identity(),disabling=enabled;
    try{
      // Ask in the original click task; never prompt on page load.
      if(!disabling&&await Notification.requestPermission()!=='granted')throw new Error('请在浏览器的网站设置中允许通知');
      if(owner!==identity())throw new Error('账号已切换，请重试');
      const config=await request();if(!config.enabled&&!disabling)throw new Error('服务器尚未启用桌面通知');
      const registration=await active(await navigator.serviceWorker.register(workerUrl(),{updateViaCache:'none'}));
      let subscription=await registration.pushManager.getSubscription();
      if(owner!==identity())throw new Error('账号已切换，请重试');
      if(disabling){
        if(subscription){await request('DELETE',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
        feedback('已关闭此浏览器的桌面通知');
      }else{
        if(subscription&&String(new Uint8Array(subscription.options.applicationServerKey))!==String(bytes(config.publicKey))){await subscription.unsubscribe();subscription=null;}
        subscription ||= await subscribe(registration.pushManager,{userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
        if(owner!==identity())throw new Error('账号已切换，请重试');
        await request('PUT',subscription.toJSON());feedback('桌面通知已开启，关闭画布网页后仍可接收');
      }
    }catch(error){feedback(error.message||'无法开启桌面通知，请检查浏览器权限和网络');}
    finally{busy=false;button.disabled=false;void refresh();}
  });
  container.closest('details')?.addEventListener('toggle',()=>{if(container.closest('details').open)void refresh();});
  void refresh();
}
