import { state } from './state.js';
import { isPhoneViewer } from './phone-view-model.js';
import { refreshIcons, showToast } from './interface-model.js';
import { focusSearchTarget } from './focus.js';
import { createChatVideoUI,isVideoFile,normalizeChatVideoFile,localVideoPoster,deletedVideoIcon } from './chat-video.js';
import { createChatFeatures } from './chat-features.js';
import { transferChatMessage } from './chat-transfer.js';

const node = (tag, cls, text) => { const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el; };
const emojis = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','☺️',
  '🙂','🙃','😉','😍','🥰','😘','😋','😛','😜','🤪',
  '😎','🤓','🧐','🤔','🤨','😐','😶','🙄','😏','😌',
  '😔','😢','😭','🥹','🥺','😤','😡','🤬','😳','😱',
  '😨','😰','😥','😓','🤗','🤭','🫢','🤫','🤥','🫡',
  '🥱','😴','🤤','🤯','🥳','🤩','😇','🤠','🥴','🤒',
  '👍','👎','👏','🙌','🙏','🤝','💪','👌','✌️','🤞',
  '👋','🫶','🤟','🤘','👀','❤️','🧡','💛','💚','💙',
  '💜','🩷','💔','💕','💯','✅','🎉','🎊','✨','🌟',
  '🔥','💡','🚀','🎨','📝','📌','💬','☕','🌈','🍀',
  '😚','😙','😗','🥲','😑','😬','😮','😯','😲','😵',
  '😵‍💫','🫠','🫥','🤐','🤢','🤮','🤧','😷','🤕','😈',
  '👿','👻','💀','💩','🤡','👽','🤖','😺','😸','😹',
  '😻','😽','🙀','😿','😾','🙈','🙉','🙊','🐶','🐱',
  '🐼','🐻','🐰','🐯','🦊','🐷','🐸','🐣','🦋','🐝',
  '🌞','🌙','⭐','🌸','🌹','🌻','🌿','🍁','❄️','☀️',
  '🌧️','⛈️','⛄','🍎','🍊','🍋','🍌','🍉','🍇','🍓',
  '🍒','🍑','🥭','🍍','🥑','🍔','🍟','🍕','🍰','🎂',
  '🍦','🍫','🍬','🍩','🧋','🥛','🍵','🍺','🥂','🍷',
  '🎁','🎈','🏆','⚽','🏀','🎵','📱','💻','💰','🎯'
];
const label = user => user?.username || '已离开的成员';
const CHAT_TIME_GAP = 30 * 60 * 1000;
function iconButton(name,icon,action,cls='chat-icon-button') {
  const button=node('button',cls);button.type='button';button.title=name;button.setAttribute('aria-label',name);
  const glyph=node('i');glyph.dataset.lucide=icon;button.append(glyph);button.addEventListener('click',action);return button;
}
function avatar(user) {
  const el=node('span','chat-avatar');
  if (user?.avatarUrl) {const image=node('img');image.src=user.avatarUrl;image.alt='';image.loading='lazy';el.append(image);}
  else el.textContent=label(user).slice(0,1);
  el.dataset.online=String(Boolean(user?.online));el.title=`${label(user)} · ${user?.online ? '在线' : '离线'}`;return el;
}

