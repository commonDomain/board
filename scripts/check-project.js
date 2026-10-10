'use strict';

const path = require('node:path');
const { ESLint } = require('eslint');
const esbuild = require('esbuild');
const { assertAcyclic, assertModelDependencies } = require('./check-module-boundaries');

async function main() {
  const root = path.resolve(__dirname, '..');
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(['backend', 'frontend', 'public', 'scripts']);
  const formatter = await eslint.loadFormatter('stylish');
  const report = formatter.format(results);
  if (report) process.stdout.write(report);
  if (results.some((result) => result.errorCount)) {
    process.exitCode = 1;
    return;
  }
  // Resolve the complete import graphs without starting a server or touching data.
  for (const [entry, platform] of [
    ['public/app/bootstrap.js', 'browser'],
    ['backend/server/bootstrap.js', 'node'],
    ['frontend/account/bootstrap.js', 'browser']
  ]) {
    const build = await esbuild.build({
      entryPoints: [path.join(root, entry)],
      bundle: true,
      write: false,
      metafile: true,
      absWorkingDir: root,
      platform,
      format: 'esm',
      packages: 'external',
      logLevel: 'warning'
    });
    if (platform === 'node') assertAcyclic(build.metafile.inputs, 'backend/');
    if (entry === 'public/app/bootstrap.js') {
      assertModelDependencies(build.metafile.inputs);
      assertAcyclic(build.metafile.inputs, 'public/app/');
    }
    if (entry === 'frontend/account/bootstrap.js') assertAcyclic(build.metafile.inputs, 'frontend/account/');
  }
  console.log('Syntax, undeclared names, application imports and circular dependencies checked.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
