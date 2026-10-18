import { refreshIcons } from './interface-model.js';
import { mountPushControl } from './push-notifications.js';
import { createDateWheel } from './date-wheel.js';
import { shiftMentions,mentionPayload } from './chat-feature-model.js';
import { CHAT_REACTION_CHOICES,chatReactionAppearance,applyChatReaction } from './chat-reactions-model.js';

const reactions=CHAT_REACTION_CHOICES.map(value=>value.id);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(name,action,cls='chat-feature-button')=>{const b=el('button',cls,name);b.type='button';b.addEventListener('click',action);return b;};
const icon=(name,glyph,action)=>{const b=button('',action,'chat-icon-button');b.title=name;b.setAttribute('aria-label',name);b.innerHTML=`<i data-lucide="${glyph}"></i>`;return b;};
function reactionArt(id){
  const value=chatReactionAppearance(id),art=el('span','chat-reaction-art');art.setAttribute('aria-hidden','true');
  art.append(el('span','chat-reaction-glyph',value.glyph));
  if(value.badge){const badge=el('span',`chat-reaction-badge is-${value.tone}`,value.badge);art.classList.toggle('has-top-badge',Boolean(value.above));art.append(badge);}
  return art;
}
export function createChatFeatures({panel,input,api,current,userId,roster,authors,getMessage,canTransfer=()=>true,onReactionChange=()=>{},onFilter,onNavigate,onTransfer,onMenu,feedback}){
  let data={},mode='messages',dialog=null,mentions=[],previous='',activeMention=null,mentionIndex=0,composing=false;
  let epoch=0,reactionView=null;
  const pending=new Map(),reactionSnapshots=new Map(),reactionErrors=new Map(),reactionPaintKeys=new WeakMap();
  const reactionKey=(id,emoji)=>`${id}:${emoji}`;
  const unavailable=message=>!message||message.deleted||message.withdrawnAt||message.matchesFilter===false;
  const hasReaction=(message,emoji,memberId)=>Boolean(message.reactions?.find(group=>group.emoji===emoji)?.userIds.includes(memberId));
  function clearReactionState(id){
    reactionSnapshots.delete(id);
    for(const [key,operation] of pending)if(operation.id===id){pending.delete(key);operation.controller.abort();}
    for(const [key,error] of reactionErrors)if(error.id===id)reactionErrors.delete(key);
  }
  function viewMessage(message){
    if(unavailable(message))return message;
    const snapshot=reactionSnapshots.get(message.id),operations=[...pending.values()].filter(operation=>operation.id===message.id);
    const errors=[...reactionErrors.values()].filter(error=>error.id===message.id);
    if(!snapshot&&!operations.length&&!errors.length)return message;
    let groups=snapshot&&snapshot.changedRevision>(message.changedRevision||0)?snapshot.reactions:message.reactions;
    for(const operation of operations)groups=applyChatReaction(groups,operation.emoji,operation.userId,operation.active);
    return {...message,reactions:groups,reactionPending:operations.map(({emoji,active})=>({emoji,active})),reactionErrors:errors.map(({emoji,active,error})=>({emoji,active,error}))};
  }
  const bar=el('nav','chat-feature-tabs');bar.setAttribute('aria-label','聊天视图');
  const tabs=[];
  for(const [key,name] of [['messages','消息'],['mentioned','提及我'],['attachment','附件']]){
    const b=button(name,()=>{mode=key;updateTabs();onFilter();});b.dataset.chatView=key;tabs.push(b);bar.append(b);
  }
  const filters=el('details','chat-filters'),summary=el('summary','chat-feature-button','筛选与提醒');
  const fields=el('div','chat-filter-fields');filters.append(summary,fields);
  const header=panel.querySelector('.chat-header');header.insertBefore(filters,header.lastChild);
  panel.addEventListener('click',event=>{if(filters.open&&!filters.contains(event.target))filters.open=false;});
  filters.addEventListener('keydown',event=>{if(event.key==='Escape'&&filters.open){event.preventDefault();event.stopPropagation();filters.open=false;summary.focus();}});
  const addField=(name,control)=>{const wrap=el('label');wrap.append(el('span','',name),control);fields.append(wrap);control.setAttribute('aria-label',name);return control;};
  const sender=addField('发送成员',el('select')),media=addField('附件类型',el('select'));
  sender.append(new Option('全部成员',''));for(const [value,name] of [['','所有类型'],['image','图片'],['video','视频']])media.append(new Option(name,value));
  const dateFields=[],closeDateFields=()=>dateFields.forEach(control=>control.close());
  const addDateField=name=>{const control=createDateWheel({label:name}),wrap=el('div','chat-date-field');dateFields.push(control);wrap.append(el('span','',name),control.root);fields.append(wrap);return control.input;};
  const from=addDateField('开始日期'),to=addDateField('结束日期');
  filters.addEventListener('toggle',()=>{if(!filters.open)closeDateFields();});
  const notification=addField('消息提醒',el('select'));for(const [value,name] of [['all','全部消息'],['mentions','仅提及我'],['none','关闭提醒']])notification.append(new Option(name,value));
  const reset=button('重置筛选',()=>{sender.value=media.value=from.value=to.value='';onFilter();},'chat-feature-button chat-filter-action chat-filter-reset');fields.append(reset);
  mountPushControl(fields,feedback);
  for(const control of [sender,media,from,to])control.addEventListener('change',()=>onFilter());
  notification.addEventListener('change',async()=>{const desired=notification.value,context=epoch;notification.disabled=true;try{await api('/preferences',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({notificationMode:desired})});if(context!==epoch)return;data.notificationMode=desired;onFilter(false);}catch(e){if(context===epoch&&e.name!=='AbortError'){notification.value=data.notificationMode||'all';feedback(e.message);}}finally{if(context===epoch){notification.disabled=false;notification.value=data.notificationMode||'all';}}});
  const info=el('div','chat-feature-info'),notice=button('',()=>openAnnouncement(false),'chat-announcement-preview'),edit=button('添加群公告',()=>openAnnouncement(true),'chat-feature-button chat-announcement-edit');
  info.append(notice,edit);panel.querySelector('.chat-members').after(info,bar);
  const picker=el('div','chat-mention-picker');picker.hidden=true;picker.id='chatMentionPicker';picker.setAttribute('role','listbox');picker.setAttribute('aria-label','选择提及成员');panel.querySelector('.chat-composer').append(picker);
  const mentionButton=icon('提及成员','at-sign',()=>{input.focus();input.setRangeText('@',input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));});panel.querySelector('.chat-composer-tools').prepend(mentionButton);
  input.setAttribute('aria-controls',picker.id);input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
  function updateTabs(){for(const tab of tabs)tab.setAttribute('aria-pressed',String(tab.dataset.chatView===mode));panel.querySelector('.chat-timeline').classList.toggle('chat-attachment-grid',mode==='attachment');}
  updateTabs();
  function getFilters(){
    const p=new URLSearchParams();if(mode==='mentioned')p.set('mentioned','1');
    if(sender.value)p.set('sender',sender.value);if(media.value||mode==='attachment')p.set('media',media.value||'attachment');
    if(from.value)p.set('from',String(new Date(`${from.value}T00:00:00`).getTime()));
    if(to.value){const end=new Date(`${to.value}T00:00:00`);end.setDate(end.getDate()+1);p.set('to',String(end.getTime()));}return p;
  }
  function sync(next){
    for(const message of next.messages||[]){
      if(unavailable(message)){clearReactionState(message.id);continue;}
      const snapshot=reactionSnapshots.get(message.id);
      if(snapshot&&(message.changedRevision||0)>=snapshot.changedRevision)reactionSnapshots.set(message.id,{id:message.id,changedRevision:message.changedRevision,reactions:message.reactions||[]});
      for(const [key,operation] of pending)if(operation.id===message.id&&operation.confirmed&&hasReaction(message,operation.emoji,operation.userId)===operation.active)pending.delete(key);
      for(const [key,error] of reactionErrors)if(error.id===message.id&&(message.changedRevision||0)>error.startedRevision&&hasReaction(message,error.emoji,error.userId)===error.active)reactionErrors.delete(key);
    }
    if(getMessage)for(const id of new Set([...reactionSnapshots.keys(),...[...pending.values()].map(operation=>operation.id),...[...reactionErrors.values()].map(error=>error.id)]))if(!getMessage(id))clearReactionState(id);
    data={...data,...next};const selected=sender.value,options=new Map(roster().map(member=>[member.id,member]));
    // Keep departed senders searchable without revealing any additional history.
    for(const user of data.senders||authors().values())if(!options.has(user.id))options.set(user.id,user);
    const key=JSON.stringify([...options.values()].map(m=>[m.id,m.username]));if(sender.dataset.roster!==key){sender.dataset.roster=key;sender.replaceChildren(new Option('全部成员',''));for(const member of options.values())sender.append(new Option(member.username||'已离开的成员',member.id));if(selected&&!options.has(selected))sender.append(new Option('已离开的成员',selected));sender.value=selected;}
    if(!notification.disabled)notification.value=data.notificationMode||'all';
    notice.textContent=data.announcement?.text?`公告 · ${data.announcement.text}`:'尚未设置群公告';notice.hidden=!data.announcement?.text;
    edit.textContent=data.announcement?.text?'编辑群公告':'添加群公告';
    edit.hidden=data.ownerId!==userId();edit.disabled=panel.querySelector('.chat-composer').hidden;
    info.hidden=notice.hidden&&edit.hidden;
    tabs[1].textContent=data.unreadMentionCount?`提及我 · ${data.unreadMentionCount}`:'提及我';
    if(reactionView){
      const incoming=next.messages?.find(message=>message.id===reactionView.message.id);
      if(incoming)reactionView.message=incoming;
      if(next.reset&&!incoming || reactionView.message.deleted || reactionView.message.withdrawnAt || reactionView.message.matchesFilter===false)closeDialog();else paintReactions(reactionView);
    }
  }
  function closeDialog(){const old=dialog;dialog=null;reactionView=null;old?.close();}
  function makeDialog(title){
    closeDialog();hideMentions();const d=el('dialog','chat-feature-dialog');dialog=d;d.setAttribute('aria-label',title);
    const head=el('header');head.append(el('strong','',title),icon('关闭','x',()=>d.close()));d.append(head);
    d.addEventListener('keydown',event=>event.stopPropagation());d.addEventListener('click',event=>{if(event.target===d)d.close();});
    d.addEventListener('close',()=>{d.remove();if(dialog===d){dialog=null;reactionView=null;}},{once:true});document.body.append(d);return d;
  }
  function openAnnouncement(editing){
    if(!current())return;const d=makeDialog(editing?'编辑群公告':'群公告'),announcement={...(data.announcement||{text:'',revision:0})},context=epoch;
    if(!editing){d.append(el('p','chat-announcement-content',announcement.text||'暂无公告'));if(data.ownerId===userId())d.append(button('编辑公告',()=>openAnnouncement(true)));}
    else{
      const form=el('form'),text=el('textarea'),status=el('p','chat-feature-error'),save=el('button','chat-create','保存公告'),reload=button('载入最新公告',async()=>{if(reload.disabled||save.disabled)return;reload.disabled=true;text.disabled=true;try{const latest=await api('?status=1');if(context!==epoch||!d.open)return;sync(latest);text.value=latest.announcement.text;announcement.revision=latest.announcement.revision;status.textContent='已载入最新公告';}catch(e){if(e.name!=='AbortError'&&d.open)status.textContent=e.message;}finally{reload.disabled=false;text.disabled=false;}});
      text.value=announcement.text;text.maxLength=2000;text.rows=7;text.setAttribute('aria-label','群公告内容');status.setAttribute('role','status');save.type='submit';reload.hidden=true;
      form.append(text,el('small','','所有当前画布成员均可查看公告，最多 2000 字。'),status,reload,save);d.append(form);
      form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled||text.disabled)return;save.disabled=true;text.disabled=true;reload.disabled=true;status.textContent='正在保存…';try{await api('/announcement',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({text:text.value,baseRevision:announcement.revision})});if(context!==epoch)return;d.close();onFilter(false);}catch(e){if(context===epoch&&e.name!=='AbortError'&&d.open){status.textContent=e.message;reload.hidden=e.code!=='CHAT_ANNOUNCEMENT_CONFLICT';}}finally{save.disabled=false;text.disabled=false;reload.disabled=false;}});
    }
    refreshIcons(d);d.showModal();
  }
  async function submitReaction(message,emoji,active){
    message=getMessage?getMessage(message.id):message;
    if(unavailable(message)||!current())return;
    const key=reactionKey(message.id,emoji);if(pending.has(key))return;
    const operation={id:message.id,emoji,active,userId:userId(),context:epoch,startedRevision:message.changedRevision||0,controller:new AbortController()};
    const valid=()=>operation.context===epoch&&operation.userId===userId()&&pending.get(key)===operation;
    pending.set(key,operation);reactionErrors.delete(key);closeDialog();onReactionChange();
    try{
      const result=await api(`/messages/${encodeURIComponent(message.id)}/reaction`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({emoji,active}),signal:operation.controller.signal});
      if(!valid())return;
      const snapshot=result.reaction,previous=reactionSnapshots.get(message.id);
      if(snapshot?.id===message.id&&Number.isSafeInteger(snapshot.changedRevision)&&Array.isArray(snapshot.reactions)){
        if(!previous||snapshot.changedRevision>=previous.changedRevision)reactionSnapshots.set(message.id,snapshot);
        pending.delete(key);
      }else{
        // Older servers return only ok; hold the projection until a fresh read confirms it.
        operation.confirmed=true;
        if(hasReaction(getMessage?.(message.id)||message,emoji,operation.userId)===active)pending.delete(key);
        else onFilter(false);
      }
    }catch(error){
      if(!valid())return;
      pending.delete(key);
      const latest=getMessage?getMessage(message.id):message;
      if(!unavailable(latest)){
        const confirmed=viewMessage(latest),revision=Math.max(latest.changedRevision||0,reactionSnapshots.get(message.id)?.changedRevision||0);
        if(revision<=operation.startedRevision||hasReaction(confirmed,emoji,operation.userId)!==active){
          const text=['AbortError','TimeoutError'].includes(error.name)?'回应保存超时或中断，请重试':error.message;
          reactionErrors.set(key,{...operation,error:text});feedback(`回应未保存：${text}`);
        }
      }
    }finally{
      if(operation.context===epoch&&operation.userId===userId()){
        onReactionChange();
        if(reactionView)paintReactions(reactionView);
      }
    }
  }
  function reactionDialog(message){
    message=getMessage?getMessage(message.id):message;if(!message||message.deleted||message.withdrawnAt)return feedback('消息已不可用');
    const d=makeDialog('表情回应'),grid=el('div','chat-reaction-picker'),people=el('div'),status=el('p','chat-feature-error');status.setAttribute('role','status');
    reactionView={dialog:d,grid,people,status,message,key:''};d.append(grid,people,status);paintReactions(reactionView);refreshIcons(d);d.showModal();
  }
  function paintReactions(view){
    const {grid,people,status}=view,message=viewMessage(getMessage?.(view.message.id)||view.message),namesFor=group=>group.userIds.map(id=>authors().get(id)?.username||roster().find(member=>member.id===id)?.username||'已离开的成员');
    const key=JSON.stringify([message.reactions,(message.reactions||[]).map(namesFor),message.reactionPending,message.reactionErrors]);if(key===view.key)return;view.key=key;
    const focus=grid.contains(document.activeElement)?document.activeElement.dataset.reaction:null;grid.replaceChildren();people.replaceChildren();status.textContent=message.reactionErrors?.map(error=>error.error).join('；')||(message.reactionPending?.length?'正在保存回应…':'');
    const choices=[...reactions,...(message.reactions||[]).map(group=>group.emoji).filter(emoji=>!reactions.includes(emoji))];
    for(const emoji of choices){
      const group=message.reactions?.find(r=>r.emoji===emoji),active=group?.userIds.includes(userId());
      const b=button('',()=>{void submitReaction(message,emoji,!active);});b.append(reactionArt(emoji));b.dataset.reaction=emoji;
      b.disabled=pending.has(reactionKey(message.id,emoji))||!reactions.includes(emoji)&&!active;
      b.title=`${active?'取消':'添加'} ${emoji} 回应`;b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(Boolean(active)));grid.append(b);
    }
    for(const group of message.reactions||[]){const names=namesFor(group),row=el('p','chat-reaction-people');row.append(reactionArt(group.emoji),el('span','',names.join('、')));row.setAttribute('aria-label',`${group.emoji}：${names.join('、')}`);people.append(row);}
    if(focus)[...grid.children].find(control=>control.dataset.reaction===focus)?.focus({preventScroll:true});
  }
  function decorate(row,message,meta,body){
    if(message.withdrawnAt||message.delivery&&message.delivery!=='sent')return;
    if(message.mentions?.some(m=>m.userId===userId())){row.classList.add('chat-is-mentioned');meta.append(el('span','chat-mentioned-label','提及你'));}
    const actions=el('div','chat-message-actions');actions.append(icon('回应消息','smile',()=>reactionDialog(message)),icon('消息操作','ellipsis',event=>{const rect=event.currentTarget.getBoundingClientRect();onMenu(message,rect.left,rect.bottom);}));meta.append(actions);
    updateReactions(row,message,body);
    if(mode==='attachment')body.append(button('查看消息上下文',()=>onNavigate(message),'chat-attachment-context'));
  }
  function updateReactions(row,message,body=row.querySelector('.chat-message-body')){
    if(!body)return;
    const namesFor=group=>group.userIds.map(id=>authors().get(id)?.username||roster().find(member=>member.id===id)?.username||'已离开的成员').join('、');
    const key=JSON.stringify([message.reactions,(message.reactions||[]).map(namesFor),message.reactionPending,message.reactionErrors]);
    if(reactionPaintKeys.get(row)===key)return;reactionPaintKeys.set(row,key);
    let groupHost=body.querySelector('.chat-reactions');
    if(message.reactions?.length||message.reactionPending?.length||message.reactionErrors?.length){
      if(!groupHost){groupHost=el('div','chat-reactions');(body.querySelector('.chat-message-content')||body).append(groupHost);}
      groupHost.replaceChildren();
      for(const group of message.reactions||[]){
        const b=button('',()=>reactionDialog(message),'chat-reaction');b.append(reactionArt(group.emoji),el('span','chat-reaction-count',String(group.userIds.length)));
        const names=namesFor(group);
        b.classList.toggle('is-me',group.userIds.includes(userId()));
        b.classList.toggle('is-saving',Boolean(message.reactionPending?.some(operation=>operation.emoji===group.emoji)));
        b.setAttribute('aria-haspopup','dialog');
        b.title=`查看 ${group.emoji} 回应成员：${names}`;
        b.setAttribute('aria-label',`查看 ${group.emoji} 回应成员，${group.userIds.length} 人，${names}`);
        groupHost.append(b);
      }
      if(message.reactionPending?.length){const status=el('span','chat-reaction-status','正在保存…');status.setAttribute('role','status');groupHost.append(status);}
      for(const error of message.reactionErrors||[]){const retry=button(`${error.emoji} 未保存 · 重试`,()=>{void submitReaction(message,error.emoji,error.active);},'chat-reaction-retry');retry.title=error.error;retry.setAttribute('aria-label',`重试 ${error.emoji} 回应`);groupHost.append(retry);}
    }else groupHost?.remove();
  }
  function renderText(host,text,values,highlight){
    let offset=0;for(const mention of values||[]){if(mention.start<offset||mention.end>text.length)continue;
      const plain=el('span');highlight(plain,text.slice(offset,mention.start));host.append(plain);
      const token=el('span',`chat-mention${mention.userId===userId()?' is-me':''}`);highlight(token,text.slice(mention.start,mention.end));host.append(token);offset=mention.end;
    }const tail=el('span');highlight(tail,text.slice(offset));host.append(tail);
  }
  function menuActions(message){
    const actions=[['表情回应','smile',()=>reactionDialog(message)]];
    if(canTransfer()){actions.push(['生成便签','sticky-note',()=>onTransfer('sticky',message)],['加入笔记','notebook-pen',()=>onTransfer('note',message)]);
      if(window.MusePlanning?.enabled)actions.push(['创建任务','list-checks',()=>onTransfer('task',message)]);}return actions;
  }
  function hideMentions(){picker.hidden=true;activeMention=null;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function pick(member){
    if(!activeMention)return;const start=activeMention.start,token=`@${member.username}`,old=input.value;
    input.setRangeText(`${token} `,start,input.selectionStart,'end');mentions=shiftMentions(old,input.value,mentions);mentions.push({userId:member.id,start,end:start+token.length,token});mentions.sort((a,b)=>a.start-b.start);previous=input.value;hideMentions();input.focus();
  }
  function updateMentions(){
    mentions=shiftMentions(previous,input.value,mentions);previous=input.value;
    if(composing||input.selectionStart!==input.selectionEnd){hideMentions();return;}
    const text=input.value.slice(0,input.selectionStart),match=/(?:^|\s)@([^@\n]{0,40})$/u.exec(text);
    if(!match||mentions.some(m=>input.selectionStart>m.start&&input.selectionStart<=m.end)){hideMentions();return;}
    const members=roster().filter(m=>(m.username||'').toLocaleLowerCase().includes(match[1].toLocaleLowerCase()));if(!members.length){hideMentions();return;}
    activeMention={start:input.selectionStart-match[1].length-1,members};mentionIndex=Math.min(mentionIndex,members.length-1);picker.replaceChildren();
    for(const [index,member] of members.entries()){const b=button(`@${member.username}${member.id===userId()?'（你）':''}`,()=>pick(member),'chat-mention-option');b.id=`chatMention-${index}`;b.setAttribute('role','option');b.setAttribute('aria-selected',String(index===mentionIndex));b.addEventListener('pointerdown',event=>event.preventDefault());picker.append(b);}
    picker.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-activedescendant',`chatMention-${mentionIndex}`);
  }
  input.addEventListener('input',updateMentions);input.addEventListener('click',updateMentions);
  input.addEventListener('blur',hideMentions);input.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))updateMentions();});
  input.addEventListener('compositionstart',()=>{composing=true;hideMentions();});input.addEventListener('compositionend',()=>{composing=false;updateMentions();});
  input.addEventListener('keydown',event=>{if(picker.hidden||event.isComposing||event.keyCode===229)return;
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();mentionIndex=(mentionIndex+(event.key==='ArrowDown'?1:-1)+activeMention.members.length)%activeMention.members.length;updateMentions();}
    else if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();event.stopImmediatePropagation();pick(activeMention.members[mentionIndex]);}
    else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();hideMentions();}
  });
  return {sync,getFilters,viewMessage,decorate,updateReactions,renderText,menuActions,hideMentions,contains:target=>Boolean(dialog?.contains(target)),
    resetFilters(){closeDateFields();mode='messages';sender.value=media.value=from.value=to.value='';updateTabs();},
    mentionPayload:()=>mentionPayload(input.value,mentions),draft:()=>({mentions:[...mentions]}),restore:draft=>{mentions=draft?.mentions||[];previous=input.value;},clearMentions:()=>{mentions=[];previous=input.value;hideMentions();},
    dismiss(){closeDialog();hideMentions();filters.open=false;},
    close(){epoch++;closeDateFields();closeDialog();hideMentions();for(const operation of pending.values())operation.controller.abort();pending.clear();reactionSnapshots.clear();reactionErrors.clear();notification.disabled=false;mentions=[];previous='';data={};mode='messages';sender.value=media.value=from.value=to.value='';filters.open=false;updateTabs();info.hidden=true;},
    filtered:()=>getFilters().size>0,mode:()=>mode};
}
