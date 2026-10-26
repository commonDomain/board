export const sideUser=()=>window.MuseAccount?.session?.user?.id || '';
export const sideIdentity=()=>`${sideUser()}:${window.MuseAccount?.csrfToken?.()||''}`;
export function node(tag,cls,text) {
  const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;
}
export function action(text,run,cls='') {
  const el=node('button',cls,text);el.type='button';el.addEventListener('click',run);return el;
}
export async function sideApi(path,{body,bodyBytes,method='GET',signal,headers={},...rest}={}) {
  const owner=sideIdentity();
  const response=await fetch(path,{cache:'no-store',method,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)].filter(Boolean)),
    headers:{'x-csrf-token':window.MuseAccount?.csrfToken?.()||'',...(body!==undefined?{'content-type':'application/json'}:{}),...headers},
    ...(bodyBytes!==undefined?{body:bodyBytes}:body!==undefined?{body:JSON.stringify(body)}:{}),...rest});
  const data=await response.json();
  if(owner!==sideIdentity())throw new DOMException('账号已切换','AbortError');
  if(!response.ok)throw Object.assign(new Error(data.error||'操作失败，请重试'),{status:response.status});
  return data;
}
export function sideDialog(title,id) {
  const dialog=node('dialog','side-tool-dialog');dialog.id=id;dialog.setAttribute('aria-labelledby',`${id}-title`);
  const header=node('header','side-tool-header'),heading=node('h2','',title);heading.id=`${id}-title`;
  const close=action('关闭',()=>dialog.close(),'side-tool-close');header.append(heading,close);
  const body=node('div','side-tool-body'),status=node('p','side-tool-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  dialog.append(header,body,status);document.body.append(dialog);
  // Keep canvas keyboard shortcuts and pointer gestures outside this feature.
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('pointerdown',event=>event.stopPropagation());
  for(const type of ['paste','copy','cut','wheel','dragover','drop'])dialog.addEventListener(type,event=>{
    event.stopPropagation();if(type==='drop'||type==='dragover')event.preventDefault();
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
  const privacy=new MutationObserver(()=>{
    if(dialog.open&&document.documentElement.classList.contains('privacy-locked')){
      dialog.close();document.getElementById('privacyShield')?.focus({preventScroll:true});
    }
  });
  privacy.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  const feedback=text=>{status.textContent=text;};
  return {dialog,body,feedback};
}
