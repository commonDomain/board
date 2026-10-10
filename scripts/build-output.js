'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const RETRYABLE = new Set(['EACCES', 'EPERM', 'EBUSY', 'ETXTBSY']);

async function retry(operation, wait) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!RETRYABLE.has(error.code) || attempt === 5) throw error;
      await wait(50 * 2 ** attempt);
    }
  }
}

async function publishBuildOutputs(outputs, {
  root = path.resolve(__dirname, '..'),
  rename = fs.rename,
  wait = delay,
  platform = process.platform
} = {}) {
  root = path.resolve(root);
  const changed = [];
  for (const output of outputs) {
    const target = path.resolve(output.path);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`Build output is outside the project: ${target}`);
    }
    const contents = Buffer.from(output.contents);
    try {
      if ((await fs.readFile(target)).equals(contents)) continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    changed.push({ target, contents });
  }
  if (!changed.length) return;

  // Keep temporary files outside public so a running server never serves them.
  const staging = await fs.mkdtemp(path.join(root, '.tmp-build-'));
  const temporaryFiles = [];
  try {
    for (const [index, output] of changed.entries()) {
      output.staged = path.join(staging, `${index}.next`);
      output.previous = path.join(staging, `${index}.previous`);
      temporaryFiles.push(output.staged);
      await fs.writeFile(output.staged, output.contents, { flag: 'wx' });
    }
    for (const output of changed) {
      await fs.mkdir(path.dirname(output.target), { recursive: true });
      try {
        await retry(() => rename(output.staged, output.target), wait);
      } catch (error) {
        if (platform !== 'win32' || !RETRYABLE.has(error.code)) throw error;
        // Windows can forbid replacing a mapped destination while allowing its
        // name to move. Preserve the old file until the new file is published.
        await retry(() => rename(output.target, output.previous), wait);
        try {
          await retry(() => rename(output.staged, output.target), wait);
        } catch (publishError) {
          try { await retry(() => rename(output.previous, output.target), wait); }
          catch (restoreError) {
            throw new AggregateError([publishError, restoreError],
              `Cannot restore ${output.target}; previous build is at ${output.previous}`);
          }
          throw publishError;
        }
        temporaryFiles.push(output.previous);
      }
    }
  } catch (error) {
    throw new Error(`构建文件写入失败：${error.message}。请关闭占用该文件的预览或编辑程序后重试 npm start。`, { cause: error });
  } finally {
    for (const file of temporaryFiles) {
      try { await fs.unlink(file); }
      catch (error) {
        // A mapped previous file can remain locked until its reader exits.
        if (error.code !== 'ENOENT' && !RETRYABLE.has(error.code)) console.warn(error.message);
      }
    }
    try { await fs.rmdir(staging); }
    catch (error) {
      if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') console.warn(error.message);
    }
  }
}

module.exports = { publishBuildOutputs };
