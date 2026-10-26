import { servicesRuntime } from './runtime/services.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { createMemoryRateLimiter } from './rate-limits.js';
import { createGame, gameError, sameGroup, moveGame, GAME_TTL,requireGomokuBoard,bindLegacyGames } from './gomoku-store.js';
import { reconcileGomokuGame,gomokuView,gomokuUserOnline,notifyGomokuChanged as changed } from './gomoku-presence.js';
import { updateGomokuUndo } from './gomoku-undo.js';

const writes=createMemoryRateLimiter(60,60000), reads=createMemoryRateLimiter(100,60000);
let cleaned=0;
let maintenance=null;
export function startGomokuMaintenance() {
  if(maintenance)return;
  // A restart has no connected players. Preserve running games before expiry cleanup.
  servicesRuntime.database.prepare("UPDATE gomoku_games SET status='paused',paused_at=?,expires_at=MAX(expires_at,?),revision=revision+1 WHERE status='playing'").run(Date.now(),Date.now()+GAME_TTL);
  const clean=()=>servicesRuntime.database.prepare("DELETE FROM gomoku_games WHERE status NOT IN ('playing','paused') AND expires_at<=?").run(Date.now());
  clean();if(!maintenance){maintenance=setInterval(clean,60000);maintenance.unref();}
}
export function stopGomokuMaintenance(){clearInterval(maintenance);maintenance=null;}
export async function handleGomokuApi(req,res,url) {
  if (url.pathname!=='/api/gomoku'&&!url.pathname.startsWith('/api/gomoku/')) return false;
  const account=servicesRuntime.accountService, db=servicesRuntime.database;
  const session=account.requireSession(req,{requireCsrf:req.method!=='GET'}), userId=session?.userId;
  if (!userId) throw gameError('请先登录',401);
  if (!(req.method==='GET'?reads:writes)(userId)) throw gameError('操作过于频繁，请稍后重试',429);
  const now=Date.now();
  if (now-cleaned>60000) {db.prepare("DELETE FROM gomoku_games WHERE status NOT IN ('playing','paused') AND expires_at<=?").run(now);cleaned=now;}
  if (url.pathname==='/api/gomoku' && req.method==='GET') {
    const boardId=requireGomokuBoard(account,userId,url.searchParams.get('boardId'));
    bindLegacyGames(db,account,userId,boardId);
    const active=db.prepare(`SELECT * FROM gomoku_games WHERE board_id=? AND (black_id=? OR white_id=?) AND
      (status IN ('playing','paused') OR (status='invited' AND expires_at>?)) ORDER BY created_at DESC`).all(boardId,userId,userId,now);
    const history=db.prepare(`SELECT * FROM gomoku_games WHERE board_id=? AND (black_id=? OR white_id=?) AND status NOT IN ('playing','paused','invited')
      AND expires_at>? ORDER BY created_at DESC LIMIT 12`).all(boardId,userId,userId,now);
    const sharing=account.getSharing(userId);
    const presence=new Map();
    sendJson(res,200,{games:[...active,...history].filter(g=>sameGroup(account,g)).map(g=>reconcileGomokuGame(g,presence)).map(g=>gomokuView(g,presence)),
      members:(sharing.members||[]).filter(m=>m.id!==userId&&account.canAccessBoard(m.id,boardId)).map(m=>({id:m.id,username:m.username,avatarUrl:m.avatarUrl||null}))});return true;
  }
  if (req.method!=='POST') throw gameError('不支持的操作',405);
  const body=await readJsonBody(req,2048);
  if(!body||typeof body!=='object'||Array.isArray(body))throw gameError('请求参数无效',400);
  const fresh=account.requireSession(req,{requireCsrf:true});
  if (fresh?.userId!==userId) throw gameError('会话已失效',401);
  if (url.pathname==='/api/gomoku/invite') {
    const boardId=requireGomokuBoard(account,userId,body?.boardId);bindLegacyGames(db,account,userId,boardId);
    const game=createGame(db,account,userId,body?.targetId,body?.id,boardId);changed(game);
    sendJson(res,200,{game:gomokuView(game)});return true;
  }
  const match=url.pathname.match(/^\/api\/gomoku\/([0-9a-f-]{36})\/(accept|decline|cancel|move|resign|pause|resume|rematch|undo-request|undo-accept|undo-decline)$/);
  if (!match) throw gameError('操作不存在',404);
  let game=db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(match[1]);
  if (!game || ![game.black_id,game.white_id].includes(userId) || !sameGroup(account,game) || !['playing','paused'].includes(game.status)&&game.expires_at<=Date.now()) throw gameError('邀请已过期或无权访问',404);
  if(body.boardId!==undefined&&body.boardId!==game.board_id)throw gameError('棋局不属于当前画布',404);
  game=reconcileGomokuGame(game);
  const action=match[2];
  if(action.startsWith('undo-')) {
    game=updateGomokuUndo(db,game,userId,action,body);
    changed(game);sendJson(res,200,{game:gomokuView(game)});return true;
  }
  if(action==='rematch') {
    if(!['won','resigned','draw'].includes(game.status))throw gameError('请在本局结束后开始新的对局');
    // Requests run synchronously through SQLite: the first click owns the invitation.
    let next=db.prepare("SELECT * FROM gomoku_games WHERE rematch_of=? AND (status IN ('playing','paused') OR (status='invited' AND expires_at>?)) ORDER BY created_at DESC LIMIT 1").get(game.id,now);
    if(!next){
      next=createGame(db,account,userId,userId===game.black_id?game.white_id:game.black_id,body.id,game.board_id);
      db.prepare('UPDATE gomoku_games SET rematch_of=? WHERE id=?').run(game.id,next.id);
      next=db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(next.id);
    }
    changed(next);sendJson(res,200,{game:gomokuView(next)});return true;
  }
  if(game.status==='paused'&&['move','accept'].includes(action))throw gameError('棋局已暂停，请先恢复对局');
  if(action==='pause') {
    if(!['playing','paused'].includes(game.status))throw gameError('当前没有可暂停的对局');
    db.prepare("UPDATE gomoku_games SET status='paused',manual_paused=1,paused_at=COALESCE(paused_at,?),revision=revision+1 WHERE id=? AND manual_paused=0").run(Date.now(),game.id);
  }else if(action==='resume') {
    if(!gomokuUserOnline(game.black_id)||!gomokuUserOnline(game.white_id))throw gameError('请等待双方重新在线后继续');
    if(game.status==='paused')db.prepare('UPDATE gomoku_games SET manual_paused=0,revision=revision+1 WHERE id=? AND manual_paused=1').run(game.id);
    else if(game.status!=='playing')throw gameError('对局已结束');
  }else if (action==='move') game=moveGame(db,game,userId,body?.index,body?.ply,body?.revision);
  else if (action==='accept') {
    if (userId!==game.white_id) throw gameError('仅受邀成员可以接受',403);
    if (game.status==='invited') db.prepare("UPDATE gomoku_games SET status='playing',expires_at=?,revision=revision+1 WHERE id=?").run(now+GAME_TTL,game.id);
    else if (game.status!=='playing') throw gameError('邀请已结束');
  } else if (action==='resign') {
    if (['playing','paused'].includes(game.status)) db.prepare("UPDATE gomoku_games SET status='resigned',winner=?,manual_paused=0,paused_at=NULL,undo_request=NULL,expires_at=?,revision=revision+1 WHERE id=?").run(userId===game.black_id?game.white_id:game.black_id,Date.now()+GAME_TTL,game.id);
  } else {
    if (userId!==(action==='cancel'?game.black_id:game.white_id)) throw gameError('无权处理此邀请',403);
    if(['playing','paused'].includes(game.status))throw gameError('开局后只能通过胜负或认输结束对局');
    if (game.status==='invited') db.prepare('UPDATE gomoku_games SET status=?,revision=revision+1 WHERE id=?').run(action==='cancel'?'cancelled':'declined',game.id);
  }
  game=reconcileGomokuGame(db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(game.id));
  changed(game);sendJson(res,200,{game:gomokuView(game)});return true;
}
