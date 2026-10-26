import { sideUser,sideIdentity,sideApi,node,action,sideDialog } from './side-tools-ui.js';
import { state } from './state.js';
import { memberAvatar,memberPicker } from './side-member-picker.js';
import { createGomokuTurnNotifier } from './gomoku-notifications.js';
import { createGomokuGridLines,showGomokuBanner } from './gomoku-visuals.js';

export function initializeGomoku(trigger) {
  const {dialog,body,feedback}=sideDialog('五子棋','gomokuDialog');
  const invitationModal=node('dialog','side-tool-dialog gomoku-invite-dialog');invitationModal.setAttribute('aria-labelledby','gomokuInviteTitle');dialog.append(invitationModal);
  const invitationError=node('p','side-tool-status');invitationError.setAttribute('role','alert');
  invitationModal.addEventListener('cancel',event=>{event.preventDefault();event.stopImmediatePropagation();});
  function syncInvitation(game) {
    if(!game||game.status!=='invited'||game.white_id!==sideUser()){
      if(invitationModal.open)invitationModal.close();delete invitationModal.dataset.gameId;return;
    }
    if(invitationModal.dataset.gameId!==game.id){
      invitationModal.dataset.gameId=game.id;invitationError.textContent='';
      const title=node('h3','',game.rematch_of?'对方邀请你开始新的对局':'收到五子棋邀请');title.id='gomokuInviteTitle';
      const description=node('p','',`${name(game.black_id)}邀请你对局，请先选择同意或拒绝。`),buttons=node('div','side-tool-row');
      const decide=kind=>{if(kind==='accept')turnNotifications.requestPermission();const latest=games.find(g=>g.id===invitationModal.dataset.gameId);if(latest)void mutate(latest,kind);};
      buttons.append(action('拒绝',()=>decide('decline')),action('同意',()=>decide('accept'),'primary'));
      invitationModal.replaceChildren(title,description,buttons,invitationError);
    }
    invitationModal.querySelectorAll('button').forEach(button=>button.disabled=busy||!transportOnline);
    if(dialog.open&&!invitationModal.open){invitationModal.showModal();invitationModal.querySelector('button').focus();}
  }
  const badge=node('span','gomoku-badge');badge.hidden=true;badge.setAttribute('aria-hidden','true');trigger.append(badge);
  const intro=node('p','side-tool-muted','黑棋先行，连成五子获胜，满盘无胜者为平局。邀请保留 10 分钟。');
  const invitations=node('div','gomoku-list'),controls=node('div','side-tool-row'),members=node('select');members.id='gomokuMemberSelect';
  const memberChoices=memberPicker(members,'邀请成员',dialog,id=>person(id));
  const invite=action('邀请对局',()=>inviteMember(),'primary');controls.append(memberChoices.element,invite);
  const content=node('div','gomoku-list');
  const switcher=node('div','gomoku-switcher'),gamePicker=node('select');gamePicker.id='gomokuGameSelect';
  const gameChoices=memberPicker(gamePicker,'切换对局',dialog,id=>{const game=games.find(g=>g.id===id);return game?person(game.black_id===sideUser()?game.white_id:game.black_id):null;});
  switcher.append(node('span','side-tool-muted','对局'),gameChoices.element);switcher.hidden=true;
  body.append(intro,invitations,controls,switcher,content);
  let games=[],roster=[],selected='',owner=sideIdentity(),scope=new AbortController(),timer,loading=false,again=false,busy=false,stopped=false,failures=0,renderKey='';
  let boardId=state.boardId,updates=0,resigning='';
  let cellButtons=[],shownGame='';
  let transportOnline=navigator.onLine!==false;
  let turnKey='',hoverIndex=-1,bannerAnimation;
  const dismissed=new Set(),declinesShown=new Set(),inlineInvites=new Set(),undoResults=new Set();
  function undoState(game){try{return JSON.parse(game.undo_request||'null');}catch{return null;}}
  function trackInvitation(game,known) {
    if(game.status==='invited'&&game.rematch_of===shownGame&&game.white_id===sideUser()&&dialog.open&&!known){inlineInvites.add(game.id);selected=game.id;}
    if(game.rematch_of===selected&&known?.status==='invited'&&['playing','paused'].includes(game.status))selected=game.id;
  }
  const finished=g=>['won','resigned','draw'].includes(g.status);
  function banner(text) {
    const element=content.querySelector('.gomoku-banner');if(!element||!dialog.open)return;
    bannerAnimation?.cancel();bannerAnimation=showGomokuBanner(element,text);
  }
  function preview() {
    cellButtons.forEach((button,index)=>{
      if(index===hoverIndex&&button.getAttribute('aria-disabled')==='false')button.dataset.preview=String(games.find(g=>g.id===shownGame)?.ply%2===0?1:2);
      else delete button.dataset.preview;
    });
  }
  function invitationBadge() {
    const incoming=games.some(g=>g.status==='invited'&&g.white_id===sideUser()||undoState(g)?.status==='pending'&&undoState(g)?.requester!==sideUser());
    badge.hidden=!incoming;trigger.setAttribute('aria-label',incoming?'游戏，有待处理的五子棋请求':'游戏');
  }
  const report=error=>{if(error.name!=='AbortError'){const message=error.message||'网络连接失败，请重试';feedback(message);if(invitationModal.open)invitationError.textContent=message;}};
  const call=async(path='',options={})=>{
    const signal=scope.signal,board=boardId;
    const data=await sideApi(`/api/gomoku${path||`?boardId=${encodeURIComponent(board||'')}`}`,{...options,signal});
    if(signal.aborted||signal!==scope.signal||board!==state.boardId)throw new DOMException('画布已切换','AbortError');
    return data;
  };
  const current=()=>!stopped&&owner===sideIdentity()&&Boolean(sideUser())&&Boolean(boardId)&&boardId===state.boardId;
  const turnNotifications=createGomokuTurnNotifier({userId:sideUser,identity:sideIdentity,isCurrent:current,openTarget});
  const name=id=>id===sideUser()?'你':roster.find(m=>m.id===id)?.username||'成员';
  function person(id){return id?(id===sideUser()?window.MuseAccount?.session?.user:roster.find(m=>m.id===id))||{id,username:'成员'}:null;}
  function personLabel(id,suffix=''){
    const label=node('span','side-member-person');label.append(memberAvatar(person(id)),node('span','',`${name(id)}${suffix}`));return label;
  }
  const paused=g=>g.status==='paused'||g.status==='playing'&&!transportOnline;
  const stateText=g=>paused(g)?'棋局已暂停':undoState(g)?.status==='pending'?(undoState(g).requester===sideUser()?'正在等待对方同意悔棋':'对方请求悔棋，请选择同意或拒绝'):g.status==='invited'?(g.black_id===sideUser()?'等待对方接受邀请':'邀请你对局'):g.status==='playing'?`${name(g.ply%2===0?g.black_id:g.white_id)}的回合`:
    g.status==='won'?`${name(g.winner)}获胜`:g.status==='resigned'?`${name(g.winner)}获胜（${name(g.winner===g.black_id?g.white_id:g.black_id)}认输）`:g.status==='draw'?'平局':g.status==='declined'?'邀请已拒绝':'邀请已取消';
  function reset() {
    turnNotifications.reset();
    syncInvitation(null);
    turnKey='';hoverIndex=-1;bannerAnimation?.cancel();dismissed.clear();declinesShown.clear();inlineInvites.clear();undoResults.clear();
    resigning='';
    scope.abort();scope=new AbortController();owner=sideIdentity();boardId=state.boardId;stopped=false;games=[];roster=[];selected='';renderKey='';loading=false;again=false;busy=false;failures=0;
    badge.hidden=true;trigger.setAttribute('aria-label','游戏');dialog.close();content.replaceChildren();invitations.replaceChildren();members.replaceChildren();cellButtons=[];shownGame='';feedback('');
    gamePicker.replaceChildren();switcher.hidden=true;memberChoices.sync();gameChoices.sync();
  }
  function schedule(delay) {clearTimeout(timer);if(current())timer=setTimeout(()=>void refresh(),delay);}
  async function refresh() {
    if(boardId!==state.boardId)reset();
    if(!current())return;
    if(loading){again=true;return;}loading=true;
    const captured=owner,signal=scope.signal,version=updates;
    try {
      const data=await call();if(captured!==owner||signal.aborted||!current())return;
      if(version!==updates){again=true;return;}
      const knownGames=new Map(games.map(game=>[game.id,game]));
      data.games.forEach(game=>trackInvitation(game,knownGames.get(game.id)));
      games=data.games.map(game=>{const known=knownGames.get(game.id);return known&&known.revision>game.revision?known:game;});roster=data.members;failures=0;
      games.forEach(game=>turnNotifications.observe(game));
      invitationBadge();
      if(!dialog.open)renderKey='';else render();
    } catch(error) {
      if(signal.aborted)return;
      failures++;if([401,403,404].includes(error.status)){reset();stopped=true;feedback(error.status===404?'当前画布已不可访问，棋局已清除':'登录或权限已变更，请重新打开棋局');return;}
      if(dialog.open)report(error);
    } finally {
      if(captured===owner&&!signal.aborted){loading=false;if(again){again=false;schedule(150);}else schedule(Math.min(60000,(dialog.open?5000:document.hidden?60000:30000)*2**Math.min(failures,2)));}
    }
  }
  function render() {
    if(!games.some(g=>g.id===selected&&!['cancelled','declined'].includes(g.status)))selected=games.find(g=>g.status==='invited'&&g.white_id===sideUser())?.id||'';
    const key=JSON.stringify([games,roster,busy,selected,transportOnline,resigning]);if(key===renderKey)return;renderKey=key;
    const previousMember=members.value;
    members.replaceChildren();
    const available=roster.filter(m=>!games.some(g=>['invited','playing','paused'].includes(g.status)&&[g.black_id,g.white_id].includes(m.id)));
    for(const m of roster){const option=node('option','',m.username);option.value=m.id;option.disabled=!available.some(candidate=>candidate.id===m.id);members.append(option);}
    if(available.some(m=>m.id===previousMember))members.value=previousMember;else if(available.length)members.value=available[0].id;
    if(!available.length){const option=node('option','',roster.length?'已与所有成员建立对局':'暂无其他画布成员');option.value='';option.disabled=true;members.prepend(option);members.value='';}
    invite.disabled=busy||!available.length;members.disabled=invite.disabled;
    memberChoices.sync();
    invitations.replaceChildren();
    for(const g of games.filter(g=>g.status==='invited'&&g.id!==selected)){
      const row=node('div','gomoku-invitation'),text=node('p','side-member-people'),buttons=node('div','side-tool-row');
      text.append(personLabel(g.black_id),node('span','','邀请'),personLabel(g.white_id),node('span','','对局'));
      const add=(label,kind)=>{const b=action(label,()=>mutate(g,kind));b.disabled=busy;buttons.append(b);};
      if(g.white_id===sideUser()){
        const view=action('查看邀请',()=>{selected=g.id;resigning='';renderKey='';render();});view.disabled=busy;buttons.append(view);
      }else add('取消邀请','cancel');
      row.append(text,buttons);invitations.append(row);
    }
    const playable=games.filter(g=>!['cancelled','declined'].includes(g.status)&&(g.status!=='invited'||g.id===selected));
    const game=playable.find(g=>g.id===selected)||playable.find(g=>['playing','paused'].includes(g.status))||playable[0];
    gamePicker.replaceChildren();switcher.hidden=playable.length<2;gamePicker.disabled=busy;
    for(const g of playable){const option=node('option','',`与 ${name(g.black_id===sideUser()?g.white_id:g.black_id)} · ${stateText(g)} · ${g.ply} 手`);option.value=g.id;gamePicker.append(option);}
    if(!game){syncInvitation(null);gameChoices.sync();content.replaceChildren(node('p','side-tool-muted','邀请一位画布成员开始对局。'));shownGame='';cellButtons=[];return;}
    selected=game.id;
    gamePicker.value=selected;
    gameChoices.sync();
    syncInvitation(game);
    let cells;
    try{cells=JSON.parse(game.cells);}catch{cells=null;}
    if(!Array.isArray(cells)||cells.length!==225||cells.some(value=>![0,1,2].includes(value))){
      content.replaceChildren(node('p','side-tool-muted','此棋局数据异常，已阻止落子。请刷新或切换其他对局。'),action('刷新棋局',()=>void refresh()));shownGame='';cellButtons=[];return;
    }
    if(shownGame!==game.id){
      hoverIndex=-1;
      shownGame=game.id;cellButtons=[];content.replaceChildren();
      const heading=node('p','quick-transfer-name');heading.dataset.gameHeading='';
      const info=node('p');info.dataset.gameInfo='';
      info.setAttribute('role','status');info.setAttribute('aria-live','polite');
      const grid=node('div','gomoku-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','五子棋棋盘');
      grid.append(createGomokuGridLines());
      grid.setAttribute('aria-description','方向键选择位置，Enter 或空格落子。红点表示最后一手。');
      for(let i=0;i<225;i++){
        const button=action('',()=>{const latest=games.find(g=>g.id===shownGame);if(latest)void mutate(latest,'move',{index:i,ply:latest.ply,revision:latest.revision});},'gomoku-cell');
        button.dataset.index=String(i);button.dataset.tooltipDisabled='true';grid.append(button);cellButtons.push(button);
      }
      grid.addEventListener('keydown',event=>{
        const index=cellButtons.indexOf(event.target);if(index<0)return;
        let next=index;
        if(event.key==='ArrowLeft')next=index%15?index-1:index;
        else if(event.key==='ArrowRight')next=index%15<14?index+1:index;
        else if(event.key==='ArrowUp')next=index>=15?index-15:index;
        else if(event.key==='ArrowDown')next=index<210?index+15:index;
        else if(event.key==='Home')next=event.ctrlKey?0:index-index%15;
        else if(event.key==='End')next=event.ctrlKey?224:index-index%15+14;
        else return;
        event.preventDefault();cellButtons.forEach((button,i)=>button.tabIndex=i===next?0:-1);cellButtons[next].focus({preventScroll:true});
      });
      grid.addEventListener('focusin',event=>cellButtons.forEach(button=>button.tabIndex=button===event.target?0:-1));
      grid.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const cell=event.target.closest('.gomoku-cell');hoverIndex=cell?Number(cell.dataset.index):-1;preview();});
      grid.addEventListener('pointerleave',()=>{hoverIndex=-1;preview();});
      const board=node('div','gomoku-board'),overlay=node('div','gomoku-pause-overlay');overlay.hidden=true;
      const pauseLabel=node('strong','','已暂停'),pauseHint=node('p');pauseHint.dataset.pauseHint='';
      const resume=action('继续对局',()=>{const latest=games.find(g=>g.id===shownGame);if(latest)void mutate(latest,'resume');},'primary');resume.dataset.resume='';
      const notice=node('div','gomoku-banner');notice.hidden=true;notice.setAttribute('role','status');
      const rematch=node('div','gomoku-rematch');rematch.hidden=true;rematch.setAttribute('role','dialog');rematch.setAttribute('aria-label','开始新的对局');
      const undoPanel=node('div','gomoku-undo');undoPanel.hidden=true;undoPanel.setAttribute('role','dialog');undoPanel.setAttribute('aria-label','悔棋请求');
      overlay.append(pauseLabel,pauseHint,resume);board.append(grid,overlay,notice,rematch,undoPanel);
      const pause=action('暂停对局',()=>{const latest=games.find(g=>g.id===shownGame);if(latest)void mutate(latest,'pause');});pause.dataset.pause='';
      const resign=action('认输',()=>{resigning=shownGame;render();content.querySelector('[data-resign-confirm]').scrollIntoView({block:'nearest'});content.querySelector('[data-resign-cancel]').focus({preventScroll:true});});resign.dataset.resign='';
      const confirmation=node('div','gomoku-invitation');confirmation.dataset.resignConfirm='';confirmation.hidden=true;confirmation.setAttribute('role','group');confirmation.setAttribute('aria-label','确认认输');
      const confirm=action('确认认输',()=>{const latest=games.find(g=>g.id===shownGame);resigning='';if(latest)void mutate(latest,'resign');},'primary');confirm.dataset.resignSubmit='';
      const cancel=action('取消',()=>{resigning='';render();resign.focus({preventScroll:true});});cancel.dataset.resignCancel='';
      const confirmActions=node('div','side-tool-row');confirmActions.append(cancel,confirm);confirmation.append(node('p','','认输后本局结束，对方获胜。确定认输吗？'),confirmActions);
      const restart=action('开始新的对局',()=>{dismissed.delete(`end:${shownGame}`);renderKey='';render();});restart.dataset.restart='';
      const undo=action('悔棋',()=>{const latest=games.find(g=>g.id===shownGame);if(latest)void mutate(latest,'undo-request',{id:crypto.randomUUID(),ply:latest.ply,revision:latest.revision});});undo.dataset.undo='';undo.title='申请撤回自己刚下的最新一手，需要对方同意';
      const refreshButton=action('刷新棋局',()=>void refresh()),actions=node('div','side-tool-row');actions.append(pause,undo,resign,restart,refreshButton);content.append(heading,info,board,actions,confirmation);
    }
    const heading=content.querySelector('[data-game-heading]'),peopleKey=JSON.stringify([person(game.black_id),person(game.white_id)]);
    if(heading.dataset.people!==peopleKey){heading.dataset.people=peopleKey;heading.classList.add('side-member-people');heading.replaceChildren(personLabel(game.black_id,'（黑）'),node('span','','·'),personLabel(game.white_id,'（白）'));}
    const info=content.querySelector('[data-game-info]');info.textContent=`${busy?'正在提交…':stateText(game)} · 第 ${game.ply} 手`;info.dataset.turn=game.status==='playing'&&(game.ply%2===0?game.black_id:game.white_id)===sideUser()?'mine':'other';
    content.querySelector('.gomoku-grid').setAttribute('aria-busy',String(busy));
    const isPaused=paused(game);
    const undo=undoState(game),undoPending=undo?.status==='pending';
    const undoButton=content.querySelector('[data-undo]');undoButton.hidden=game.status!=='playing';
    undoButton.disabled=busy||isPaused||undoPending||!game.ply||!Number.isInteger(game.last_cell)||(game.ply%2===1?game.black_id:game.white_id)!==sideUser()||resigning===game.id;
    const confirming=resigning===game.id&&['playing','paused'].includes(game.status);
    content.querySelector('[data-resign-confirm]').hidden=!confirming;
    content.querySelector('[data-resign-submit]').disabled=busy||!transportOnline;
    content.querySelector('[data-resign]').hidden=!['playing','paused'].includes(game.status)||confirming;content.querySelector('[data-resign]').disabled=busy||!transportOnline;
    content.querySelector('[data-pause]').hidden=game.status!=='playing';content.querySelector('[data-pause]').disabled=busy||isPaused||confirming;
    content.querySelector('.gomoku-pause-overlay').hidden=!isPaused;content.querySelector('.gomoku-grid').inert=isPaused;
    content.querySelector('[data-pause-hint]').textContent=!transportOnline?'连接已断开，进度已保存，正在等待重连':!game.black_online||!game.white_online?'有成员已离开，进度已保存，等待双方重新在线':game.manual_paused?'对局已主动暂停，点击继续对局恢复':'进度已保存，等待恢复对局';
    content.querySelector('[data-resume]').hidden=!game.manual_paused;content.querySelector('[data-resume]').disabled=busy||!transportOnline||!game.black_online||!game.white_online;
    const myTurn=(game.ply%2===0?game.black_id:game.white_id)===sideUser();
    const history=finished(game);let moves=[];try{moves=JSON.parse(game.moves||'[]');}catch{/* Legacy history has no recoverable move order. */}
    if(!Array.isArray(moves))moves=[];
    const moveNumbers=new Map(moves.flatMap((index,ply)=>Number.isInteger(index)&&index>=0&&index<225?[[index,ply+1]]:[]));
    if(history&&moveNumbers.size<game.ply)info.textContent+=' · 旧对局未保存完整落子顺序';
    const focusedIndex=cellButtons.findIndex(button=>button===document.activeElement);
    const tabIndex=focusedIndex>=0?focusedIndex:112;
    cellButtons.forEach((button,index)=>{
      if(cells[index])button.dataset.stone=String(cells[index]);else delete button.dataset.stone;
      button.dataset.last=String(game.last_cell===index);button.disabled=isPaused;
      button.setAttribute('aria-disabled',String(busy||confirming||undoPending||game.status!=='playing'||isPaused||!myTurn||Boolean(cells[index])));button.tabIndex=index===tabIndex?0:-1;
      button.setAttribute('aria-label',`${Math.floor(index/15)+1} 行 ${index%15+1} 列，${cells[index]===1?'黑棋':cells[index]===2?'白棋':'空位'}`);
      const number=history&&cells[index]?moveNumbers.get(index):null;
      if(number)button.replaceChildren(node('span','gomoku-move-number',String(number)));else button.replaceChildren();button.dataset.numbered=String(Boolean(number));
      if(number)button.setAttribute('aria-label',`${button.getAttribute('aria-label')}，第 ${number} 手`);
    });
    preview();
    const nextTurn=game.status==='playing'&&!isPaused&&!undoPending&&myTurn?`${game.id}:${game.ply}`:'';
    const notice=content.querySelector('.gomoku-banner');
    if(!nextTurn&&notice.textContent==='你的回合！'){notice.hidden=true;bannerAnimation?.cancel();}
    if(nextTurn&&nextTurn!==turnKey)banner('你的回合！');turnKey=nextTurn;
    content.querySelector('[data-restart]').hidden=!history;
    content.querySelector('[data-restart]').disabled=busy||!transportOnline;
    const pending=games.find(g=>g.rematch_of===game.id&&g.status==='invited');
    const incoming=pending?.white_id===sideUser()&&inlineInvites.has(pending.id);
    const promptKey=incoming?`invite:${pending.id}`:`end:${game.id}`;
    const popup=content.querySelector('.gomoku-rematch');
    const show=history&&!dismissed.has(promptKey)&&(!pending||incoming);
    const opening=popup.hidden||popup.dataset.promptKey!==promptKey;
    popup.hidden=!show;content.querySelector('.gomoku-grid').inert=isPaused||show;
    if(show){
      if(popup.dataset.promptKey!==promptKey){
        popup.dataset.promptKey=promptKey;
        const title=node('strong','',incoming?'对方邀请你开始新的对局':stateText(game));
        const hint=node('p','',incoming?'确认后，双方将直接进入新的棋盘。':'再来一局？向对方发出新的对局邀请。');
        const buttons=node('div','side-tool-row');
        const later=action(incoming?'拒绝':'稍后',()=>{dismissed.add(promptKey);if(incoming)void mutate(pending,'decline');else{renderKey='';render();}});
        const start=action(incoming?'确认':'开始新的对局',()=>{if(incoming)void mutate(pending,'accept');else void mutate(game,'rematch',{id:crypto.randomUUID()});},'primary');
        buttons.append(later,start);popup.replaceChildren(title,hint,buttons);
      }
      const [later,start]=popup.querySelectorAll('button');later.disabled=busy;start.disabled=busy||!transportOnline;
      if(opening&&dialog.open&&!busy)later.focus({preventScroll:true});
    }
    for(const declined of games.filter(g=>g.rematch_of===game.id&&g.status==='declined'&&g.black_id===sideUser())){
      if(!declinesShown.has(declined.id)){declinesShown.add(declined.id);dismissed.add(`end:${game.id}`);popup.hidden=true;feedback('');banner('对方已拒绝');}
    }
    content.querySelector('.gomoku-grid').inert=isPaused||!popup.hidden;
    content.querySelector('[data-restart]').hidden=!history||!popup.hidden||Boolean(pending);
    const undoPanel=content.querySelector('.gomoku-undo'),resultKey=undo?`${game.id}:${undo.id}:${undo.status}`:'';
    const rejected=undo?.status==='declined'&&undo.requester===sideUser()&&!undoResults.has(resultKey);
    const showUndo=undoPending||rejected,openingUndo=undoPanel.hidden||undoPanel.dataset.requestKey!==resultKey;
    undoPanel.hidden=!showUndo;
    if(showUndo){
      if(undoPanel.dataset.requestKey!==resultKey){
        undoPanel.dataset.requestKey=resultKey;
        const mine=undo.requester===sideUser(),title=node('strong','',rejected?'对方拒绝你的悔棋请求':mine?'正在等待对方同意':'对方请求悔棋');
        const hint=node('p','',rejected?'棋盘保持原样，继续对局。':mine?'对方同意后将撤回最新一手，处理前双方暂时不能落子。':'是否同意撤回对方刚下的最新一手？');
        const buttons=node('div','side-tool-row');
        if(rejected)buttons.append(action('继续下棋',()=>{undoResults.add(resultKey);renderKey='';render();}));
        else if(!mine){
          buttons.append(action('拒绝',()=>void mutate(game,'undo-decline',{id:undo.id})),action('同意',()=>void mutate(game,'undo-accept',{id:undo.id}),'primary'));
        }
        undoPanel.replaceChildren(title,hint,buttons);
      }
      undoPanel.querySelectorAll('button').forEach(button=>button.disabled=busy||!transportOnline);
      if(openingUndo&&dialog.open&&!busy)undoPanel.querySelector('button')?.focus({preventScroll:true});
    }
    if(dialog.open&&undo?.status==='accepted'&&undo.requester===sideUser()&&game.ply===undo.ply-1&&!undoResults.has(resultKey)){
      undoResults.add(resultKey);feedback('');banner('对方已同意，请重新落子');
    }
    content.querySelector('.gomoku-grid').inert=isPaused||!popup.hidden||showUndo;
  }
  async function mutate(game,kind,payload={}) {
    if(busy||!current()||!transportOnline)return;
    if(kind==='move'&&(resigning===game.id||undoState(game)?.status==='pending'||game.status!=='playing'||paused(game)||(game.ply%2===0?game.black_id:game.white_id)!==sideUser()||JSON.parse(game.cells)[payload.index]))return;
    busy=true;updates++;renderKey='';render();const captured=scope.signal;
    try{const result=await call(`/${game.id}/${kind}`,{method:'POST',body:{...payload,boardId}});if(captured.aborted)return;updates++;
      const known=games.find(g=>g.id===result.game.id);
      trackInvitation(result.game,known);
      if(!known)games=[result.game,...games];else games=games.map(g=>g.id===result.game.id&&g.revision<=result.game.revision?result.game:g);
      const latest=games.find(g=>g.id===result.game.id);
      turnNotifications.observe(latest);
      selected=kind==='rematch'&&latest.status==='invited'?game.id:kind==='decline'?(game.rematch_of||''):result.game.id;
      invitationBadge();feedback(kind==='rematch'?'邀请已发送':['move','accept','pause','resume','resign','undo-request','undo-accept','undo-decline'].includes(kind)?'':stateText(result.game));
    }catch(error){if(!captured.aborted)report(error);}finally{if(!captured.aborted){busy=false;renderKey='';render();void refresh();}}
  }
  async function inviteMember() {
    turnNotifications.requestPermission();
    if(busy||!members.value||!current())return;busy=true;updates++;const targetId=members.value,id=crypto.randomUUID(),captured=scope.signal;render();
    try{const result=await call('/invite',{method:'POST',body:{targetId,id,boardId}});if(captured.aborted)return;updates++;games=[result.game,...games.filter(g=>g.id!==result.game.id)];feedback('邀请已发送，接受后将创建独立棋局');}
    catch(error){if(!captured.aborted)report(error);}finally{if(!captured.aborted){busy=false;renderKey='';render();void refresh();}}
  }
  function open() {
    if(document.documentElement.classList.contains('privacy-locked'))return;
    if(!sideUser()){window.MuseAccount?.showAuth?.();return;}
    turnNotifications.requestPermission();
    if(owner!==sideIdentity()||boardId!==state.boardId||stopped)reset();
    if(!boardId){feedback('请先打开画布');return;}
    if(!dialog.open)dialog.showModal();renderKey='';render();void refresh();
  }
  async function openTarget(target) {
    if(!target?.boardId||!target?.gameId){open();return;}
    try{
      const captured=sideIdentity(),data=await sideApi(`/api/gomoku?boardId=${encodeURIComponent(target.boardId)}`);
      if(captured!==sideIdentity())return;
      if(!data.games.some(game=>game.id===target.gameId)){open();feedback('该邀请已过期或已不可访问');return;}
      if(state.boardId!==target.boardId){
        if(!state.canvases.some(canvas=>canvas.id===target.boardId))await (await import('./catalog.js')).loadCanvasCatalog({forceRender:true});
        if(captured!==sideIdentity())return;
        await (await import('./canvas-session.js')).switchCanvas(target.boardId);
      }
      if(captured!==sideIdentity()||state.boardId!==target.boardId)return;
      if(boardId!==state.boardId||owner!==sideIdentity())reset();
      const known=new Map(games.map(game=>[game.id,game]));
      games=data.games.map(game=>known.get(game.id)?.revision>game.revision?known.get(game.id):game);roster=data.members;selected=target.gameId;updates++;open();
    }catch(error){report(error);}
  }
  let pressedOutside=false;
  function outsidePanel(event) {
    if(event.target!==dialog&&event.target!==invitationModal)return false;
    const bounds=dialog.getBoundingClientRect();
    return event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;
  }
  dialog.addEventListener('pointerdown',event=>{pressedOutside=event.isPrimary&&event.button===0&&outsidePanel(event);});
  dialog.addEventListener('pointercancel',()=>{pressedOutside=false;});
  dialog.addEventListener('click',event=>{
    const dismiss=pressedOutside&&event.button===0&&outsidePanel(event);pressedOutside=false;
    if(!dismiss)return;
    event.preventDefault();event.stopPropagation();syncInvitation(null);dialog.close();
  });
  dialog.addEventListener('close',event=>{if(event.target!==dialog)return;pressedOutside=false;syncInvitation(null);resigning='';turnKey='';hoverIndex=-1;inlineInvites.clear();preview();renderKey='';trigger.focus({preventScroll:true});schedule(30000);});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&resigning){event.preventDefault();event.stopPropagation();resigning='';render();content.querySelector('[data-resign]')?.focus({preventScroll:true});}},true);
  gamePicker.addEventListener('change',()=>{resigning='';selected=gamePicker.value;feedback('');renderKey='';render();});
  window.addEventListener('muse:connection-state',event=>{if(boardId!==state.boardId)reset();transportOnline=Boolean(event.detail?.online);renderKey='';if(dialog.open)render();if(transportOnline&&current())schedule(100);});
  window.addEventListener('offline',()=>{transportOnline=false;renderKey='';if(dialog.open)render();});
  for(const event of ['muse:account-changing','muse:logout','muse:auth-expired'])window.addEventListener(event,()=>{reset();stopped=true;});
  window.addEventListener('muse:login',()=>{reset();void refresh();});
  window.addEventListener('muse:gomoku-changed',event=>{
    if(event.detail?.boardId!==state.boardId||!current())return;
    const game=event.detail.game;
    if(!game){schedule(100);return;}
    if(![game.black_id,game.white_id].includes(sideUser()))return;
    const known=games.find(g=>g.id===game.id);if(known&&(known.revision>game.revision||JSON.stringify(known)===JSON.stringify(game)))return;
    trackInvitation(game,known);
    turnNotifications.observe(game);
    updates++;games=known?games.map(g=>g.id===game.id?game:g):[game,...games];invitationBadge();
    renderKey='';if(dialog.open)render();
  });
  for(const event of ['muse:sharing-changed','focus','online'])window.addEventListener(event,e=>{if(e.detail?.boardId&&e.detail.boardId!==state.boardId)return;if(current())schedule(100);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current())schedule(100);});
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type!=='muse:push-open'||event.data?.feature!=='gomoku')return;
    event.source?.postMessage({type:'muse:push-ack',handoffId:event.data.handoffId});void openTarget(event.data);
  });
  void refresh();return {open};
}
