// Queue insertion runs in the same transaction as the committed chat message.
export function ensurePushSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES user_sessions(token_hash) ON DELETE CASCADE,
    subscription_json TEXT NOT NULL, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS push_subscription_session ON push_subscriptions(session_hash);
  CREATE TABLE IF NOT EXISTS push_cooldowns (
    user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL, until_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,board_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS push_jobs (
    endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(endpoint,message_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS push_jobs_due ON push_jobs(next_at);`);
}

export function enqueueChatPush(db, messageId) {
  if(process.env.WEB_PUSH_ENABLED!=='1')return;
  db.prepare(`INSERT OR IGNORE INTO push_jobs(endpoint,message_id,next_at,created_at)
    SELECT p.endpoint,m.id,?,? FROM chat_messages m
    JOIN canvas_catalog c ON c.board_id=m.board_id
    JOIN push_subscriptions p JOIN user_sessions s ON s.token_hash=p.session_hash
    LEFT JOIN chat_preferences pref ON pref.board_id=m.board_id AND pref.user_id=s.user_id
    WHERE m.id=? AND s.user_id<>m.sender_id AND s.expires_at>?
    AND NOT EXISTS(SELECT 1 FROM push_cooldowns pc WHERE pc.user_id=s.user_id AND pc.board_id=m.board_id AND pc.until_at>?)
    AND (c.owner_user_id=s.user_id OR (c.visibility='shared' AND EXISTS (
      SELECT 1 FROM share_members owner JOIN share_members member ON member.group_id=owner.group_id
      WHERE owner.user_id=c.owner_user_id AND member.user_id=s.user_id)))
    AND (COALESCE(pref.notification_mode,'all')='all' OR (pref.notification_mode='mentions'
      AND EXISTS(SELECT 1 FROM chat_mentions t WHERE t.message_id=m.id AND t.user_id=s.user_id)))`)
    .run(Date.now()+2000,Date.now(),messageId,Date.now(),Date.now());
}
