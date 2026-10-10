'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackupBundle } = require('./backup-bundle');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));
const MAX_CANVASES = Number.parseInt(process.env.MAX_CANVASES || '10', 10);
const ACCOUNT_ID_PATTERN = /^MB-(?:[A-Z0-9]{4}-){2}[A-Z0-9]{4}$/;

function parseArguments(argv) {
  const options = { dataDir: DEFAULT_DATA_DIR, fromAccountId: '', toAccountId: '', execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--data-dir') options.dataDir = path.resolve(argv[++index] || '');
    else if (argument === '--from-account-id') options.fromAccountId = String(argv[++index] || '').trim().toUpperCase();
    else if (argument === '--to-account-id') options.toAccountId = String(argv[++index] || '').trim().toUpperCase();
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--dry-run') options.execute = false;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function usage() {
  return [
    '用法：',
    '  node scripts/transfer-account-canvases.js --data-dir <DATA_DIR> --from-account-id <MB-...> --to-account-id <MB-...> [--execute]',
    '',
    '默认仅预演。添加 --execute 后，转移源账号名下全部正式画布的所有权。',
    '两个账号必须位于同一共享组。正式执行前必须正常停止画板服务。',
    '执行前会在 DATA_DIR/backups 中创建并校验 SQLite 备份与相关资源清单。'
  ].join('\n');
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function findSharedGroup(database, firstUserId, secondUserId) {
  return database.prepare(`
    SELECT g.id
    FROM share_groups AS g
    WHERE (g.owner_user_id = ? OR EXISTS (
      SELECT 1 FROM share_members AS m WHERE m.group_id = g.id AND m.user_id = ?
    ))
      AND (g.owner_user_id = ? OR EXISTS (
        SELECT 1 FROM share_members AS m WHERE m.group_id = g.id AND m.user_id = ?
      ))
    LIMIT 1
  `).get(firstUserId, firstUserId, secondUserId, secondUserId);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.dataDir) throw new Error('DATA_DIR 不能为空。');
  if (!ACCOUNT_ID_PATTERN.test(options.fromAccountId)) throw new Error('必须提供有效的 --from-account-id。');
  if (!ACCOUNT_ID_PATTERN.test(options.toAccountId)) throw new Error('必须提供有效的 --to-account-id。');
  if (options.fromAccountId === options.toAccountId) throw new Error('转出账号和接收账号不能相同。');
  if (!Number.isInteger(MAX_CANVASES) || MAX_CANVASES < 1) throw new Error('MAX_CANVASES 配置无效。');

  const databaseFile = path.join(options.dataDir, 'whiteboard.sqlite');
  if (!fs.existsSync(databaseFile)) throw new Error(`找不到数据库：${databaseFile}`);
  const database = new DatabaseSync(databaseFile);
  try {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA busy_timeout = 1000');
    for (const table of ['boards', 'canvas_catalog', 'user_accounts', 'share_groups', 'share_members']) {
      if (!tableExists(database, table)) throw new Error(`数据库缺少 ${table} 表，请先启动新版服务完成 schema 迁移。`);
    }
    const accountQuery = database.prepare('SELECT id, account_id, username FROM user_accounts WHERE account_id = ?');
    const sourceAccount = accountQuery.get(options.fromAccountId);
    const targetAccount = accountQuery.get(options.toAccountId);
    if (!sourceAccount) throw new Error(`找不到转出账号 ${options.fromAccountId}。`);
    if (!targetAccount) throw new Error(`找不到接收账号 ${options.toAccountId}。`);
    if (!findSharedGroup(database, sourceAccount.id, targetAccount.id)) throw new Error('两个账号不在同一共享组，拒绝转移。');

    const sources = database.prepare(`
      SELECT c.board_id, c.name, c.sort_order, c.visibility, b.revision, length(b.state_json) AS state_bytes
      FROM canvas_catalog AS c
      JOIN boards AS b ON b.id = c.board_id
      WHERE c.owner_user_id = ?
      ORDER BY c.sort_order, c.board_id
    `).all(sourceAccount.id);
    if (!sources.length) {
      console.log(`无需转移：${options.fromAccountId} 名下没有正式画布。`);
      return;
    }
    const targetCanvases = database.prepare('SELECT board_id, name, sort_order FROM canvas_catalog WHERE owner_user_id = ? ORDER BY sort_order').all(targetAccount.id);
    if (targetCanvases.length + sources.length > MAX_CANVASES) {
      throw new Error(`转移后接收账号将有 ${targetCanvases.length + sources.length} 块画布，超过上限 ${MAX_CANVASES}。`);
    }
    const targetNames = new Set(targetCanvases.map((canvas) => canvas.name));
    const conflicts = sources.filter((canvas) => targetNames.has(canvas.name));
    if (conflicts.length) throw new Error(`接收账号存在同名画布：${conflicts.map((canvas) => canvas.name).join('、')}。请先重命名后再转移。`);

    console.log(`转出账号：${sourceAccount.account_id}（${sourceAccount.username}）`);
    console.log(`接收账号：${targetAccount.account_id}（${targetAccount.username}）`);
    console.log(`将转移 ${sources.length} 块画布：`);
    for (const canvas of sources) {
      console.log(`- ${canvas.name} [${canvas.board_id}] revision=${canvas.revision}, bytes=${canvas.state_bytes}`);
    }
    if (!options.execute) {
      console.log('dry-run 完成，未写入任何数据。确认无误后添加 --execute。');
      return;
    }

    if (tableExists(database, 'runtime_state')) {
      const shutdown = database.prepare("SELECT value FROM runtime_state WHERE key = 'clean_shutdown'").get();
      if (!shutdown || shutdown.value !== '1') throw new Error('数据库未记录干净停机；请先正常停止画板服务，再执行转移。');
    }
    try { database.exec('BEGIN EXCLUSIVE'); database.exec('ROLLBACK'); }
    catch { throw new Error('无法获得数据库独占写锁，请先停止画板服务。'); }

    const backupsDir = path.join(options.dataDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = timestamp();
    const backupFile = path.join(backupsDir, `whiteboard-before-account-transfer-${stamp}.sqlite`);
    const boardCount = Number(database.prepare('SELECT COUNT(*) AS count FROM boards').get().count);
    const bundle = await createBackupBundle(database, { dataDir: options.dataDir, backupFile, expectedBoards: boardCount });

    const firstTargetOrder = Number(database.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maximum FROM canvas_catalog WHERE owner_user_id = ?').get(targetAccount.id).maximum) + 1;
    database.exec('BEGIN IMMEDIATE');
    try {
      const update = database.prepare('UPDATE canvas_catalog SET owner_user_id = ?, sort_order = ? WHERE board_id = ? AND owner_user_id = ?');
      sources.forEach((canvas, index) => {
        const result = update.run(targetAccount.id, firstTargetOrder + index, canvas.board_id, sourceAccount.id);
        if (Number(result.changes) !== 1) throw new Error(`画布 ${canvas.board_id} 的归属在转移期间发生变化。`);
      });
      const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyErrors.length) throw new Error('转移后外键检查失败。');
      database.exec('COMMIT');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch {}
      throw error;
    }

    const remaining = Number(database.prepare('SELECT COUNT(*) AS count FROM canvas_catalog WHERE owner_user_id = ?').get(sourceAccount.id).count);
    const received = Number(database.prepare('SELECT COUNT(*) AS count FROM canvas_catalog WHERE owner_user_id = ?').get(targetAccount.id).count);
    if (remaining !== 0 || received !== targetCanvases.length + sources.length) throw new Error('转移后的所有权数量校验失败，请从备份恢复。');
    console.log(`转移完成：${sources.length} 块画布现归 ${targetAccount.account_id} 所有。`);
    console.log(`已校验备份：${backupFile}`);
    console.log(`v2 资源包：${bundle.manifestFile}（${bundle.assets.length} 个资源）`);
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(`转移失败：${error.message}`);
  process.exitCode = 1;
});
