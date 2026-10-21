import { prepareNotificationWorker } from './push-notifications.js';

export function createGomokuTurnNotifier({userId,identity,isCurrent,openTarget}) {
  const latest=new Map(),seen=new Map();
  let generation=0;
  const supported=()=>window.isSecureContext&&'Notification' in window;
  function turn(game) {
    let undo;try{undo=JSON.parse(game.undo_request||'null');}catch{return '';}
    if(game.status!=='playing'||undo?.status==='pending'||(game.ply%2===0?game.black_id:game.white_id)!==userId())return '';
    return `${game.ply}:${game.last_cell??''}:${undo?.status==='accepted'?undo.id:''}`;
  }
  async function notify(game,key,owner,version) {
    const current=()=>generation===version&&owner===identity()&&isCurrent()&&document.hidden&&supported()&&Notification.permission==='granted'&&turn(latest.get(game.id)||{})===key;
    if(!current())return;
    const target={feature:'gomoku',boardId:game.board_id,gameId:game.id};
    let undo;try{undo=JSON.parse(game.undo_request||'null');}catch{}
    const body=game.ply===0?'棋局已开始，轮到你落子了！':undo?.status==='accepted'&&game.ply===undo.ply-1?'轮到你落子了，请返回棋盘继续对局。':'对方已落子，轮到你了！';
    const options={body,tag:`gomoku-turn-${game.id}`,data:target,icon:new URL('favicon.png',document.baseURI).href};
    try {
      if('serviceWorker' in navigator){
        const registration=await navigator.serviceWorker.getRegistration(new URL('push-sw.js',document.baseURI))||await prepareNotificationWorker();
        if(current())await registration.showNotification('五子棋 · 你的回合！',options);
      }else if(current()){
        const notification=new Notification('五子棋 · 你的回合！',options);
        notification.onclick=()=>{notification.close();if(owner!==identity()||!isCurrent())return;window.focus();void openTarget(target);};
      }
    }catch{/* Notification denial or OS delivery failure must not interrupt the game. */}
  }
  return {
    observe(game){
      const known=latest.get(game.id);if(known&&known.revision>game.revision)return;
      latest.set(game.id,game);
      const key=turn(game);if(!key)return;
      let turns=seen.get(game.id);if(!turns){turns=new Set();seen.set(game.id,turns);}
      if(turns.has(key))return;turns.add(key);
      void notify(game,key,identity(),generation);
    },
    requestPermission(){
      if(supported()&&Notification.permission==='default'&&navigator.userActivation?.isActive)void Notification.requestPermission().catch(()=>{});
    },
    reset(){generation++;latest.clear();seen.clear();}
  };
}
