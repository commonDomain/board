'use strict';

// Shared by build scripts and the server. Kept outside public and never served.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function publicationUnavailable() {
  return Object.assign(new Error('静态资源正在发布或发布尚未完成，请稍后重试。'), {
    statusCode: 503, code: 'STATIC_PUBLICATION_PENDING', expose: true, retryAfter: 5
  });
}

async function readStaticPublication(root) {
  const lock = path.join(root, '.static-publication.lock');
  try { await fs.access(lock); throw publicationUnavailable(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let publication;
  try { publication = JSON.parse(await fs.readFile(path.join(root, '.static-publication.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw publicationUnavailable(); }
  try { await fs.access(lock); throw publicationUnavailable(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (publication && (publication.status !== 'ready' || typeof publication.token !== 'string')) throw publicationUnavailable();
  return publication?.token || 'unmanaged';
}

async function withStaticPublication(root, publish) {
  root = path.resolve(root);
  const lock = path.join(root, '.static-publication.lock');
  const inherited = process.env.MUSE_STATIC_PUBLICATION_TOKEN;
  if (inherited) {
    const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
    if (owner.token !== inherited) throw new Error('构建发布锁已改变，请重新构建。');
    return publish(inherited);
  }
  try { await fs.mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`另一个构建正在发布，或上次构建被强制终止。请确认没有构建进程后清理 ${lock}，再重新构建。`);
  }
  const token = crypto.randomUUID();
  const state = path.join(root, '.static-publication.json');
  const staging = path.join(root, `.static-publication-${token}.tmp`);
  const writeState = async status => {
    await fs.writeFile(staging, JSON.stringify({ status, token }));
    await fs.rename(staging, state);
  };
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ token, pid: process.pid }));
    const result = await publish(token);
    await writeState('ready');
    return result;
  } catch (error) {
    // A failed build may have replaced only some files; fail closed until rebuilt.
    try { await writeState('failed'); } catch { /* The lock remains if state cannot be recorded. */ }
    throw error;
  } finally {
    // Only release the lock after a durable success/failure state was written.
    let recorded = false;
    try { recorded = JSON.parse(await fs.readFile(state, 'utf8')).token === token; } catch {}
    if (recorded) {
      await fs.unlink(path.join(lock, 'owner.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await fs.rmdir(lock);
    }
    await fs.unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

module.exports = { withStaticPublication, readStaticPublication, publicationUnavailable };
