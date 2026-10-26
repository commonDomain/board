import { sameGroup } from './gomoku-store.js';

// Uses the existing opted-in browser subscriptions, with its own small queue.
export async function drainGomokuPush(db,account,config,send) {
  const jobs=db.prepare(`SELECT g.*,j.attempts FROM gomoku_push_jobs j JOIN gomoku_games g ON g.id=j.game_id WHERE j.next_at<=? LIMIT 4`).all(Date.now());
  for (const job of jobs) {
    const remove=()=>db.prepare('DELETE FROM gomoku_push_jobs WHERE game_id=?').run(job.id);
    if (job.status!=='invited' || job.expires_at<=Date.now() || !sameGroup(account,job)) {remove();continue;}
    const subscriptions=db.prepare(`SELECT p.* FROM push_subscriptions p JOIN user_sessions s ON s.token_hash=p.session_hash WHERE s.user_id=? AND s.expires_at>? LIMIT 8`).all(job.white_id,Date.now());
    let retry=false;
    await Promise.all(subscriptions.map(async row=>{
      const current=db.prepare('SELECT status FROM gomoku_games WHERE id=?').get(job.id);
      if (current?.status!=='invited' || !sameGroup(account,job)) return;
      try {
        await send(JSON.parse(row.subscription_json),JSON.stringify({title:'Museboard',body:'你收到一个五子棋邀请',tag:`gomoku-${job.id}`,feature:'gomoku',boardId:job.board_id,gameId:job.id}),{vapidDetails:config,TTL:Math.max(1,Math.floor((job.expires_at-Date.now())/1000)),timeout:5000,urgency:'normal'});
      } catch(error) {
        if ([404,410].includes(error.statusCode)) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND session_hash=?').run(row.endpoint,row.session_hash);
        else retry=true;
      }
    }));
    if (retry && job.attempts<3) db.prepare('UPDATE gomoku_push_jobs SET attempts=attempts+1,next_at=? WHERE game_id=?').run(Date.now()+30000,job.id);
    else remove();
  }
}
