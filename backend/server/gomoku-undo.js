import { gameError,readGomokuUndo } from './gomoku-store.js';

// Keep the request and its decision on the game so refresh/reconnect cannot bypass consent.
export function updateGomokuUndo(db,game,userId,action,body) {
  const previous=readGomokuUndo(game);
  if(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/.test(body.id))throw gameError('悔棋请求编号无效',400);
  if(![game.black_id,game.white_id].includes(userId))throw gameError('无权操作此对局',403);
  if(!['playing','paused'].includes(game.status))throw gameError('对局已结束，不能悔棋');
  let request,cells,moves,last;
  if(action==='undo-request') {
    if(previous?.id===body.id&&previous.requester===userId)return game;
    if(previous?.status==='pending')throw gameError('请先处理当前悔棋请求');
    if(game.status!=='playing')throw gameError('请先恢复对局');
    if(body.revision!==game.revision||body.ply!==game.ply)throw gameError('棋局已更新，请刷新后申请悔棋');
    const lastPlayer=game.ply%2===1?game.black_id:game.white_id;
    if(!game.ply||lastPlayer!==userId)throw gameError('只能撤回自己刚下的最新一手');
    if(!Number.isInteger(game.last_cell)||game.last_cell<0||game.last_cell>=225)throw gameError('当前对局未记录最新落子位置，无法悔棋');
    request={id:body.id,requester:userId,status:'pending',ply:game.ply,index:game.last_cell};
  }else{
    if(!previous||previous.id!==body.id)throw gameError('悔棋请求已更新');
    if(previous.requester===userId)throw gameError('需要对方处理悔棋请求',403);
    if(previous.status!=='pending')return game;
    if(previous.ply!==game.ply||previous.index!==game.last_cell)throw gameError('棋局已更新，无法处理悔棋');
    request={...previous,status:action==='undo-accept'?'accepted':'declined'};
    if(action==='undo-accept'){
      try{cells=JSON.parse(game.cells);moves=JSON.parse(game.moves);}catch{throw gameError('棋局数据异常，无法悔棋');}
      if(!Array.isArray(cells)||cells.length!==225||cells.some(value=>![0,1,2].includes(value))||cells.filter(Boolean).length!==game.ply||
        !Number.isInteger(game.last_cell)||game.last_cell<0||game.last_cell>=225||cells[game.last_cell]!==((game.ply-1)%2+1))throw gameError('棋局数据异常，无法悔棋');
      cells[game.last_cell]=0;
      // Legacy games retain last_cell even when the earlier sequence is unavailable.
      if(!Array.isArray(moves)||moves.length!==game.ply)moves=Array(game.ply).fill(null);
      moves.pop();last=Number.isInteger(moves.at(-1))?moves.at(-1):null;
    }
  }
  const updated=cells?db.prepare(`UPDATE gomoku_games SET undo_request=?,cells=?,moves=?,ply=ply-1,last_cell=?,revision=revision+1 WHERE id=? AND revision=?`)
    .run(JSON.stringify(request),JSON.stringify(cells),JSON.stringify(moves),last,game.id,game.revision):
    db.prepare('UPDATE gomoku_games SET undo_request=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(request),game.id,game.revision);
  if(!updated.changes)throw gameError('棋局已更新，请重试');
  return db.prepare('SELECT * FROM gomoku_games WHERE id=?').get(game.id);
}
