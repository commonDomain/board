import { state } from './state.js';
import { isPhoneViewer } from './phone-view-model.js';
import { upsertItem } from './items.js';
import { DEFAULT_NOTE_APPEARANCE } from './constants.js';
import { DEFAULT_NOTE_WIDTH, DEFAULT_NOTE_HEIGHT } from './note-sizing-model.js';
import { getWritableLayer } from './layers-model.js';
import { getBoardPointFromClient } from './camera.js';
import { focusSearchTarget } from './focus.js';
import { refreshIcons,showToast } from './interface-model.js';
import { chatSourceUrl } from './chat-feature-model.js';

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
let active=null;
export async function transferChatMessage({kind,boardId,userId,message,onLeave}){
  if(active)return;
  if(isPhoneViewer())throw new Error('手机当前为只读浏览，可在平板或电脑生成便签、笔记和任务');
  const operation={userId,controller:new AbortController(),invalid:false};
  const valid=()=>active===operation&&!operation.invalid&&window.MuseAccount?.session?.user?.id===userId;
  const assertCurrent=()=>{if(!valid())throw new DOMException('聊天复制已取消','AbortError');};
  const read=async()=>{
    assertCurrent();
    const response=await fetch(`/api/canvases/${encodeURIComponent(boardId)}/chat/messages/${encodeURIComponent(message.id)}/material`,{cache:'no-store',signal:AbortSignal.any([operation.controller.signal,AbortSignal.timeout(15000)])});
    const result=await response.json();if(!valid())throw new DOMException('账号已切换','AbortError');if(!response.ok)throw new Error(result.error||'原消息已不可访问');
    return {...result,source:{boardId,sequence:result.sequence},sourceUrl:chatSourceUrl(boardId,result.sequence),title:(result.text.trim()||result.reference?.label|| (result.image?'聊天图片':'聊天视频')).slice(0,200)};
  };
  read.assertCurrent=assertCurrent;
  active=operation;try{
    const material=await read();
    if(kind==='note'){onLeave();if(!window.MuseNotebook?.addChatMessage)throw new Error('笔记工作区暂不可用');await window.MuseNotebook.addChatMessage(material,read);return;}
    if(kind==='task'){onLeave();if(!window.MusePlanning?.enabled)throw new Error('规划功能未启用');await window.MusePlanning.createTaskFromChat(material,read);return;}
    const dialog=el('dialog','chat-feature-dialog chat-transfer-dialog');active.dialog=dialog;
    const title=el('h3','','生成画布便签'),form=el('form'),text=el('textarea'),error=el('p','chat-feature-error'),footer=el('div','chat-transfer-actions'),cancel=el('button','chat-feature-button','取消'),save=el('button','chat-create','生成便签');
    text.value=material.text||material.title;text.rows=6;text.maxLength=4000;text.setAttribute('aria-label','便签内容');cancel.type='button';save.type='submit';cancel.addEventListener('click',()=>dialog.close());error.setAttribute('role','status');footer.append(cancel,save);
    form.append(el('p','','便签保留原消息入口，沿用当前画布的共享范围。'),text,error,footer);dialog.append(title,form);document.body.append(dialog);refreshIcons(dialog);
    dialog.addEventListener('keydown',event=>event.stopPropagation());
    form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;
      try{await read();assertCurrent();if(!dialog.open)throw new DOMException('便签操作已取消','AbortError');if(state.boardId!==boardId||state.switchingCanvas||!getWritableLayer()||isPhoneViewer())throw new Error('画布已切换或当前图层不可编辑');if(!text.value.trim())throw new Error('请填写便签内容');
        const point=getBoardPointFromClient(innerWidth*.65,innerHeight*.45);
        // One upsert creates one undo operation and uses the normal durable canvas queue.
        const item={id:`note_${crypto.randomUUID().replaceAll('-','')}`,type:'note',...point,w:DEFAULT_NOTE_WIDTH,h:DEFAULT_NOTE_HEIGHT,z:++state.zCounter,rotation:0,text:text.value.trim(),fontSize:16,fontFamily:state.fontFamily,color:'#34313d',bold:false,align:'left',...DEFAULT_NOTE_APPEARANCE,chatSource:material.source};
        if(!upsertItem(item,{select:true}))throw new Error('便签未能创建，请检查画布权限');dialog.close();onLeave();focusSearchTarget(item,'item');showToast('已生成便签，可从便签菜单打开原消息');
      }catch(e){if(e.name!=='AbortError')error.textContent=e.message;}finally{save.disabled=false;}
    });
    await new Promise(resolve=>{dialog.addEventListener('close',()=>{dialog.remove();resolve();},{once:true});dialog.showModal();text.focus();});
  }finally{operation.controller.abort();if(active===operation)active=null;}
}
for(const name of ['muse:account-changing','muse:logout','muse:auth-expired'])window.addEventListener(name,()=>{if(active){active.invalid=true;active.controller.abort();active.dialog?.close();}});
