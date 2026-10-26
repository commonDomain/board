import crypto from 'node:crypto';

export const GAME_TTL = 24 * 60 * 60 * 1000;
export const INVITE_TTL = 10 * 60 * 1000;
export function ensureGomokuSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS gomoku_games (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
    black_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    white_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL, cells TEXT NOT NULL, ply INTEGER NOT NULL DEFAULT 0,
    winner TEXT, last_cell INTEGER, revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS gomoku_black ON gomoku_games(black_id,expires_at);
  CREATE INDEX IF NOT EXISTS gomoku_white ON gomoku_games(white_id,expires_at);
  CREATE INDEX IF NOT EXISTS gomoku_expiry ON gomoku_games(expires_at);
  CREATE TABLE IF NOT EXISTS gomoku_push_jobs (
    game_id TEXT PRIMARY KEY REFERENCES gomoku_games(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS gomoku_preferences (
    user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
    notifications_enabled INTEGER NOT NULL DEFAULT 0 CHECK(notifications_enabled IN (0,1))
  ) STRICT;`);
  if(!db.prepare('PRAGMA table_info(gomoku_games)').all().some(column=>column.name==='paused_at'))db.exec('ALTER TABLE gomoku_games ADD COLUMN paused_at INTEGER');
  if(!db.prepare('PRAGMA table_info(gomoku_games)').all().some(column=>column.name==='manual_paused'))db.exec('ALTER TABLE gomoku_games ADD COLUMN manual_paused INTEGER NOT NULL DEFAULT 0');
  if(!db.prepare('PRAGMA table_info(gomoku_games)').all().some(column=>column.name==='board_id'))db.exec('ALTER TABLE gomoku_games ADD COLUMN board_id TEXT');
  if(!db.prepare('PRAGMA table_info(gomoku_games)').all().some(column=>column.name==='moves'))db.exec("ALTER TABLE gomoku_games ADD COLUMN moves TEXT NOT NULL DEFAULT '[]'");
  if(!db.prepare('PRAGMA table_info(gomoku_games)').all().some(column=>column.name==='rematch_of'))db.exec('ALTER TABLE gomoku_games ADD COLUMN rematch_of TEXT');
  if(!db.prepare('PRAGMA table_info(gomoku_games)').all().some(column=>column.name==='undo_request'))db.exec('ALTER TABLE gomoku_games ADD COLUMN undo_request TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS gomoku_board_players ON gomoku_games(board_id,black_id,white_id,status)');
  // Older versions left full boards active. Finish these games during upgrade.
  for(const game of db.prepare("SELECT id,cells FROM gomoku_games WHERE ply=225 AND winner IS NULL AND status IN ('playing','paused')").all()){
    let cells;try{cells=JSON.parse(game.cells);}catch{continue;}
    if(!Array.isArray(cells)||cells.length!==225||cells.some(value=>![1,2].includes(value))||cells.filter(value=>value===1).length!==113||cells.some((color,index)=>hasFive(cells,index,color)))continue;
    db.prepare("UPDATE gomoku_games SET status='draw',manual_paused=0,paused_at=NULL,expires_at=?,revision=revision+1 WHERE id=?").run(Date.now()+GAME_TTL,game.id);
  }
}
export function gameError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}
export function readGomokuUndo(game) {
  try{return JSON.parse(game.undo_request||'null');}catch{return null;}
}
export function sameGroup(account, game) {
  if(account.sharingEnabled===false)return false;
  const a = account.groupForUser(game.black_id), b = account.groupForUser(game.white_id);
  return Boolean(a && b && a.id === game.group_id && b.id === game.group_id && (!game.board_id ||
    account.canAccessBoard(game.black_id,game.board_id)&&account.canAccessBoard(game.white_id,game.board_id)));
}
export const liveGomoku=game=>['invited','playing','paused'].includes(game.status);
export function requireGomokuBoard(account,userId,boardId) {
  if(typeof boardId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(boardId)||!account.canAccessBoard(userId,boardId))throw gameError('无权访问该画布',404);
  return boardId;
}
export function bindLegacyGames(db,account,userId,boardId) {
  const games=db.prepare('SELECT * FROM gomoku_games WHERE board_id IS NULL AND (black_id=? OR white_id=?)').all(userId,userId);
  for(const game of games)if(sameGroup(account,game)&&account.canAccessBoard(game.black_id,boardId)&&account.canAccessBoard(game.white_id,boardId))
    db.prepare('UPDATE gomoku_games SET board_id=?,revision=revision+1 WHERE id=? AND board_id IS NULL').run(boardId,game.id);
}
export function hasFive(cells, index, color) {
  const x = index % 15, y = Math.floor(index / 15);
  return [[1,0],[0,1],[1,1],[1,-1]].some(([dx,dy]) => {
    let count = 1;
    for (const sign of [-1,1]) {
      for (let n=1;n<15;n++) {
        const xx=x+dx*n*sign, yy=y+dy*n*sign;
        if (xx<0 || xx>=15 || yy<0 || yy>=15 || cells[yy*15+xx]!==color) break;
        count++;
      }
    }
    return count>=5;
  });
}
export function moveGame(db, game, userId, index, ply, revision) {
  if (![game.black_id,game.white_id].includes(userId)) throw gameError('无权操作此对局',403);
  if(!Number.isInteger(index)||index<0||index>=225||!Number.isInteger(ply)||ply<0||ply>224)throw gameError('落子参数无效',400);
  let cells;
  try { cells=JSON.parse(game.cells); } catch { throw gameError('棋局数据异常，请联系管理员',409); }
  if (!Array.isArray(cells)||cells.length!==225||cells.some(value=>![0,1,2].includes(value))||cells.filter(Boolean).length!==game.ply)
    throw gameError('棋局数据异常，请联系管理员',409);
  if(cells.filter(value=>value===1).length!==Math.ceil(game.ply/2)||cells.filter(value=>value===2).length!==Math.floor(game.ply/2))
    throw gameError('棋局数据异常，请联系管理员',409);
  const color = game.ply % 2 === 0 ? 1 : 2;
  // Retrying the last confirmed move is safe after a lost HTTP response.
  if (game.ply===ply+1 && game.last_cell===index && cells[index]===(userId===game.black_id?1:2)) return game;
  if(readGomokuUndo(game)?.status==='pending')throw gameError('正在等待对方处理悔棋请求，暂时不能落子');
  if(revision!==undefined&&revision!==game.revision)throw gameError('棋局已更新，请刷新后继续');
  if (game.status!=='playing' || game.ply!==ply) throw gameError('棋局已更新，请刷新后继续');
  if ((color===1?game.black_id:game.white_id)!==userId) throw gameError('请等待对方落子');
  if (!Number.isInteger(index) || index<0 || index>=225 || cells[index]) throw gameError('请选择空的交叉点',400);
  cells[index]=color;
  let moves;try{moves=JSON.parse(game.moves||'[]');}catch{moves=[];}
  // Missing legacy move order cannot be inferred from the final board.
  if(!Array.isArray(moves)||moves.length!==game.ply)moves=Array(game.ply).fill(null);
  moves.push(index);
  const winner=hasFive(cells,index,color)?userId:null;
  const status=winner?'won':game.ply===224?'draw':'playing';
  const updated=db.prepare(`UPDATE gomoku_games SET cells=?,moves=?,ply=ply+1,last_cell=?,winner=?,status=?,expires_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='playing' AND ply=?`)
    .run(JSON.stringify(cells),JSON.stringify(moves),index,winner,status,status!=='playing'?Date.now()+GAME_TTL:game.expires_at,game.id,game.revision,ply);
  if(!updated.changes)throw gameError('棋局已更新，请刷新后继续');
  return db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(game.id);
}
export function createGame(db, account, userId, targetId, id = crypto.randomUUID(),boardId) {
  requireGomokuBoard(account,userId,boardId);
  if(typeof targetId!=='string'||!/^[0-9a-f-]{36}$/.test(targetId))throw gameError('成员无效',400);
  if(account.sharingEnabled===false)throw gameError('实时共享暂时关闭',403);
  const group=account.groupForUser(userId), target=account.groupForUser(targetId);
  if (!group || !target || group.id!==target.id || userId===targetId) throw gameError('只能邀请当前共享组的其他成员',403);
  if(!account.canAccessBoard(targetId,boardId))throw gameError('只能邀请有权访问当前画布的成员',403);
  if (typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)) throw gameError('邀请编号无效',400);
  const prior=db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(id);
  if (prior) {
    if (prior.black_id!==userId || prior.white_id!==targetId || prior.board_id!==boardId) throw gameError('邀请编号冲突');
    return prior;
  }
  const now=Date.now();
  db.exec('BEGIN IMMEDIATE');
  try{
    const busy=db.prepare(`SELECT * FROM gomoku_games WHERE board_id=? AND group_id=? AND
      (status IN ('playing','paused') OR (status='invited' AND expires_at>?))
      AND ((black_id=? AND white_id=?) OR (black_id=? AND white_id=?))`).all(boardId,group.id,now,userId,targetId,targetId,userId);
    if(busy.some(g=>sameGroup(account,g)))throw gameError('你与该成员在此画布已有邀请或对局，请继续原棋局');
    for(const player of [userId,targetId]){
      const count=db.prepare(`SELECT count(*) AS n FROM gomoku_games WHERE board_id=? AND (black_id=? OR white_id=?) AND
        (status IN ('playing','paused') OR (status='invited' AND expires_at>?))`).get(boardId,player,player,now).n;
      if(count>=32)throw gameError('此画布同时进行的对局过多，请先完成部分对局');
    }
    db.prepare(`INSERT INTO gomoku_games(id,group_id,board_id,black_id,white_id,status,cells,created_at,expires_at)
      VALUES (?,?,?,?,?,'invited',?,?,?)`).run(id,group.id,boardId,userId,targetId,JSON.stringify(Array(225).fill(0)),now,now+INVITE_TTL);
    if (process.env.WEB_PUSH_ENABLED==='1')
      db.prepare('INSERT INTO gomoku_push_jobs(game_id,next_at) VALUES (?,?)').run(id,now);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(id);
}
