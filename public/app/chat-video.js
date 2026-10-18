import { refreshIcons } from './interface-model.js';

const el=(tag,cls,text)=>{const item=document.createElement(tag);if(cls)item.className=cls;if(text!==undefined)item.textContent=text;return item;};
const bytes=value=>value>=1024**3 ? `${(value/1024**3).toFixed(2)} GB` : `${(value/1024**2).toFixed(1)} MB`;
const duration=value=>`${Math.floor((value || 0)/60)}:${String(Math.floor((value || 0)%60)).padStart(2,'0')}`;
const videoExtension=/\.(mp4|mov|webm|m4v)$/i;
const videoMimeExtensions={'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','video/x-m4v':'m4v'};
export const isVideoFile=file=>videoExtension.test(file?.name || '') || Object.hasOwn(videoMimeExtensions,String(file?.type || '').toLowerCase());
export function normalizeChatVideoFile(file){
  if(!file || videoExtension.test(file.name || ''))return file;
  const extension=videoMimeExtensions[String(file.type || '').toLowerCase()];
  return extension ? new File([file],`${file.name?.replace(/\.[^.]*$/,'') || '粘贴视频'}.${extension}`,{type:file.type,lastModified:file.lastModified || Date.now()}) : file;
}

export function deletedVideoIcon(){
  const icon=el('span','chat-video-torn');icon.setAttribute('aria-hidden','true');
  icon.innerHTML='<svg viewBox="0 0 32 28" fill="none"><path d="M12 5H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7l3-5-5-4 5-4-3-5Zm8 0h2a2 2 0 0 1 2 2v4l5-3v12l-5-3v4a2 2 0 0 1-2 2h-3l3-5-5-4 5-4-2-5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';return icon;
}

export async function localVideoPoster(file,signal){
  const url=URL.createObjectURL(file),video=el('video');video.muted=true;video.preload='metadata';video.src=url;
  try{return await new Promise(resolve=>{
    let finished=false;const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);};
    const abort=()=>finish(null),timer=setTimeout(abort,8000);signal?.addEventListener('abort',abort,{once:true});
    video.onerror=abort;video.onloadedmetadata=()=>{video.currentTime=Math.min(.1,video.duration/2 || 0);};
    video.onseeked=()=>{try{const canvas=el('canvas'),scale=Math.min(1,320/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);finish({thumb:canvas.toDataURL('image/jpeg',.75),width:video.videoWidth,height:video.videoHeight,duration:video.duration});}catch{abort();}};
    if(signal?.aborted)abort();
  });}finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}

