import webpush from 'web-push';
import { servicesRuntime } from './runtime/services.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { createMemoryRateLimiter } from './rate-limits.js';
import chatHistory from '../chat-history.js';
import { drainGomokuPush } from './gomoku-push.js';

const limit=createMemoryRateLimiter(20,60000);
let settings, timer, pending;
export function pushSettings() {
  if(settings!==undefined)return settings;
  if(process.env.WEB_PUSH_ENABLED!=='1')return settings=null;
  const subject=process.env.WEB_PUSH_SUBJECT,publicKey=process.env.WEB_PUSH_PUBLIC_KEY,privateKey=process.env.WEB_PUSH_PRIVATE_KEY;
  // Validate once at startup; never expose the private key to the browser.
  webpush.setVapidDetails(subject,publicKey,privateKey);
  return settings={subject,publicKey,privateKey};
}

export function validatePushSubscription(input) {
  const fail=()=>{throw Object.assign(new Error('浏览器推送订阅无效'),{statusCode:400});};
  if(typeof input?.endpoint!=='string'||input.endpoint.length>2048)fail();
  let url;try{url=new URL(input.endpoint);}catch{fail();}
  // Never allow an authenticated client to turn the sender into an arbitrary URL fetcher.
  const allowed=url.hostname==='fcm.googleapis.com'||url.hostname==='updates.push.services.mozilla.com'||
    url.hostname==='web.push.apple.com'||url.hostname==='wns.windows.com'||url.hostname.endsWith('.notify.windows.com');
  if(!allowed||url.protocol!=='https:'||url.port||url.username||url.password||url.hash)fail();
  for(const [key,size] of [['p256dh',65],['auth',16]]){
    const value=input.keys?.[key];
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||Buffer.from(value,'base64url').length!==size)fail();
  }
  if(Buffer.from(input.keys.p256dh,'base64url')[0]!==4)fail();
  return {endpoint:url.href,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
}

