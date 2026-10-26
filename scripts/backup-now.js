'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackupBundle } = require('./backup-bundle');

async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const databaseFile = path.join(dataDir, 'whiteboard.sqlite');
  if (!fs.existsSync(databaseFile)) throw new Error(`数据库不存在：${databaseFile}`);
  const backupsDir = path.join(dataDir, 'backups');
  await fsp.mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const backupFile = path.join(backupsDir, `whiteboard-predeploy-${timestamp}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const expectedBoards = Number(database.prepare('SELECT COUNT(*) AS count FROM boards').get().count);
    const result = await createBackupBundle(database, { dataDir, backupFile, expectedBoards });
    console.log(JSON.stringify({ backupFile: result.backupFile, manifestFile: result.manifestFile, assetsDirectory: result.assetsDirectory, boards: expectedBoards }));
  } finally {
    database.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