export function createChatVideoUI({api,isCurrent,onOpen,onChanged,onError}){
  let storage=null,player=null,manager=null,managerController=null,pendingTickets=null;
  const iconButton=(label,icon,action)=>{const b=el('button','chat-icon-button');b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=`<i data-lucide="${icon}"></i>`;b.addEventListener('click',action);return b;};
  function closePlayer(){const previous=player;player=null;previous?.dialog.close();}
  function closeManager(){const previous=manager;manager=null;managerController?.abort();managerController=null;pendingTickets=null;previous?.close();}
  function close(){closePlayer();closeManager();storage=null;}
  function sync(next){
    if(next)storage=next;
  }
  function view(info,messageId){
    if(!info)return;onOpen?.();closePlayer();const dialog=el('dialog','chat-video-player'),tools=el('div','chat-video-tools'),stage=el('div','chat-video-stage'),video=el('video'),hint=el('span','','压缩预览');
    dialog.setAttribute('aria-label',`播放视频：${info.name || ''}`);video.controls=true;video.playsInline=true;video.preload='metadata';video.poster=info.thumb || '';video.src=info.preview || info.original;
    if(info.width && info.height){video.style.setProperty('--video-width',`${info.width}px`);video.style.setProperty('--video-ratio',String(info.width/info.height));video.style.aspectRatio=`${info.width}/${info.height}`;}
    const original=el('button','chat-load-more','查看原视频');original.type='button';original.hidden=info.preview===info.original;
    let time=0;original.addEventListener('click',()=>{time=video.currentTime;video.pause();video.src=info.original;original.hidden=true;hint.textContent='原画质';});
    video.addEventListener('loadedmetadata',()=>{if(time){video.currentTime=Math.min(time,video.duration || time);time=0;}void video.play().catch(()=>{});});
    video.addEventListener('error',()=>{hint.textContent=original.hidden ? '浏览器无法播放该原视频，请尝试其他浏览器' : '视频加载失败，请重试';});
    tools.append(el('strong','',info.name || '视频'),hint,original,iconButton('关闭视频','x',()=>dialog.close()));stage.append(video);dialog.append(tools,stage);
    dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{video.pause();video.removeAttribute('src');video.load();dialog.remove();if(player?.dialog===dialog)player=null;},{once:true});document.body.append(dialog);player={dialog,messageId,videoId:info.id};refreshIcons(dialog);dialog.showModal();
  }
  function thumbnail(info,messageId){
    const b=el('button','chat-video-thumbnail');b.type='button';b.setAttribute('aria-label',`播放视频：${info.name || '视频'}`);
    if(info.thumb){const image=el('img');image.src=info.thumb;image.loading='lazy';image.decoding='async';image.alt='视频缩略图';
      if(info.width && info.height){const scale=Math.min(1,260/info.width,200/info.height);image.width=Math.max(1,Math.round(info.width*scale));image.height=Math.max(1,Math.round(info.height*scale));}
      image.addEventListener('error',()=>{image.hidden=true;b.classList.add('is-unavailable');});b.append(image);}
    const play=el('span','chat-video-play');play.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m9 5 11 7-11 7V5Z"/></svg>';b.append(play);
    if(info.duration)b.append(el('span','chat-video-duration',duration(info.duration)));b.addEventListener('click',()=>view(info,messageId));return b;
  }

  async function openManager(reached=false){
    if(!isCurrent())return;
    if(manager){manager.querySelector('.chat-video-manager-status').textContent=reached ? '原视频空间已达到上限，请保存并清理视频后继续上传。' : '';return;}
    const dialog=el('dialog','chat-video-manager');manager=dialog;const operationController=new AbortController();managerController=operationController;const signal=operationController.signal;
    dialog.setAttribute('aria-label','画布视频空间');const head=el('div','chat-video-tools');head.append(el('strong','','画布视频空间'),iconButton('关闭视频空间','x',closeManager));
    const usage=el('div','chat-video-usage'),status=el('p','chat-video-manager-status',reached ? '原视频空间不足，请保存并清理视频后继续上传。' : '正在读取视频…');status.setAttribute('role','status');
    const grid=el('div','chat-video-grid'),foot=el('div','chat-video-footer'),selectAll=el('button','chat-load-more','选择本页可清理视频'),save=el('button','chat-send-button','保存并删除云端数据');selectAll.type=save.type='button';save.disabled=true;
    const selection=el('span','chat-video-selection','未选择视频');foot.append(selectAll,selection,save);dialog.append(head,usage,status,grid,foot);
    let videos=[],selected=new Set(),shown=0,busy=false,more=null;
    const updateSelection=()=>{selection.textContent=selected.size ? `已选 ${selected.size} 个 · ${bytes(videos.filter(v=>selected.has(v.id)).reduce((n,v)=>n+v.bytes,0))}` : '未选择视频';save.disabled=busy || !selected.size;};
    const setBusy=value=>{busy=value;for(const item of dialog.querySelectorAll('input,button'))item.disabled=value;updateSelection();};
    const showMore=()=>{
      more?.remove();const batch=videos.slice(shown,shown+60);shown+=batch.length;
      for(const info of batch){const card=el('div','chat-video-card'),label=el('label','chat-video-select'),check=el('input');check.type='checkbox';check.disabled=!info.canDelete;check.dataset.videoId=info.id;check.setAttribute('aria-label',`选择 ${info.name}`);
        check.addEventListener('change',()=>{if(check.checked && selected.size>=40){check.checked=false;status.textContent='每次最多保存 40 个视频，请分批处理。';return;}check.checked ? selected.add(info.id) : selected.delete(info.id);updateSelection();});
        label.append(check,el('span','',info.name));card.append(thumbnail(info,info.messageId),label,el('small','',`${bytes(info.bytes)} · ${new Date(info.sentAt).toLocaleDateString('zh-CN')}${info.canDelete ? '' : ' · 仅发送者或画布所有者可清理'}`));grid.append(card);}
      if(shown<videos.length){more=el('button','chat-load-more',`显示更多视频（剩余 ${videos.length-shown} 个）`);more.type='button';more.addEventListener('click',showMore);grid.append(more);}refreshIcons(grid);
    };
    selectAll.addEventListener('click',()=>{for(const check of grid.querySelectorAll('input:not(:disabled)')){if(selected.size>=40)break;check.checked=true;selected.add(check.dataset.videoId);}updateSelection();});
    const finishDelete=async()=>{
      setBusy(true);try{
        const result=await api('/videos/downloads?tokens='+pendingTickets.map(t=>t.token).join(','),{signal});
        if(!result.complete)throw new Error('下载尚未完整完成，云端视频已保留。请检查下载后再确认。');
        await api('/videos/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tickets:pendingTickets.map(({id,token})=>({id,token})),saved:true}),signal});
        pendingTickets=null;closePlayer();closeManager();onChanged();
      }catch(error){if(!signal.aborted){status.textContent=error.message;setBusy(false);save.textContent='已保存，确认删除云端数据';}}
    };
    save.addEventListener('click',async()=>{
      if(pendingTickets){await finishDelete();return;}
      setBusy(true);let directory=null;
      try{
        // File picker is invoked in the click gesture before the first network await.
        if(window.showDirectoryPicker)directory=await window.showDirectoryPicker({mode:'readwrite'});
        const {tickets}=await api('/videos/downloads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:[...selected]}),signal});
        if(directory){let index=0;
          for(const ticket of tickets){status.textContent=`正在保存原视频 ${++index}/${tickets.length}：${ticket.name}`;
            const handle=await directory.getFileHandle(`${Date.now()}_${ticket.id.slice(0,8)}_${ticket.name}`,{create:true}),writable=await handle.createWritable();
            try{const response=await fetch(ticket.url,{signal,cache:'no-store',timeoutMs:600000});if(!response.ok || !response.body)throw new Error('视频下载失败，云端文件已保留');
              let received=0;for await(const chunk of response.body){received+=chunk.byteLength;await writable.write(chunk);}if(received!==ticket.bytes)throw new Error('视频下载不完整，云端文件已保留');await writable.close();
            }catch(error){await writable.abort().catch(()=>{});throw error;}
            const result=await api('/videos/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tickets:[{id:ticket.id,token:ticket.token}],saved:true}),signal});
            selected.delete(ticket.id);videos=videos.filter(video=>video.id!==ticket.id);grid.querySelector(`input[data-video-id="${ticket.id}"]`)?.closest('.chat-video-card')?.remove();updateSelection();
            usage.querySelector('span').textContent=`原视频 ${bytes(result.usedBytes)} / ${bytes(result.limitBytes)}`;usage.querySelector('progress').value=result.usedBytes;
            closePlayer();onChanged();
          }
          closeManager();
        }else{
          for(const ticket of tickets){const link=el('a');link.href=ticket.url;link.download=ticket.name;document.body.append(link);link.click();link.remove();}
          pendingTickets=tickets;status.textContent='已启动原视频下载。请确认浏览器中全部文件下载成功、已保存到本地，再点击下方确认按钮；关闭窗口将保留云端视频。';setBusy(false);for(const check of grid.querySelectorAll('input'))check.disabled=true;selectAll.disabled=true;save.textContent='已保存，确认删除云端数据';
        }
      }catch(error){if(!signal.aborted){status.textContent=error.name==='AbortError' ? '已取消保存，云端视频已保留' : error.message;setBusy(false);for(const check of grid.querySelectorAll('input'))check.disabled=!videos.find(v=>v.id===check.dataset.videoId)?.canDelete;}}
    });
    dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('close',()=>{operationController.abort();dialog.remove();if(manager===dialog){manager=null;managerController=null;pendingTickets=null;}},{once:true});document.body.append(dialog);refreshIcons(dialog);dialog.showModal();
    try{const data=await api('/videos',{signal});if(signal.aborted)return;videos=data.videos;storage=data;
      usage.append(el('span','',`原视频 ${bytes(data.usedBytes)} / ${bytes(data.limitBytes)}`),el('small','',`${videos.length} 个可见视频${data.reservedBytes ? ` · 上传预占 ${bytes(data.reservedBytes)}` : ''}`));
      const meter=el('progress');meter.max=data.limitBytes;meter.value=data.usedBytes;meter.setAttribute('aria-label','原视频空间使用量');usage.append(meter);
      if(!reached)status.textContent=videos.length ? '点击缩略图播放。每次可保存并清理最多 40 个视频。' : '这里会展示你有权查看的全部聊天视频。';showMore();updateSelection();
    }catch(error){if(!signal.aborted){status.textContent=error.message;onError?.(error);}}
  }
  return {sync,thumbnail,view,openManager,close,closePlayer,contains:target=>Boolean(player?.dialog.contains(target) || manager?.contains(target)),validate:messages=>{if(player?.messageId){const message=messages.get(player.messageId);if(!message || !message.video || message.videoDeletedAt || message.withdrawnAt)closePlayer();}},maxFileBytes:()=>storage?.maxFileBytes || 512*1024**2};
}