export async function handlePushApi(req,res,url) {
  if(url.pathname!=='/api/push/subscription')return false;
  const account=servicesRuntime.accountService,db=servicesRuntime.database;
  let session=account.requireSession(req,{requireCsrf:req.method!=='GET'});
  if(!session?.userId)throw Object.assign(new Error('请先登录'),{statusCode:401});
  const config=pushSettings();
  if(req.method==='GET'){
    sendJson(res,200,{enabled:Boolean(config),publicKey:config?.publicKey||null,
      endpoints:db.prepare('SELECT endpoint FROM push_subscriptions WHERE session_hash=?').all(session.tokenHash).map(row=>row.endpoint)});return true;
  }
  if(!['PUT','DELETE'].includes(req.method)){sendJson(res,405,{error:'不支持的操作'});return true;}
  if(!limit(session.userId))throw Object.assign(new Error('操作过于频繁，请稍后重试'),{statusCode:429});
  const input=await readJsonBody(req,4096);
  session=account.requireSession(req,{requireCsrf:true});
  if(!session?.userId)throw Object.assign(new Error('请先登录'),{statusCode:401});
  if(req.method==='DELETE'){
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND session_hash=?').run(String(input?.endpoint||''),session.tokenHash);
  }else{
    if(!config)throw Object.assign(new Error('服务器尚未启用桌面通知'),{statusCode:503});
    const subscription=validatePushSubscription(input);
    // Endpoint ownership moves atomically on explicit opt-in after account/session changes.
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND session_hash<>?').run(subscription.endpoint,session.tokenHash);
      if(db.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE session_hash=? AND endpoint<>?').get(session.tokenHash,subscription.endpoint).n>=8)
        throw Object.assign(new Error('本次登录的通知设备过多'),{statusCode:409});
      db.prepare(`INSERT INTO push_subscriptions VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription_json=excluded.subscription_json`)
        .run(subscription.endpoint,session.tokenHash,JSON.stringify(subscription),Date.now());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  sendJson(res,200,{ok:true});return true;
}

export async function drainPushQueue(db,account,config,send=webpush.sendNotification.bind(webpush)) {
  const now=Date.now();
  db.prepare('DELETE FROM push_jobs WHERE created_at<?').run(now-3600000);
  db.prepare('DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM user_sessions WHERE expires_at<=?)').run(now);
  const jobs=db.prepare(`SELECT j.*,p.subscription_json,p.session_hash,s.user_id,m.board_id,m.sequence,m.sent_at,m.withdrawn_at,
    COALESCE(pref.notification_mode,'all') AS mode,
    EXISTS(SELECT 1 FROM chat_mentions t WHERE t.message_id=m.id AND t.user_id=s.user_id) AS mentioned,
    COALESCE(r.sequence,0) AS read_sequence,
    EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=s.user_id) AS hidden
    FROM push_jobs j JOIN push_subscriptions p ON p.endpoint=j.endpoint
    JOIN user_sessions s ON s.token_hash=p.session_hash JOIN chat_messages m ON m.id=j.message_id
    LEFT JOIN chat_preferences pref ON pref.board_id=m.board_id AND pref.user_id=s.user_id
    LEFT JOIN chat_read_positions r ON r.board_id=m.board_id AND r.user_id=s.user_id
    WHERE j.next_at<=? ORDER BY j.next_at LIMIT 20`).all(now);
  const remove=job=>db.prepare('DELETE FROM push_jobs WHERE endpoint=? AND message_id=?').run(job.endpoint,job.message_id);
  const groups=new Map();
  for(const job of jobs){const key=JSON.stringify([job.user_id,job.board_id]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job);}
  await Promise.all([...groups.values()].map(async group=>{for(const job of group){
    // Re-read after each await: another device/message in this group may have succeeded.
    const cooldown=db.prepare('SELECT * FROM push_cooldowns WHERE user_id=? AND board_id=?').get(job.user_id,job.board_id);
    if(cooldown&&cooldown.message_id!==job.message_id&&(cooldown.until_at>Date.now()||job.sent_at<cooldown.until_at)){remove(job);continue;}
    const session=db.prepare('SELECT 1 FROM push_subscriptions p JOIN user_sessions s ON s.token_hash=p.session_hash WHERE p.endpoint=? AND p.session_hash=? AND s.expires_at>?').get(job.endpoint,job.session_hash,Date.now());
    if(!session){remove(job);continue;}
    const current=db.prepare(`SELECT m.withdrawn_at,
      EXISTS(SELECT 1 FROM chat_hidden_messages h WHERE h.message_id=m.id AND h.user_id=?) AS hidden,
      COALESCE((SELECT notification_mode FROM chat_preferences WHERE board_id=m.board_id AND user_id=?),'all') AS mode,
      COALESCE((SELECT sequence FROM chat_read_positions WHERE board_id=m.board_id AND user_id=?),0) AS read_sequence
      FROM chat_messages m WHERE m.id=?`).get(job.user_id,job.user_id,job.user_id,job.message_id);
    if(!current){remove(job);continue;}Object.assign(job,current);
    if(job.withdrawn_at||job.hidden||job.read_sequence>=job.sequence||job.mode==='none'||job.mode==='mentions'&&!job.mentioned||!account.canAccessBoard(job.user_id,job.board_id)||job.sequence<chatHistory.chatHistoryStart(db,job.board_id,job.user_id)){remove(job);continue;}
    try{
      // Generic text avoids leaking chat contents on lock screens or after queued delivery.
      await send(JSON.parse(job.subscription_json),JSON.stringify({title:'Museboard',body:job.mentioned?'画布群聊中有人提及你':'画布群聊有新消息',
        tag:`chat-${job.board_id}`,boardId:job.board_id,sequence:job.sequence}),
        {vapidDetails:config,TTL:300,timeout:5000,urgency:'normal'});
      db.prepare(`INSERT INTO push_cooldowns VALUES (?,?,?,?) ON CONFLICT(user_id,board_id) DO UPDATE SET message_id=excluded.message_id,until_at=excluded.until_at WHERE push_cooldowns.message_id<>excluded.message_id`)
        .run(job.user_id,job.board_id,job.message_id,Date.now()+10*60*1000);
      remove(job);
    }catch(error){
      if([404,410].includes(error.statusCode))db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND subscription_json=? AND session_hash=?').run(job.endpoint,job.subscription_json,job.session_hash);
      else if(job.attempts>=4 || error.statusCode>=400&&error.statusCode<500&&![408,429].includes(error.statusCode))remove(job);
      else db.prepare('UPDATE push_jobs SET attempts=attempts+1,next_at=? WHERE endpoint=? AND message_id=?')
        .run(Date.now()+Math.min(300000,5000*2**job.attempts),job.endpoint,job.message_id);
      console.warn('Web Push delivery failed',Number(error.statusCode)||'network');
    }
  }}));
}

export function startWebPush() {
  const config=pushSettings();if(!config)return;
  timer=setInterval(()=>{if(pending)return;pending=Promise.all([
    drainPushQueue(servicesRuntime.database,servicesRuntime.accountService,config),
    drainGomokuPush(servicesRuntime.database,servicesRuntime.accountService,config,webpush.sendNotification.bind(webpush))])
    .catch(()=>console.error('Web Push queue processing failed')).finally(()=>{pending=null;});},2000);
  timer.unref();
}
export async function stopWebPush(){clearInterval(timer);await pending;}
