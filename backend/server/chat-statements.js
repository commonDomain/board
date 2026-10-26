// Statements are reused per connection; user/board values are always bound.
const connections = new WeakMap();
export function chatStatement(db, sql) {
  let statements = connections.get(db);
  if (!statements) { statements = new Map(); connections.set(db, statements); }
  let statement = statements.get(sql);
  if (!statement) { statement = db.prepare(sql); statements.set(sql, statement); }
  return statement;
}