export function initializeChat() {
  const dock=document.querySelector('#toolDock .toolbar-insert');if(!dock || document.getElementById('chatButton'))return;
  const trigger=iconButton('画布群聊','message-circle-more',()=>panel.hidden ? open() : close(),'tool-button');trigger.id='chatButton';trigger.append(node('span','tool-label','聊天'));trigger.setAttribute('aria-controls','canvasChat');trigger.setAttribute('aria-expanded','false');dock.insertBefore(trigger, document.getElementById('petButton'));
  const badge=node('span','chat-unread-badge');badge.hidden=true;badge.setAttribute('aria-hidden','true');trigger.append(badge);
  const reminder=node('div','chat-unread-reminder');reminder.hidden=true;reminder.setAttribute('role','status');document.body.append(reminder);
  const reminderText=node('span','chat-unread-reminder-text');reminder.append(reminderText);
  const menu=node('div','chat-context-menu');menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','消息操作');document.body.append(menu);
  const readPopover=node('section','chat-read-popover');readPopover.id='chatReadPopover';readPopover.hidden=true;readPopover.setAttribute('role','dialog');readPopover.setAttribute('aria-label','消息阅读状态');document.body.append(readPopover);
  const readTabs=node('div','chat-read-tabs'),readList=node('div','chat-read-list');readTabs.setAttribute('role','tablist');readTabs.setAttribute('aria-label','阅读状态');readList.id='chatReadMembers';readList.setAttribute('role','tabpanel');readList.tabIndex=0;readPopover.append(readTabs,readList);
  for(const [key,text] of [['read','已读'],['unread','未读']]){
    const tab=node('button','chat-read-tab');tab.type='button';tab.id=`chatReadTab-${key}`;tab.dataset.readTab=key;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',readList.id);tab.append(node('strong','','0'),node('span','',text));readTabs.append(tab);
    tab.addEventListener('click',()=>{if(readDetails){readDetails.tab=key;renderReadPopover();}});
  }
  const panel=node('section','canvas-chat');panel.id='canvasChat';panel.hidden=true;panel.setAttribute('aria-label','画布成员群聊');
  panel.innerHTML=`<header class="chat-header"><span class="chat-heading-icon"><i data-lucide="message-circle-more"></i></span><div><h2>画布群聊</h2><p class="chat-board-name"></p></div></header>
    <div class="chat-members" aria-label="群聊成员"></div>
    <div class="chat-search"><i data-lucide="search"></i><input type="search" maxlength="200" placeholder="搜索文字或 emoji…" aria-label="搜索聊天记录"></div>
    <div class="chat-status" role="status" aria-live="polite"></div>
    <div class="chat-timeline" role="log" aria-label="聊天记录" tabindex="0"></div>
    <div class="chat-new-message" hidden></div>
    <form class="chat-composer" hidden><div class="chat-reply-draft" hidden></div><div class="chat-element-draft" hidden></div><div class="chat-attachment" hidden></div>
      <textarea maxlength="4000" rows="3" aria-label="输入聊天消息" placeholder="与画布成员分享想法…"></textarea>
      <div class="chat-composer-tools"></div>
      <div class="chat-emoji-picker" hidden aria-label="常用聊天表情"></div><input class="chat-file" type="file" accept="image/png,image/jpeg,image/webp,.mp4,.mov,.webm,.m4v" hidden>
    </form>`;
  document.body.append(panel);
  const $=selector=>panel.querySelector(selector), timeline=$('.chat-timeline'), composer=$('.chat-composer'), input=$('textarea'), search=$('.chat-search input'), status=$('.chat-status');
  const locateLoading=node('div','chat-locate-loading');
  locateLoading.hidden=true;locateLoading.setAttribute('role','status');locateLoading.setAttribute('aria-live','polite');
  const locateSpinner=node('span','chat-locate-spinner');locateSpinner.setAttribute('aria-hidden','true');
  locateLoading.append(locateSpinner,node('span','','正在定位原消息…'));panel.append(locateLoading);
  function setLocateBusy(busy){locateLoading.hidden=!busy;timeline.setAttribute('aria-busy',String(busy));}
  const clearSearch=iconButton('清空搜索','x',()=>{search.value='';search.dispatchEvent(new Event('input'));search.focus();},'chat-icon-button chat-search-clear');
  clearSearch.hidden=true;$('.chat-search').append(clearSearch);
  $('.chat-header').append(iconButton('关闭群聊','x',()=>close()));
  const emojiButton=iconButton('选择表情','smile',()=>{$('.chat-emoji-picker').hidden=!$('.chat-emoji-picker').hidden;emojiButton.setAttribute('aria-expanded',String(!$('.chat-emoji-picker').hidden));});
  emojiButton.setAttribute('aria-expanded','false');
  const uploadButton=iconButton('添加图片或视频','paperclip',()=>$('.chat-file').click());
  const videoUI=createChatVideoUI({api,isCurrent:()=>current(),onOpen:()=>closeImageViewer(),onChanged:()=>load('initial'),onError:error=>{if([401,403,404].includes(error.status))load('initial');}});
  const sendButton=iconButton('发送消息','send',()=>send(),'chat-send-button');sendButton.append(node('span','','发送'));
  const cancelSend=iconButton('取消发送','x',()=>{sendController?.abort();});cancelSend.hidden=true;
  $('.chat-composer-tools').prepend(emojiButton,uploadButton);$('.chat-composer-tools').append(cancelSend,sendButton);
  for(const emoji of emojis) {const button=node('button','',emoji);button.type='button';button.setAttribute('aria-label',`插入 ${emoji}`);button.addEventListener('click',()=>{input.setRangeText(emoji,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));$('.chat-emoji-picker').hidden=true;emojiButton.setAttribute('aria-expanded','false');input.focus();});$('.chat-emoji-picker').append(button);}
  let boardId=null,controller=null,revision=null,before=null,messages=new Map(),authors=new Map(),members=[],reply=null,reference=null,file=null,preview=null,sending=false,query='',searchVersion=0,loading=false,renderKey='',newCount=0;
  let positions={},latestSequence=0,readBusy=false,attentionKey='',unreadCount=0,attentionBusy=false,attentionPending=false,queuedLoad=null,reminderTimer,readTimer,menuMessage=null;
  let generation=0,sendController=null,imageViewer=null,windowEnd=null,pollFailures=0,refreshTimer,contextSequence=null,readRefreshTimer;
  let readDetails=null;
  let fileVideo=null,posterController=null;
  let quotedSource=null;
  let mediaRequestVersion=0;
  let reeditTimer,reeditBusy=false;
  let attentionMentions=0,notificationMode='all';
  const rendered=new Map(),drafts=new Map(),outbox=new Map();
  let stickToBottom=true;
  const imageLayoutObserver=new ResizeObserver(()=>{if(current() && stickToBottom && !query && windowEnd===null)timeline.scrollTop=timeline.scrollHeight;});
  const draftKey=()=>`${userId()}:${boardId}`;
  const userId=()=>window.MuseAccount?.session?.user?.id;
  const current=()=>boardId===state.boardId && !panel.hidden && !window.__independentNotesActive && Boolean(userId());
  const features=createChatFeatures({panel,input,api,current,userId,roster:()=>members,authors:()=>authors,getMessage:id=>messages.get(id),canTransfer:()=>!isPhoneViewer(),
    feedback,onReactionChange:()=>render(),onFilter:(reset=true)=>{if(reset){searchVersion++;windowEnd=null;load('search');}else load();},
    onNavigate:navigateMessage,onMenu:openMessageMenu,onTransfer:(kind,message)=>{void transferChatMessage({kind,boardId,userId:userId(),message,onLeave:()=>close(false)}).catch(error=>{if(error.name!=='AbortError')showToast(error.message);});}});
  const filtered=()=>Boolean(query||features.filtered());
  let closingPreview=null;
  function showPanel(){closingPreview?.remove();closingPreview=null;panel.hidden=false;}
  function hidePanel(animate=true){
    if(!isPhoneViewer() && document.documentElement.dataset.formFactor!=='tablet' && !panel.hidden && animate && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      closingPreview?.remove();const previewPanel=panel.cloneNode(true);previewPanel.classList.add('chat-closing-preview');previewPanel.inert=true;previewPanel.setAttribute('aria-hidden','true');
      previewPanel.removeAttribute('id');for(const element of previewPanel.querySelectorAll('[id]'))element.removeAttribute('id');
      document.body.append(previewPanel);closingPreview=previewPanel;
      // cloneNode does not preserve scroll offsets; keep the visible history in place during dismissal.
      const sourceElements=[panel,...panel.querySelectorAll('*')],previewElements=[previewPanel,...previewPanel.querySelectorAll('*')];
      sourceElements.forEach((element,index)=>{if(element.scrollTop || element.scrollLeft){previewElements[index].scrollTop=element.scrollTop;previewElements[index].scrollLeft=element.scrollLeft;}});
      const removePreview=()=>{previewPanel.remove();if(closingPreview===previewPanel)closingPreview=null;};
      previewPanel.addEventListener('animationend',event=>{if(event.target===previewPanel)removePreview();});
      setTimeout(removePreview,240);
    }
    panel.hidden=true;
  }
  function feedback(text) {status.textContent=text;}
  async function api(path='',options={}) {
    const captured=boardId, owner=userId(), signal=controller?.signal;
    const response=await fetch(path.startsWith('/api/') ? path : `/api/canvases/${encodeURIComponent(captured)}/chat${path}`,{
      cache:'no-store',...options,timeoutMs:options.timeout || 20000,signal:AbortSignal.any([signal,options.signal,AbortSignal.timeout(options.timeout || 20000)].filter(Boolean)),headers:{'x-csrf-token':window.MuseAccount?.csrfToken?.() || '',...options.headers}
    });
    if(signal?.aborted || signal!==controller?.signal || captured!==boardId || captured!==state.boardId || owner!==userId())throw new DOMException('聊天已切换','AbortError');
    const data=await response.json();
    if(signal?.aborted || signal!==controller?.signal || captured!==boardId || captured!==state.boardId || owner!==userId())throw new DOMException('聊天已切换','AbortError');
    if(!response.ok)throw Object.assign(new Error(data.error || '聊天暂不可用'),{status:response.status,code:data.code});return data;
  }
  function releaseFile() {posterController?.abort();posterController=null;if(preview)URL.revokeObjectURL(preview);preview=null;file=null;fileVideo=null;$('.chat-attachment').hidden=true;$('.chat-attachment').replaceChildren();$('.chat-file').value='';}
  function removeOutgoing(id){const entry=outbox.get(id);if(!entry)return;if(imageViewer?.messageId===id)closeImageViewer();if(entry.localPreview)URL.revokeObjectURL(entry.localPreview);outbox.delete(id);}
  function close(restoreFocus=true,keepDraft=true) {
    clearTimeout(reeditTimer);
    setLocateBusy(false);
    videoUI.close();
    closeReadPopover();
    // Hiding the panel leaves the immutable send snapshot and its request alive.
    if(sending && keepDraft && boardId===state.boardId && !window.__independentNotesActive){
      hidePanel();trigger.setAttribute('aria-expanded','false');trigger.classList.remove('active');
      closeImageViewer();closeMessageMenu();hideEmoji();features.dismiss();clearTimeout(readTimer);
      const details=$('.chat-member-details');if(details)details.open=false;
      if(restoreFocus)trigger.focus();return;
    }
    if(boardId && keepDraft){
      const key=draftKey();drafts.delete(key);
      if(input.value || file || reply || reference || outbox.size)drafts.set(key,{text:input.value,file,reply,reference,...features.draft(),outgoing:[...outbox.values()].map(({localPreview,...entry})=>({...entry,image:entry.payload.image})),at:Date.now()});
      while(drafts.size>4)drafts.delete(drafts.keys().next().value);
    }
    hidePanel(keepDraft);if(!keepDraft){closingPreview?.remove();closingPreview=null;}
    closeImageViewer();quotedSource=null;imageLayoutObserver.disconnect();stickToBottom=true;sendController?.abort();sendController=null;for(const id of outbox.keys())removeOutgoing(id);
    closeMessageMenu();clearTimeout(readTimer);
    controller?.abort();controller=null;panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.classList.remove('active');
    boardId=null;messages.clear();rendered.clear();authors.clear();members=[];reply=null;reference=null;positions={};latestSequence=0;readBusy=false;revision=null;before=null;input.value='';search.value='';clearSearch.hidden=true;query='';searchVersion++;renderKey='';loading=false;queuedLoad=null;sending=false;windowEnd=null;releaseFile();
    hideEmoji();$('.chat-reply-draft').hidden=true;$('.chat-element-draft').hidden=true;$('.chat-new-message').hidden=true;newCount=0;
    features.close();
    timeline.replaceChildren();$('.chat-members').replaceChildren();setBusy(false);
    if(restoreFocus && !window.__independentNotesActive)trigger.focus();
  }
  async function open() {
    if(!userId()) {window.MuseAccount?.showAuth?.();showToast('登录后才能与画布成员聊天');return;}
    if(!state.boardId || state.switchingCanvas)return showToast('请先打开画布');
    if(sending && boardId===state.boardId && controller){showPanel();trigger.classList.add('active');trigger.setAttribute('aria-expanded','true');input.focus();load();return;}
    boardId=state.boardId;controller=new AbortController();showPanel();trigger.classList.add('active');trigger.setAttribute('aria-expanded','true');composer.hidden=true;search.disabled=true;
    const draft=drafts.get(draftKey());drafts.delete(draftKey());
    if(draft && Date.now()-draft.at<3600000){input.value=draft.text;features.restore(draft);if(draft.file)chooseFile(draft.file);setReply(draft.reply);setReference(draft.reference);
      for(const entry of draft.outgoing || []){if(entry.snapshot.file){entry.localPreview=URL.createObjectURL(entry.snapshot.file);if(isVideoFile(entry.snapshot.file)){entry.image=null;entry.video={...entry.snapshot.video,original:entry.localPreview,preview:entry.localPreview,name:entry.snapshot.file.name};}else entry.image=entry.localPreview;}if(entry.delivery==='sending'){entry.delivery='failed';entry.error='发送已中断，点击重试';}outbox.set(entry.id,entry);}}
    $('.chat-board-name').textContent=state.canvases.find(canvas=>canvas.id===boardId)?.name || '当前画布';feedback('正在打开群聊…');
    await load('initial');if(current())(composer.hidden ? timeline : input).focus();
  }
  function applyReadStatus(data) {
    // A receipt response may arrive after a newer push refresh. Reads never move backwards.
    positions=Object.fromEntries(Object.entries(data.positions || {}).map(([id,sequence])=>[id,Math.max(sequence,positions[id] || 0)]));
    const incomingLatest=data.latestSequence || 0;latestSequence=Math.max(latestSequence,incomingLatest);
    if((positions[userId()] || 0)>=latestSequence)updateUnread(0,0,data.notificationMode);
    else if(incomingLatest>=latestSequence)updateUnread(data.unreadCount || 0,data.unreadMentionCount || 0,data.notificationMode);
    features.sync({...data,unreadMentionCount:attentionMentions,notificationMode});
  }
  function apply(data,replace=false) {
    videoUI.sync(data.videoStorage);
    if(data.generation!==undefined && data.generation!==generation){generation=data.generation;for(const entry of outbox.values())if(entry.delivery==='sent')removeOutgoing(entry.id);}
    if(replace)messages.clear();
    for(const author of data.authors || [])authors.set(author.id,author);
    const memberHost=$('.chat-members'),nextMembers=data.members || [],membersChanged=JSON.stringify(members)!==JSON.stringify(nextMembers);members=nextMembers;
    if(membersChanged || !memberHost.children.length) {
    const memberListOpen=memberHost.querySelector('details')?.open;memberHost.replaceChildren();
    const stack=node('div','chat-member-stack');for(const member of members)stack.append(avatar(member));
    const onlineCount=members.filter(member=>member.online).length;
    const details=node('details','chat-member-details'),summary=node('summary'),list=node('div','chat-member-list');
    summary.append(node('span','chat-member-count',`${members.length} 位成员`),node('span',`chat-online-count${onlineCount?' has-online':''}`,`${onlineCount} 人在线`));
    summary.setAttribute('aria-label','查看群聊成员');const chevron=node('i');chevron.dataset.lucide='chevron-down';summary.append(chevron);
    const listHeading=node('div','chat-member-list-heading');listHeading.append(node('strong','','画布成员'),node('span','',`${members.length} 人`));list.append(listHeading);
    for(const member of members) {const row=node('div','chat-member-row'),name=node('span','chat-member-name',label(member));if(member.id===userId())name.append(node('small','chat-member-self','你'));const presence=node('small','chat-member-presence',member.online ? '在线' : '离线');presence.dataset.online=String(Boolean(member.online));row.append(avatar(member),name,presence);list.append(row);}
    details.open=Boolean(memberListOpen);details.append(summary,list);memberHost.append(stack,details);
    refreshIcons(memberHost);
    }
    for(const message of data.messages){removeOutgoing(message.id);message.deleted||message.matchesFilter===false ? messages.delete(message.id) : messages.set(message.id,message);}
    if(quotedSource){const update=data.messages.find(message=>message.id===quotedSource.id);if(update)quotedSource=update;if(data.reset)quotedSource=null;}
    const viewerMessages=new Map(quotedSource?[...messages,[quotedSource.id,quotedSource]]:messages);
    videoUI.validate(viewerMessages);
    if(imageViewer && (!viewerMessages.has(imageViewer.messageId) && !outbox.has(imageViewer.messageId) || viewerMessages.get(imageViewer.messageId)?.withdrawnAt || viewerMessages.get(imageViewer.messageId)?.deleted))closeImageViewer();
    applyReadStatus(data);
    if(menuMessage && (!messages.has(menuMessage.id) || messages.get(menuMessage.id).withdrawnAt))closeMessageMenu();
    if(reply){const source=data.messages.find(message=>message.id===reply.id);if(source){if(source.deleted||source.withdrawnAt)setReply(null,false);else setReply(source,false);}}
  }
  async function load(kind='poll') {
    if(!current())return;
    if(loading){queuedLoad=kind==='poll' ? queuedLoad || kind : kind;return;}
    loading=true;const captured=boardId,version=searchVersion,context=controller;
    const params=features.getFilters();if(query)params.set('q',query);
    if(kind==='older' && before)params.set('before',Math.min(before,...[...messages.values()].map(message=>message.sequence)));
    if(kind==='context' && contextSequence)params.set('around',contextSequence);
    if(kind==='poll' && revision!==null)params.set('since',revision);
    try {
      const data=await api(`?${params}`);if(version!==searchVersion)return;
      const nearBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<90, oldHeight=timeline.scrollHeight, oldTop=timeline.scrollTop;
      const added=data.messages.filter(message=>!messages.has(message.id)&&!message.deleted&&message.matchesFilter!==false&&message.sequence>latestSequence).length;
      apply(data,data.reset || ['initial','search','context'].includes(kind));if(kind!=='older')revision=data.revision;if(kind!=='poll' || data.reset)before=data.before;
      if(['initial','search','context'].includes(kind) || data.reset)windowEnd=null;
      if(kind==='older')windowEnd=Math.min(240,messages.size);
      if(kind==='older' || kind==='context')stickToBottom=false;
      const composerWasHidden=composer.hidden;composer.hidden=!data.exists;search.disabled=!data.exists;features.sync({...data,unreadMentionCount:attentionMentions,notificationMode});render(kind==='poll' && !data.reset);if(composerWasHidden && data.exists)input.focus();feedback(data.exists ? (filtered() ? `找到 ${data.totalMatches ?? messages.size} 条消息` : '仅当前画布成员可见') : '每个画布只能添加一个群聊');pollFailures=0;
      if(kind==='older')timeline.scrollTop=oldTop+timeline.scrollHeight-oldHeight;
      else if(kind==='initial' || kind==='search' || data.reset || nearBottom)timeline.scrollTop=timeline.scrollHeight;
      else if(added) {newCount+=added;renderNewMessages();}
      if(kind==='context'){
        const row=timeline.querySelector(`[data-chat-id="${CSS.escape([...messages.values()].find(message=>message.sequence===contextSequence)?.id || '')}"]`);
        row?.scrollIntoView({block:'center'});row?.focus({preventScroll:true});
        for(const highlighted of timeline.querySelectorAll('.is-located'))highlighted.classList.remove('is-located');
        if(row){row.classList.remove('is-entering');void row.offsetWidth;row.classList.add('is-located');}
      }
      scheduleRead();
    } catch(error) {if(error.name!=='AbortError' && captured===boardId && current()) {
      if(kind==='context'&&error.status===404){contextSequence=null;queuedLoad='initial';showToast('原消息已删除、隐藏或超出可查看的历史范围');return;}
      pollFailures++;feedback(`${error.message} · 将自动重试`);if([401,403,404].includes(error.status)){close(false,false);drafts.clear();showToast(error.message);}}}
    finally {if(context===controller){loading=false;const next=queuedLoad;queuedLoad=null;if(kind==='context' && next!=='context')setLocateBusy(false);if(next && current())queueMicrotask(()=>load(next));}}
  }
  function renderNewMessages() {const host=$('.chat-new-message');host.hidden=!newCount;host.replaceChildren();host.append(node('span','',`${newCount} 条新消息`),iconButton('查看新消息','arrow-down',()=>{windowEnd=null;renderKey='';render();timeline.scrollTop=timeline.scrollHeight;newCount=0;renderNewMessages();}));refreshIcons(host);}
  function render(animateMessages=false) {
    clearTimeout(reeditTimer);
    const all=[...messages.values()].sort((a,b)=>a.sequence-b.sequence),end=Math.min(windowEnd ?? all.length,all.length),start=Math.max(0,end-240),entries=all.slice(start,end).map(message=>({...features.viewMessage(message),canReedit:canReedit(message)}));
    const nextExpiry=Math.min(...entries.filter(message=>message.canReedit).map(message=>message.reeditUntil));
    if(Number.isFinite(nextExpiry))reeditTimer=setTimeout(()=>{if(current())render();},Math.max(1,nextExpiry-Date.now()));
    if(windowEnd===null && !filtered())entries.push(...[...outbox.values()].filter(entry=>!messages.has(entry.id)));
    const key=JSON.stringify([entries,all.length,end,members,[...authors.values()].map(({id,username,avatarUrl,online})=>[id,username,avatarUrl,online]),positions,before,composer.hidden,query,features.mode()]);if(key===renderKey)return;renderKey=key;
    const scrollTop=timeline.scrollTop,focused=document.activeElement?.closest('[data-chat-id]'),focusLabel=document.activeElement?.getAttribute('aria-label'),desired=[];
    if(composer.hidden) {
      const empty=node('div','chat-empty');empty.innerHTML='<span class="chat-empty-icon"><i data-lucide="message-circle-more"></i></span><h3>让灵感在交流中生长</h3><p>与画布成员分享文字、表情和图片。<br>所有讨论保存在这块画布中。</p>';
      const create=node('button','chat-create','添加画布群聊');create.type='button';create.addEventListener('click',async()=>{create.disabled=true;try{await api('',{method:'PUT'});await load('initial');input.focus();}catch(error){if(error.name!=='AbortError'){feedback(error.message);create.disabled=false;}}});empty.append(create);desired.push(empty);
    } else {
      if(before || start>0) {const more=node('button','chat-load-more','加载更早的消息');more.type='button';more.addEventListener('click',()=>{if(start>0){windowEnd=Math.max(240,end-80);renderKey='';render();timeline.scrollTop=0;}else load('older');});desired.push(more);}
      if(!entries.length) {const empty=node('div','chat-empty'),glyph=node('span','chat-empty-icon');glyph.innerHTML=`<i data-lucide="${query?'search':'message-circle-more'}"></i>`;empty.append(glyph);if(query)empty.append(node('h3','','没有找到匹配消息'));empty.append(node('p','',query ? '试试更短的文字，或直接输入 emoji' : '在这里分享想法，让协作更轻松。'));desired.push(empty);}
      let previousSentAt=null;
      for(const message of entries) {
        if(previousSentAt===null || message.sentAt-previousSentAt>CHAT_TIME_GAP){
          const sentAt=new Date(message.sentAt),time=node('time','chat-date');
          time.dateTime=sentAt.toISOString();time.textContent=`${sentAt.toLocaleDateString('zh-CN')} ${sentAt.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
          time.title=sentAt.toLocaleString('zh-CN');desired.push(time);
        }
        previousSentAt=message.sentAt;
        const {progress,delivery,error,reactions,reactionPending,reactionErrors,changedRevision,...content}=message;
        const contentKey=JSON.stringify([content,authors.get(message.senderId)?.username,authors.get(message.senderId)?.avatarUrl,authors.get(message.reply?.senderId)?.username,query,features.mode()]);
        const cached=rendered.get(message.id);
        if(cached?.key===contentKey){updateReceipt(cached.node,message);features.updateReactions(cached.node,message);desired.push(cached.node);continue;}
        const entering=!cached && !query && (message.delivery==='sending' || animateMessages && Date.now()-message.sentAt<60000);
        const user=authors.get(message.senderId),own=message.senderId===userId(),row=node('article',`chat-message${own?' is-own':''}${entering?' is-entering':''}`);row.dataset.chatId=message.id;
        row.addEventListener('animationend',event=>{
          if(event.target!==row)return;
          if(event.animationName==='chat-message-in')row.classList.remove('is-entering');
          if(event.animationName==='chat-message-locate')row.classList.remove('is-located');
        });
        if(message.withdrawnAt) {
          row.classList.add('is-withdrawn');row.append(node('span','',`${own?'你':label(user)}撤回了一条消息`));
          if(message.canReedit){const edit=node('button','chat-reedit','重新编辑');edit.type='button';edit.addEventListener('click',()=>void reedit(message));row.append(edit);}
          if(cached)imageLayoutObserver.unobserve(cached.node);rendered.set(message.id,{node:row,key:contentKey});desired.push(row);continue;
        }
        const body=node('div','chat-message-body'),meta=node('div','chat-message-meta');
        const contentHost=node('div','chat-message-content');
        if(message.video)contentHost.append(videoUI.thumbnail(message.video,message.id));
        if(message.reference)contentHost.append(referenceButton(message.reference));
        if(message.image) {const image=node('img','chat-message-image'),info=message.imageInfo;image.src=info?.thumb || message.image;image.alt='聊天图片';image.loading=message.delivery?'eager':'lazy';image.decoding='async';
          if(info?.width && info.height){const scale=Math.min(1,260/info.width,260/info.height);image.width=Math.max(1,Math.round(info.width*scale));image.height=Math.max(1,Math.round(info.height*scale));image.style.aspectRatio=`${info.width}/${info.height}`;}
          const view=node('button','chat-image-button');view.type='button';view.dataset.tooltipDisabled='true';view.setAttribute('aria-label','查看聊天图片');view.append(image);view.addEventListener('click',()=>{if(image.dataset.failed){image.dataset.failed='';image.src=info?.medium || message.image;return;}viewImage(message);});
          image.addEventListener('error',()=>{if(image.src.endsWith('.thumb.webp')){image.src=info?.medium || message.image;return;}if(!image.src.endsWith(message.image)){image.src=message.image;return;}image.dataset.failed='true';image.alt='图片加载失败，点击重试';view.title='图片加载失败，点击重试';});contentHost.append(view);}
        if(message.videoDeletedAt){const deleted=node('div','chat-video-deleted');deleted.append(deletedVideoIcon(),node('p','chat-message-text',message.text));contentHost.append(deleted);}
        else if(message.text) {const bubble=node('div','chat-bubble'),text=node('p','chat-message-text');features.renderText(text,message.text,message.mentions,highlight);if(/^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(message.text)&&[...message.text].length<20)text.classList.add('emoji-only');bubble.append(text);contentHost.append(bubble);}
        const receipt=own && message.delivery && message.delivery!=='sent' ? node('button','chat-delivery-status') : readReceiptButton(message);
        if(receipt.classList.contains('chat-delivery-status')){receipt.type='button';receipt.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="chat-progress-track" cx="10" cy="10" r="7.5"/><circle class="chat-progress-ring" cx="10" cy="10" r="7.5" pathLength="100"/><path class="chat-delivery-error" d="M10 6v5m0 2v.2"/></svg>';receipt.addEventListener('click',()=>{const entry=outbox.get(message.id);if(entry?.delivery==='failed'){receipt.blur();send(entry);}});}
        const line=node('div','chat-bubble-line');line.append(...(own?[receipt,contentHost]:[contentHost,receipt]));body.append(line);row.append(meta,avatar(user),body);
        if(message.reply){const quote=node('blockquote','chat-quote');appendReplyPreview(quote,message.reply,label(authors.get(message.reply.senderId)),message);body.append(quote);}
        features.decorate(row,message,meta,body);
        row.tabIndex=0;row.setAttribute('aria-label',`${label(user)}的消息，右键打开消息操作`);
        row.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();if(!outbox.has(message.id))openMessageMenu(message,event.clientX,event.clientY);});
        row.addEventListener('keydown',event=>{if(event.key==='ContextMenu' || event.key==='F10' && event.shiftKey){event.preventDefault();if(outbox.has(message.id))return;const rect=contentHost.getBoundingClientRect();openMessageMenu(message,rect.left+10,rect.bottom);}});
        updateReceipt(row,message);if(cached)imageLayoutObserver.unobserve(cached.node);imageLayoutObserver.observe(row);rendered.set(message.id,{node:row,key:contentKey});desired.push(row);
      }
      if(end<all.length){const newer=node('button','chat-load-more',`查看较新的消息（${all.length-end} 条）`);newer.type='button';newer.addEventListener('click',()=>{windowEnd=end+80>=all.length?null:end+80;renderKey='';render();timeline.scrollTop=timeline.scrollHeight;});desired.push(newer);}
    }
    const keep=new Set(desired);for(const child of [...timeline.children])if(!keep.has(child))child.remove();
    desired.forEach((child,index)=>{if(timeline.children[index]!==child)timeline.insertBefore(child,timeline.children[index] || null);});
    const visibleIds=new Set(entries.map(message=>message.id));for(const id of rendered.keys())if(!visibleIds.has(id)){imageLayoutObserver.unobserve(rendered.get(id).node);rendered.delete(id);}
    refreshIcons(panel);
    timeline.scrollTop=scrollTop;
    if(focused && !focused.isConnected){const row=timeline.querySelector(`[data-chat-id="${CSS.escape(focused.dataset.chatId)}"]`);(row?.querySelector(`[aria-label="${CSS.escape(focusLabel || '')}"]`) || row)?.focus({preventScroll:true});}
    renderReadPopover();
  }
  function highlight(host,text){if(!query){host.textContent=text;return;}const needle=query.toLowerCase(),folded=text.toLowerCase();let offset=0,index;while((index=folded.indexOf(needle,offset))>=0){host.append(document.createTextNode(text.slice(offset,index)),node('mark','',text.slice(index,index+query.length)));offset=index+query.length;}host.append(document.createTextNode(text.slice(offset)));}
  function receiptMembers(message) {
    const groups={read:[],unread:[]};
    for(const member of members)if(member.id!==message.senderId)groups[Number.isSafeInteger(message.sequence) && (positions[member.id] || 0)>=message.sequence ? 'read' : 'unread'].push(member);
    return groups;
  }
  function readReceiptButton(message) {
    const receipt=node('button','chat-read-receipt');receipt.type='button';receipt.dataset.tooltipDisabled='true';receipt.setAttribute('aria-haspopup','dialog');receipt.setAttribute('aria-controls',readPopover.id);receipt.setAttribute('aria-expanded','false');
    receipt.addEventListener('click',event=>{
      event.stopPropagation();
      if(readDetails?.id===message.id){closeReadPopover(true);return;}
      openReadPopover(message,receipt);
    });
    return receipt;
  }
  function closeReadPopover(restoreFocus=false) {
    const anchor=readDetails?.anchor;anchor?.setAttribute('aria-expanded','false');readDetails=null;readPopover.hidden=true;readList.replaceChildren();
    if(restoreFocus && anchor?.isConnected)anchor.focus({preventScroll:true});
  }
  function openReadPopover(message,anchor) {
    if(!current() || !Number.isSafeInteger(message.sequence) || !messages.has(message.id))return;
    if(readDetails?.id!==message.id){closeReadPopover();const groups=receiptMembers(message);readDetails={id:message.id,anchor,tab:groups.read.length ? 'read' : 'unread',key:''};}
    closeMessageMenu();hideEmoji();readPopover.hidden=false;anchor.setAttribute('aria-expanded','true');renderReadPopover();
    readTabs.querySelector('[aria-selected=true]')?.focus({preventScroll:true});
  }
  function positionReadPopover() {
    if(!readDetails)return;
    const bounds=readDetails.anchor.getBoundingClientRect(),rect=readPopover.getBoundingClientRect(),view=window.visualViewport;
    const left=(view?.offsetLeft || 0)+8,top=(view?.offsetTop || 0)+8,right=left+(view?.width || innerWidth)-16,bottom=top+(view?.height || innerHeight)-16;
    const x=bounds.right+10+rect.width<=right ? bounds.right+10 : bounds.left-rect.width-10;
    readPopover.style.left=`${Math.max(left,Math.min(x,right-rect.width))}px`;readPopover.style.top=`${Math.max(top,Math.min(bounds.top-20,bottom-rect.height))}px`;
  }
  function renderReadPopover() {
    if(!readDetails)return;
    const message=messages.get(readDetails.id),anchor=rendered.get(readDetails.id)?.node.querySelector('.chat-read-receipt');
    if(!current() || !message || message.withdrawnAt || !anchor?.isConnected){closeReadPopover();return;}
    readDetails.anchor=anchor;anchor.setAttribute('aria-expanded','true');const groups=receiptMembers(message);
    for(const tab of readTabs.children){const selected=tab.dataset.readTab===readDetails.tab;tab.querySelector('strong').textContent=String(groups[tab.dataset.readTab].length);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected ? 0 : -1;}
    readList.setAttribute('aria-labelledby',`chatReadTab-${readDetails.tab}`);
    const roster=groups[readDetails.tab],key=JSON.stringify([readDetails.tab,roster.map(member=>[member.id,member.username,member.avatarUrl])]);
    if(key!==readDetails.key){const scroll=readDetails.rosterTab===readDetails.tab ? readList.scrollTop : 0;readDetails.key=key;readDetails.rosterTab=readDetails.tab;readList.replaceChildren();
      if(!roster.length)readList.append(node('p','chat-read-empty',readDetails.tab==='read' ? '暂无已读成员' : '暂无未读成员'));
      else{const list=node('ul');for(const member of roster){const row=node('li','chat-read-member'),name=node('span','chat-read-name',label(member));name.title=label(member);const face=avatar(member);face.removeAttribute('title');row.append(face,name);list.append(row);}readList.append(list);}
      readList.scrollTop=scroll;
    }
    positionReadPopover();
  }
  readPopover.addEventListener('pointerdown',event=>event.stopPropagation());
  readPopover.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();closeReadPopover(true);return;}
    if(event.target.closest('[role=tab]') && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const key=event.key==='Home' ? 'read' : event.key==='End' ? 'unread' : readDetails.tab==='read' ? 'unread' : 'read';readTabs.querySelector(`[data-read-tab=${key}]`).click();readTabs.querySelector(`[data-read-tab=${key}]`).focus();}
  });
  function updateReceipt(row,message){const online=authors.get(message.senderId)?.online;const face=row.querySelector('.chat-avatar');if(face)face.dataset.online=String(Boolean(online));
    const indicator=row.querySelector('.chat-delivery-status');if(indicator){const state=message.delivery || 'sent';
      if(state==='sent'){indicator.replaceWith(readReceiptButton(message));updateReceipt(row,message);return;}
      indicator.dataset.state=state;indicator.dataset.mode=message.image || message.video ? 'progress':'spinner';indicator.style.setProperty('--send-progress',String(Math.round((message.progress || 0)*100)));
      const description=state==='failed' ? (message.error==='无法建立接口加密会话' ? '点击重试' : `${message.error || '发送失败'}，点击重试`) : (message.image || message.video ? `文件发送中，${Math.round((message.progress || 0)*100)}%` : '消息发送中');
      indicator.title=state==='sending'?'':description;indicator.dataset.tooltipDisabled=String(state==='sending');indicator.setAttribute('aria-label',description);indicator.tabIndex=state==='failed'?0:-1;row.dataset.delivery=state;return;}
    const receipt=row.querySelector('.chat-read-receipt');if(!receipt)return;
    row.dataset.delivery=message.delivery || 'sent';const groups=receiptMembers(message),count=groups.read.length;receipt.textContent=count?String(count):'';receipt.classList.toggle('has-readers',count>0);receipt.setAttribute('aria-label',`查看阅读人员：${count} 人已读，${groups.unread.length} 人未读`);receipt.disabled=!Number.isSafeInteger(message.sequence);
  }
  function closeImageViewer(){mediaRequestVersion++;imageViewer?.dialog.close();imageViewer=null;}
  function viewImage(message) {videoUI.closePlayer();closeImageViewer();const dialog=node('dialog','chat-image-viewer'),image=node('img'),tools=node('div','chat-image-tools'),hint=node('span','','正在加载图片…');image.alt='聊天图片';image.decoding='async';
    const source=message.imageInfo?.medium || message.image;
    let zoom=1,isOriginal=source===message.image;
    const original=node('button','chat-image-original','原图');original.type='button';original.title='查看原图';original.setAttribute('aria-label','查看原图');original.disabled=isOriginal;
    original.addEventListener('click',()=>{isOriginal=true;zoom=1;original.disabled=true;hint.hidden=false;hint.textContent='正在加载原图…';image.src=message.image;});
    const retry=node('button','chat-load-more','重试');retry.type='button';retry.hidden=true;retry.addEventListener('click',()=>{retry.hidden=true;hint.hidden=false;hint.textContent='正在重试…';const src=image.src;image.removeAttribute('src');image.src=src;});
    const stage=node('div','chat-image-stage'),imageContent=node('div','chat-image-content');
    let baseWidth=0,baseHeight=0;
    function paintImage(){
      if(!baseWidth)return;
      const width=Math.max(1,Math.round(baseWidth*zoom)),height=Math.max(1,Math.round(baseHeight*zoom));
      image.style.width=`${width}px`;image.style.height=`${height}px`;
      imageContent.style.width=`${width}px`;imageContent.style.height=`${height}px`;
    }
    function resizeImage(){
      if(!image.naturalWidth)return;
      const view=window.visualViewport,viewportWidth=view?.width || innerWidth,viewportHeight=view?.height || innerHeight;
      const maxWidth=Math.max(128,Math.min(viewportWidth-32,viewportWidth*.9)),maxHeight=Math.max(100,Math.min(viewportHeight-72,viewportHeight*.78));
      // Keep a comfortable landscape viewing surface even for small or tall images.
      // Wide images get more room; unused space stays white without stretching the image.
      const ratio=Math.max(1.5,Math.min(1.85,image.naturalWidth/image.naturalHeight));
      let stageHeight=Math.max(220,image.naturalHeight,image.naturalWidth/ratio),stageWidth=Math.max(360,stageHeight*ratio);
      const windowScale=Math.min(1,(maxWidth-2)/stageWidth,maxHeight/stageHeight);
      stageWidth=Math.round(stageWidth*windowScale);stageHeight=Math.round(stageHeight*windowScale);
      dialog.style.width=`${stageWidth+2}px`;
      stage.style.height=`${stageHeight}px`;
      const scale=Math.min(1,stageWidth/image.naturalWidth,stageHeight/image.naturalHeight);
      baseWidth=Math.max(1,Math.round(image.naturalWidth*scale));baseHeight=Math.max(1,Math.round(image.naturalHeight*scale));
      paintImage();
    }
    image.addEventListener('load',()=>{hint.hidden=true;retry.hidden=true;resizeImage();});
    image.addEventListener('error',()=>{if(!isOriginal){isOriginal=true;original.disabled=true;image.src=message.image;return;}hint.hidden=false;hint.textContent='原图加载失败';retry.hidden=false;resizeImage();});
    function zoomTo(value,x,y){
      if(!baseWidth)return;
      const bounds=stage.getBoundingClientRect(),before=image.getBoundingClientRect();
      x??=bounds.left+stage.clientWidth/2;y??=bounds.top+stage.clientHeight/2;
      const imageX=(x-before.left)/before.width,imageY=(y-before.top)/before.height;
      zoom=Math.max(.25,Math.min(5,value));paintImage();
      const after=image.getBoundingClientRect();
      stage.scrollLeft+=after.left+imageX*after.width-x;stage.scrollTop+=after.top+imageY*after.height-y;
      if(drag){drag.left=stage.scrollLeft;drag.top=stage.scrollTop;drag.x=drag.lastX;drag.y=drag.lastY;}
    }
    const zoomBy=amount=>zoomTo(zoom+amount);
    image.draggable=false;
    let drag=null;
    stage.addEventListener('pointerdown',event=>{
      if(event.button!==0 || !event.isPrimary)return;
      const bounds=stage.getBoundingClientRect();
      if(event.clientX>=bounds.left+stage.clientWidth || event.clientY>=bounds.top+stage.clientHeight)return;
      event.preventDefault();event.stopPropagation();
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};
      stage.setPointerCapture(event.pointerId);stage.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove',event=>{
      if(!drag || drag.id!==event.pointerId)return;
      event.preventDefault();stage.scrollLeft=drag.left+drag.x-event.clientX;stage.scrollTop=drag.top+drag.y-event.clientY;drag.lastX=event.clientX;drag.lastY=event.clientY;
    });
    const endDrag=event=>{if(!drag || drag.id!==event.pointerId)return;drag=null;stage.classList.remove('is-dragging');if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,endDrag);
    stage.addEventListener('wheel',event=>{event.preventDefault();event.stopPropagation();const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?stage.clientHeight:1);zoomTo(zoom*Math.exp(-Math.max(-120,Math.min(120,delta))*.002),event.clientX,event.clientY);},{passive:false});
    tools.append(hint,retry,original,iconButton('缩小图片','zoom-out',()=>zoomBy(-.25)),iconButton('放大图片','zoom-in',()=>zoomBy(.25)),iconButton('关闭图片','x',()=>dialog.close()));
    imageContent.append(image);stage.append(imageContent);dialog.append(tools,stage);hint.setAttribute('role','status');dialog.setAttribute('aria-label','查看聊天图片');
    window.addEventListener('resize',resizeImage);window.visualViewport?.addEventListener('resize',resizeImage);
    dialog.addEventListener('close',()=>{window.removeEventListener('resize',resizeImage);window.visualViewport?.removeEventListener('resize',resizeImage);if(imageViewer?.dialog===dialog){imageViewer=null;mediaRequestVersion++;}image.removeAttribute('src');dialog.remove();},{once:true});
    dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});document.body.append(dialog);imageViewer={dialog,messageId:message.id};refreshIcons(dialog);dialog.showModal();image.src=source;
  }
  async function useReplySource(message,action){
    if(action==='locate' && !locateLoading.hidden)return;
    const sourceController=controller;
    const requestVersion=action==='media'?++mediaRequestVersion:null;
    if(action==='locate')setLocateBusy(true);
    try{
      if(!Number.isSafeInteger(message.sequence))throw new Error('原消息已不可用');
      const data=await api(`?around=${message.sequence}`),source=data.messages.find(source=>source.id===message.id);
      if(sourceController!==controller || !current())return;
      if(action==='media'&&requestVersion!==mediaRequestVersion)return;
      if(!source||source.withdrawnAt||source.deleted)throw new Error('原消息已不可用');
      if(action==='locate'){navigateMessage(source);return;}
      quotedSource=source;
      if(source.video)videoUI.view(source.video,source.id);
      else if(source.image)viewImage(source);
      else throw new Error('原图片或视频已不可用');
    }catch(error){if(sourceController===controller&&(action!=='media'||requestVersion===mediaRequestVersion)){if(action==='locate')setLocateBusy(false);if(error.name!=='AbortError')showToast(error.status===404?'原消息已删除、隐藏或超出可查看的历史范围':error.message);}}
  }
  function appendReplyPreview(host,message,title,owner=message){
    host.tabIndex=0;host.setAttribute('aria-label','引用消息，右键定位到原文位置');host.setAttribute('aria-haspopup','menu');
    const openQuoteMenu=(x,y)=>openMessageMenu(owner,x,y,[['定位到原文位置','locate-fixed',()=>{void useReplySource(message,'locate');}]]);
    host.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();openQuoteMenu(event.clientX,event.clientY);});
    host.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();const rect=host.getBoundingClientRect();openQuoteMenu(rect.left,rect.bottom);}});
    const text=node('div','chat-quote-text');text.append(node('strong','',host.classList.contains('chat-quote')?`${title}: `:title),node('span','',message.text || message.reference?.label || (message.video ? '视频' : '图片')));host.append(text);
    const src=message.video?.thumb || message.imageInfo?.thumb || message.image;
    if(!src)return;
    const media=node('button','chat-quote-media'),image=node('img');media.type='button';media.setAttribute('aria-label',message.video?'播放引用视频':'查看引用图片');media.addEventListener('click',event=>{event.stopPropagation();void useReplySource(message,'media');});image.src=src;image.alt=message.video ? '引用视频缩略图' : '引用图片缩略图';image.loading=host.classList.contains('chat-quote')?'lazy':'eager';image.decoding='async';media.append(image);
    if(message.video){const play=node('span','chat-quote-play','▶');play.setAttribute('aria-hidden','true');media.append(play);}
    image.addEventListener('error',()=>{if(message.image&&image.getAttribute('src')!==message.image){image.src=message.image;return;}media.remove();});host.append(media);
  }
  function setReply(message,focus=true) {if(sending)return;reply=message;const host=$('.chat-reply-draft');host.hidden=!message;host.replaceChildren();if(message){const preview=node('div','chat-reply-preview');appendReplyPreview(preview,message,`回复 ${label(authors.get(message.senderId))}`);host.append(preview,iconButton('取消引用','x',()=>setReply(null)));refreshIcons(host);if(focus)input.focus();}}
  function hideEmoji() {$('.chat-emoji-picker').hidden=true;emojiButton.setAttribute('aria-expanded','false');}
  function closeMessageMenu(restoreFocus=false) {menu.hidden=true;menu.replaceChildren();const message=menuMessage;menuMessage=null;if(restoreFocus && message)timeline.querySelector(`[data-chat-id="${CSS.escape(message.id)}"]`)?.focus({preventScroll:true});}
  function openMessageMenu(message,x,y,quoteActions=null) {
    closeMessageMenu();closeReadPopover();hideEmoji();menuMessage=message;
    const actions=quoteActions || [['引用消息','reply',()=>setReply(message)]];
    if(!quoteActions){
    actions.push(...features.menuActions(message));
    if(filtered())actions.push(['查看消息上下文','search',()=>navigateMessage(message)]);
    if(message.senderId===userId())actions.push(['撤回消息','undo-2',()=>mutate(message,'withdraw')]);
    actions.push(['从我的记录隐藏','trash-2',()=>mutate(message,'hide')]);
    }
    for(const [name,icon,action] of actions){const button=iconButton(name,icon,()=>{closeMessageMenu();action();},'chat-context-action');button.append(node('span','',name));button.setAttribute('role','menuitem');
      menu.append(button);}
    menu.hidden=false;refreshIcons(menu);const rect=menu.getBoundingClientRect(),view=window.visualViewport,left=(view?.offsetLeft||0)+8,top=(view?.offsetTop||0)+8;
    menu.style.left=`${Math.max(left,Math.min(x,left+(view?.width||innerWidth)-rect.width-16))}px`;menu.style.top=`${Math.max(top,Math.min(y,top+(view?.height||innerHeight)-rect.height-16))}px`;menu.querySelector('button')?.focus();
  }
  function navigateMessage(message){setLocateBusy(true);contextSequence=message.sequence;query='';search.value='';clearSearch.hidden=true;features.resetFilters();searchVersion++;load('context');}
  menu.addEventListener('pointerdown',event=>event.stopPropagation());
  menu.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();closeMessageMenu(true);return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const controls=[...menu.querySelectorAll('button:not(:disabled)')],index=controls.indexOf(document.activeElement);controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowDown'?1:-1)+controls.length)%controls.length]?.focus();}});
  function referenceButton(ref) {
    const button=iconButton(`跳转到画布元素：${ref.label}`,'arrow-up-right',()=>{
      const item=state.items.get(ref.itemId);if(!item)return showToast('该画布元素已被删除');
      close(false);focusSearchTarget(item,'item');
      const element=document.querySelector(`.board-item[data-item-id="${CSS.escape(ref.itemId)}"]`);element?.classList.add('chat-reference-highlight');setTimeout(()=>element?.classList.remove('chat-reference-highlight'),1600);
    },'chat-element-reference');button.append(node('span','',ref.label || '画布元素'));return button;
  }
  function setReference(ref) {reference=ref;const host=$('.chat-element-draft');host.hidden=!ref;host.replaceChildren();if(ref){host.append(node('span','','画布引用'),referenceButton(ref),iconButton('移除画布引用','x',()=>setReference(null)));refreshIcons(host);}}
  window.addEventListener('muse:chat-reference',async event=>{
    const detail=event.detail,item=state.items.get(detail?.itemId);if(!item || detail.boardId!==state.boardId || ['frame','section'].includes(item.type))return;
    if(sending)return showToast('请等待当前消息发送完成');
    if(!current())await open();if(!current() || detail.boardId!==boardId)return;
    try {if(composer.hidden){await api('',{method:'PUT'});await load('initial');}if(!current())return;
      const planName=item.type==='planning' ? window.MusePlanning?.store?.plans.get(item.planRef)?.name : null;
      const content=planName || (typeof item.text==='string' ? item.text : typeof item.title==='string' ? item.title : typeof item.name==='string' ? item.name : '');
      const names={text:'文字',image:'图片',note:'便签',shape:'图形',table:'表格',sheet:'电子表格',mindmap:'思维导图',ink:'笔迹',connector:'连线',planning:'规划',sticker:'贴纸',kdocs:'在线文档','amap-map':'地图','amap-search':'地点搜索','amap-route':'路线'};
      setReference({itemId:item.id,type:item.type,label:(content.replace(/<[^>]*>/g,'').trim() || names[item.type] || '画布元素').slice(0,120)});input.focus();
    }catch(error){if(error.name!=='AbortError')feedback(error.message);}
  });
  function resetAttention() {attentionKey='';unreadCount=0;attentionMentions=0;notificationMode='all';badge.hidden=true;trigger.setAttribute('aria-label','画布群聊');trigger.title='画布群聊';reminder.hidden=true;clearTimeout(reminderTimer);}
  function updateUnread(count,mentioned=0,mode=notificationMode) {
    const key=`${userId()}:${state.boardId}`;if(key!==attentionKey){resetAttention();attentionKey=key;}
    const increased=mode==='mentions'?mentioned>attentionMentions:count>unreadCount;unreadCount=count;attentionMentions=mentioned;notificationMode=mode||'all';badge.textContent=String(count);badge.hidden=!count;badge.classList.toggle('has-mentions',mentioned>0);
    trigger.setAttribute('aria-label',count ? `画布群聊，${count} 条未读消息` : '画布群聊');trigger.title=count ? `画布群聊 · ${count} 条未读消息` : '画布群聊';
    if(!count || notificationMode==='none'){reminder.hidden=true;clearTimeout(reminderTimer);}
    else if(increased && notificationMode!=='none' && !document.hidden && !window.__independentNotesActive){
      const rect=trigger.getBoundingClientRect();reminderText.replaceChildren('您有 ',node('strong','',String(notificationMode==='mentions'?mentioned:count)),notificationMode==='mentions'?' 条消息提及您':' 条未读消息');reminder.hidden=false;
      const size=reminder.getBoundingClientRect(),dockRight=Math.max(rect.right,dock.closest('#toolDock').getBoundingClientRect().right);reminder.style.left=`${Math.max(8,Math.min(dockRight+18,window.innerWidth-size.width-8))}px`;reminder.style.top=`${Math.max(8,Math.min(rect.top+(rect.height-size.height)/2,window.innerHeight-size.height-8))}px`;
      clearTimeout(reminderTimer);reminderTimer=setTimeout(()=>{reminder.hidden=true;},3000);
    }
  }
  async function pollAttention() {
    if(document.hidden || window.__independentNotesActive || !userId() || !state.boardId || state.switchingCanvas || current())return;
    if(attentionBusy){attentionPending=true;return;}
    const captured=state.boardId,owner=userId();attentionBusy=true;
    try {const response=await fetch(`/api/canvases/${encodeURIComponent(captured)}/chat?status=1`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok){if([401,403,404].includes(response.status) && captured===state.boardId && owner===userId())resetAttention();return;}const data=await response.json();if(captured!==state.boardId || owner!==userId() || window.__independentNotesActive || current())return;updateUnread(data.unreadCount || 0,data.unreadMentionCount || 0,data.notificationMode);
    }catch{}finally{attentionBusy=false;if(attentionPending){attentionPending=false;queueMicrotask(pollAttention);}}
  }
  function refreshLiveChat() {if(document.hidden)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(current())load();else pollAttention();},100);}
  function scheduleRead() {clearTimeout(readTimer);readTimer=setTimeout(markVisibleRead,600);}
  async function markVisibleRead() {
    if(!current() || composer.hidden || readBusy || filtered() || document.hidden || !document.hasFocus())return;
    const rect=timeline.getBoundingClientRect();let sequence=positions[userId()] || 0;
    for(const row of timeline.querySelectorAll('[data-chat-id]')){const bounds=row.getBoundingClientRect();if(bounds.bottom>rect.top && bounds.top<rect.bottom)sequence=Math.max(sequence,messages.get(row.dataset.chatId)?.sequence || 0);}
    if(sequence<1 || sequence<=(positions[userId()] || 0) || sequence>latestSequence)return;
    const context=controller;readBusy=true;
    try {const data=await api('/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sequence})});applyReadStatus(data);render();}
    catch(error){if(error.name!=='AbortError')feedback('已读状态暂未同步，将自动重试');}
    finally{if(context===controller)readBusy=false;}
  }
  function canReedit(message){return Boolean(message.withdrawnAt && !message.deleted && message.senderId===userId() && message.reeditUntil>Date.now());}
  async function reedit(message){
    if(!current() || reeditBusy)return;
    if(!canReedit(messages.get(message.id)||{})){render();return feedback('消息已过期或不可重新编辑');}
    const hasDraft=()=>Boolean(input.value || file || reply || reference || sending);
    if(hasDraft())return feedback('请先发送或清空当前草稿，再重新编辑');
    const context=controller;reeditBusy=true;
    try{
      const draft=await api(`/messages/${message.id}/reedit`);
      if(context!==controller || !current())return;
      if(!canReedit(messages.get(message.id)||{}) || draft.reeditUntil<=Date.now()){render();return feedback('消息已过期或不可重新编辑');}
      if(hasDraft())return feedback('请先发送或清空当前草稿，再重新编辑');
      input.value=draft.text;features.clearMentions();input.dispatchEvent(new Event('input'));input.focus();input.setSelectionRange(input.value.length,input.value.length);
    }catch(error){if(context===controller && error.name!=='AbortError'){if(error.status===410){const latest=messages.get(message.id);if(latest)latest.reeditUntil=null;render();}feedback(error.message);}}
    finally{reeditBusy=false;}
  }
  async function mutate(message,action) {try{await api(`/messages/${message.id}${action==='withdraw'?'/withdraw':''}`,{method:action==='withdraw'?'POST':'DELETE'});if(action==='hide')messages.delete(message.id);await load();render();}catch(error){if(error.name!=='AbortError')feedback(error.message);}}
  function setBusy(busy) {sending=busy;input.disabled=false;cancelSend.hidden=!busy;sendButton.disabled=busy;uploadButton.disabled=busy;emojiButton.disabled=false;sendButton.setAttribute('aria-busy',String(busy));for(const button of panel.querySelectorAll('.chat-attachment button,.chat-reply-draft button,.chat-element-draft button'))button.disabled=busy;}
  async function chooseFile(selected) {
    if(sending || !selected)return;selected=normalizeChatVideoFile(selected);const video=isVideoFile(selected);
    if(!video && !['image/png','image/jpeg','image/webp'].includes(selected.type))return feedback('支持 PNG、JPEG、WebP 图片和 MP4、MOV、WebM、M4V 视频');
    if(selected.size>(video ? videoUI.maxFileBytes() : 8*1024*1024))return feedback(video ? '视频超过当前单文件大小上限' : '图片不能超过 8 MB');
    releaseFile();file=selected;preview=URL.createObjectURL(file);const host=$('.chat-attachment');host.hidden=false;
    if(video){const glyph=node('i');glyph.dataset.lucide='video';host.append(glyph);fileVideo={name:file.name,original:preview,preview};}
    else{const image=node('img');image.src=preview;image.alt='待发送图片';host.append(image);}
    host.append(node('span','',file.name || '粘贴图片'),iconButton('移除附件','x',releaseFile));refreshIcons(host);input.focus();
    if(video){posterController=new AbortController();const poster=await localVideoPoster(selected,posterController.signal);
      if(file===selected && poster){fileVideo={...fileVideo,...poster};const image=node('img');image.src=poster.thumb;image.alt='待发送视频';host.firstChild?.replaceWith(image);}}
  }
  function updateOutgoing(entry,delivery,progress=entry.progress,error=''){
    if(!outbox.has(entry.id))return;entry.delivery=delivery;entry.progress=Math.max(entry.progress || 0,Math.min(1,progress || 0));entry.error=error;
    const row=rendered.get(entry.id)?.node;if(row)updateReceipt(row,entry);
  }
  async function send(retry=null) {
    if(!current() || sending || !retry && !input.value.trim() && !file && !reference)return;
    const context=controller,operation=new AbortController();let entry=retry;
    if(!entry){const snapshot={text:input.value,file,video:fileVideo,reply,reference,mentions:features.mentionPayload()},id=crypto.randomUUID();
      const localPreview=snapshot.file?URL.createObjectURL(snapshot.file):null;
      entry={id,senderId:userId(),text:snapshot.text.trim(),image:isVideoFile(snapshot.file) ? null : localPreview,video:isVideoFile(snapshot.file) ? {...snapshot.video,name:snapshot.file.name,original:localPreview,preview:localPreview} : null,localPreview,sentAt:Date.now(),sequence:null,snapshot,
        reference:snapshot.reference,reply:snapshot.reply ? {id:snapshot.reply.id,senderId:snapshot.reply.senderId,sequence:snapshot.reply.sequence,text:snapshot.reply.text || snapshot.reply.reference?.label || (snapshot.reply.video ? '视频' : '图片'),image:snapshot.reply.image,imageInfo:snapshot.reply.imageInfo,video:snapshot.reply.video} : null,
        mentions:snapshot.mentions,payload:{id,text:snapshot.text.trim(),mentions:snapshot.mentions,image:null,replyId:snapshot.reply?.id || null,reference:snapshot.reference,generation},delivery:'sending',progress:0};
      outbox.set(id,entry);input.value='';features.clearMentions();releaseFile();setReply(null);setReference(null);hideEmoji();
    }
    const {snapshot,payload}=entry;if(retry)payload.generation=generation;entry.progress=payload.image || payload.videoId ? .9 : 0;updateOutgoing(entry,'sending');sendController=operation;setBusy(true);
    // Put the local message in the timeline before any upload or network wait.
    if(filtered()){query='';search.value='';features.resetFilters();searchVersion++;load('initial');}windowEnd=null;stickToBottom=true;renderKey='';render();timeline.scrollTop=timeline.scrollHeight;
    try {
      if(snapshot.file && isVideoFile(snapshot.file) && !payload.videoId){
        const upload=await api('/videos/uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:snapshot.file.name,bytes:snapshot.file.size}),signal:operation.signal});
        try{for(let offset=0;offset<snapshot.file.size;offset+=upload.chunkBytes){const chunk=snapshot.file.slice(offset,offset+upload.chunkBytes);
          await api(`/videos/${upload.id}/chunks?offset=${offset}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:chunk,signal:operation.signal,timeout:180000,
            onUploadProgress:loaded=>{if(context===controller && !operation.signal.aborted)updateOutgoing(entry,'sending',.8*Math.min(1,(offset+Math.min(loaded,chunk.size))/snapshot.file.size));}});}
          const info=await api(`/videos/${upload.id}/complete`,{method:'POST',signal:operation.signal,timeout:360000});payload.videoId=info.id;entry.video=info;updateOutgoing(entry,'sending',.9);renderKey='';render();
        }catch(error){void api(`/videos/${upload.id}`,{method:'DELETE'}).catch(()=>{});throw error;}
      }else if(snapshot.file && !payload.image && !isVideoFile(snapshot.file)){const uploaded=await api('/api/assets',{method:'POST',headers:{'content-type':snapshot.file.type,'x-muse-asset-purpose':'chat'},body:snapshot.file,signal:operation.signal,timeout:180000,
        onUploadProgress:(loaded,total)=>{if(context===controller && !operation.signal.aborted)updateOutgoing(entry,'sending',.8*Math.min(1,loaded/Math.max(1,total)));}});payload.image=uploaded.variants?.original?.url || uploaded.src || uploaded.url;updateOutgoing(entry,'sending',.9);}
      await api('/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:operation.signal});
      updateOutgoing(entry,'sent',1);await load();if(context!==controller)return;newCount=0;renderNewMessages();if(current())input.focus();
    } catch(error) {if(context===controller){updateOutgoing(entry,'failed',entry.progress,operation.signal.aborted?'已取消发送':error.message);if(error.code==='CHAT_VIDEO_LIMIT_REACHED')void videoUI.openManager(true);if(error.code==='CHAT_GENERATION_CHANGED'){payload.generation=generation;load('initial');}if([401,403,404].includes(error.status)){if(payload.videoId && error.status===403)payload.videoId=null;load('initial');}}}
    finally {if(context===controller && sendController===operation){sendController=null;setBusy(false);if(panel.hidden)close(false);}}
  }
  composer.addEventListener('submit',event=>{event.preventDefault();send();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.shiftKey && !event.isComposing && event.keyCode!==229){event.preventDefault();send();}});
  composer.addEventListener('paste',event=>{
    const clipboard=event.clipboardData,files=[...(clipboard?.files || []),...[...(clipboard?.items || [])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean)];
    const selected=files.find(item=>isVideoFile(item) || /^(image|video)\//.test(item.type));
    if(selected && !sending){event.preventDefault();chooseFile(selected);}
  });
  panel.addEventListener('dragover',event=>event.preventDefault());panel.addEventListener('drop',event=>{event.preventDefault();chooseFile(event.dataTransfer?.files[0]);});
  $('.chat-file').addEventListener('change',event=>chooseFile(event.target.files[0]));
  let searchTimer;search.addEventListener('input',()=>{clearSearch.hidden=!search.value;query=search.value.trim();searchVersion++;clearTimeout(searchTimer);feedback(query?'正在搜索…':'正在加载聊天记录…');searchTimer=setTimeout(()=>load('search'),180);});
  panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){if(!$('.chat-emoji-picker').hidden){$('.chat-emoji-picker').hidden=true;emojiButton.setAttribute('aria-expanded','false');input.focus();}else close();}});
  panel.addEventListener('pointerdown',event=>event.stopPropagation());
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.chat-emoji-picker') && !emojiButton.contains(event.target))hideEmoji();const insideMenu=menu.contains(event.target);if(!insideMenu)closeMessageMenu();
    const insideReadPopover=readPopover.contains(event.target);if(!insideReadPopover && !event.target.closest('.chat-read-receipt'))closeReadPopover();
    const details=$('.chat-member-details');if(details && !details.contains(event.target))details.open=false;
    if(!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target) && !insideMenu && !insideReadPopover && !imageViewer?.dialog.contains(event.target) && !videoUI.contains(event.target) && !features.contains(event.target) && !event.target.closest('.chat-transfer-dialog'))close(false);
  },{capture:true});
  document.addEventListener('focusin',event=>{if(!event.target.closest('.chat-emoji-picker') && !emojiButton.contains(event.target))hideEmoji();if(readDetails && !readPopover.contains(event.target) && !readDetails.anchor.contains(event.target))closeReadPopover();});
  window.addEventListener('resize',()=>{reminder.hidden=true;closeMessageMenu();closeReadPopover();});
  timeline.addEventListener('scroll',()=>{closeReadPopover();stickToBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<90;scheduleRead();if(stickToBottom && newCount){newCount=0;renderNewMessages();}},{passive:true});
  for(const event of ['muse:account-changing','muse:logout','muse:auth-expired'])window.addEventListener(event,()=>{close(false,false);drafts.clear();resetAttention();});
  window.addEventListener('muse:sharing-changed',()=>{if(current())load('initial');else pollAttention();});
  window.addEventListener('muse:chat-changed',event=>{if(event.detail?.boardId!==state.boardId)return;if(event.detail.kind==='read' && current()){clearTimeout(readRefreshTimer);readRefreshTimer=setTimeout(async()=>{try{const data=await api('?status=1');applyReadStatus(data);render();}catch{}},150);}else refreshLiveChat();});
  window.addEventListener('muse:chat-connected',refreshLiveChat);
  window.addEventListener('online',refreshLiveChat);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){reminder.hidden=true;closeMessageMenu();closeReadPopover();}else{refreshLiveChat();scheduleRead();}});
  window.addEventListener('focus',()=>{scheduleRead();refreshLiveChat();});
  setInterval(()=>{if(boardId && (boardId!==state.boardId || window.__independentNotesActive || !userId()))close(false);const key=`${userId()}:${state.boardId}`;if(attentionKey && key!==attentionKey){resetAttention();pollAttention();}if(window.__independentNotesActive)reminder.hidden=true;},400);
  function pollLoop(){if(current() && !document.hidden)load();else pollAttention();const healthy=state.socket?.readyState===1 && state.connected,delay=document.hidden?60000:healthy?30000:Math.min(30000,2500*2**Math.min(pollFailures,4));setTimeout(pollLoop,delay*(.9+Math.random()*.2));}setTimeout(pollLoop,2500);
  pollAttention();
  async function openSource(detail){
    if(!detail||!/^[\w-]{1,128}$/.test(detail.boardId||'')||!Number.isSafeInteger(detail.sequence)||detail.sequence<1)return;
    try{window.MuseNotebook?.hide();if(detail.boardId!==state.boardId)await (await import('./canvas-session.js')).switchCanvas(detail.boardId);if(!current())await open();if(current()&&boardId===detail.boardId)navigateMessage(detail);}catch(error){if(error.name!=='AbortError')showToast(error.message);}
  }
  window.addEventListener('muse:open-chat-source',event=>void openSource(event.detail));
  const pushHandoffs=new Set();
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type!=='muse:push-open')return;
    const id=event.data.handoffId;
    if(id)event.source?.postMessage({type:'muse:push-ack',handoffId:id});
    if(id&&pushHandoffs.has(id))return;
    if(id){pushHandoffs.add(id);if(pushHandoffs.size>100)pushHandoffs.delete(pushHandoffs.values().next().value);}
    void openSource(event.data);
  });
  if(navigator.serviceWorker){
    const ready=()=>navigator.serviceWorker.controller?.postMessage({type:'muse:push-ready'});
    ready();navigator.serviceWorker.addEventListener('controllerchange',ready);
  }
  const sourceParams=new URLSearchParams(location.search),sourceBoard=sourceParams.get('chatBoard'),sourceSequence=Number(sourceParams.get('chatMessage'));
  if(sourceBoard&&sourceSequence){
    const clean=new URL(location.href);clean.searchParams.delete('chatBoard');clean.searchParams.delete('chatMessage');history.replaceState(history.state,'',clean);
    void openSource({boardId:sourceBoard,sequence:sourceSequence});
  }
  refreshIcons(trigger);refreshIcons(panel);
}
