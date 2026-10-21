import { clients } from './board-registry.js';
import { servicesRuntime } from './runtime/services.js';
import { sendWs } from './websocket-transport.js';
import { sameGroup } from './gomoku-store.js';

export function gomokuUserOnline(userId, presence) {
  if(presence?.has(userId))return presence.get(userId);
  const db=servicesRuntime.database,now=Date.now();
  for(const client of clients) {
    if(client.userId!==userId||!client.board||client.socket?.readyState!==1||client.sessionExpiresAt<=now)continue;
    if(db.prepare('SELECT 1 FROM user_sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(client.sessionTokenHash,userId,now)){presence?.set(userId,true);return true;}
  }
  presence?.set(userId,false);return false;
}
export function notifyGomokuChanged(game) {
  const {accountService:account,database:db}=servicesRuntime,now=Date.now();
  if(!sameGroup(account,game))return;
  const view=gomokuView(game,new Map());
  for(const client of clients)if([game.black_id,game.white_id].includes(client.userId)&&client.sessionExpiresAt>now&&client.socket?.readyState===1&&
    db.prepare('SELECT 1 FROM user_sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(client.sessionTokenHash,client.userId,now))sendWs(client,{type:'gomoku-changed',boardId:game.board_id,game:view});
}
export function reconcileGomokuGame(game, presence) {
  if(!['playing','paused'].includes(game.status))return game;
  const db=servicesRuntime.database,now=Date.now(),online=gomokuUserOnline(game.black_id,presence)&&gomokuUserOnline(game.white_id,presence);
  if(game.status==='playing'&&!online) {
    db.prepare("UPDATE gomoku_games SET status='paused',paused_at=?,revision=revision+1 WHERE id=? AND status='playing'").run(now,game.id);
  }else if(game.status==='paused'&&online&&!game.manual_paused) {
    db.prepare("UPDATE gomoku_games SET status='playing',expires_at=expires_at+?,paused_at=NULL,revision=revision+1 WHERE id=? AND status='paused'")
      .run(Math.max(0,now-(game.paused_at||now)),game.id);
  }else return game;
  const updated=db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(game.id);notifyGomokuChanged(updated);return updated;
}
export function reconcileGomokuUser(userId) {
  const db=servicesRuntime.database;if(!db||!userId)return;
  const games=db.prepare("SELECT * FROM gomoku_games WHERE (black_id=? OR white_id=?) AND status IN ('playing','paused')").all(userId,userId);
  const presence=new Map();
  for(const game of games){const next=reconcileGomokuGame(game,presence);if(next.revision===game.revision)notifyGomokuChanged(next);}
}
export function gomokuView(game, presence) {
  return {...game,black_online:gomokuUserOnline(game.black_id,presence),white_online:gomokuUserOnline(game.white_id,presence)};
}
