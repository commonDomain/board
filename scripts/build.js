'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { withStaticPublication } = require('../backend/static-publication');
const root = path.resolve(__dirname, '..');

function run(script, token) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], { cwd: root, env: { ...process.env, MUSE_STATIC_PUBLICATION_TOKEN: token }, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} 构建失败（${signal || code}）`)));
  });
}

withStaticPublication(root, async token => {
  await run('build-vendor.js', token);
  await run('build-fonts.js', token);
  await run('build-frontend.js', token);
}).catch(error => { console.error(error); process.exitCode = 1; });
