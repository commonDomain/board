'use strict';

// Check the layers that must be safe to import without starting UI workflows.
function assertAcyclic(inputs, prefix) {
  const files = Object.keys(inputs).filter((file) => file.replaceAll('\\', '/').startsWith(prefix));
  const selected = new Set(files);
  const completed = new Set();
  const active = [];

  function visit(file) {
    const cycleStart = active.indexOf(file);
    if (cycleStart !== -1) {
      throw new Error(`Circular dependency: ${active.slice(cycleStart).concat(file).join(' -> ')}`);
    }
    if (completed.has(file)) return;
    active.push(file);
    for (const dependency of inputs[file].imports) {
      if (!dependency.external && selected.has(dependency.path)) visit(dependency.path);
    }
    active.pop();
    completed.add(file);
  }

  for (const file of files) visit(file);
}

function assertModelDependencies(inputs) {
  const modelFiles = Object.keys(inputs).filter((file) => /^public\/app\/.*-model\.js$/.test(file));
  const visited = new Set();
  const allowed = /-model\.js$|-data\.js$|\/runtime\/|\/(state|constants|elements|utilities|canvas-state|preferences)\.js$/;

  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const dependency of inputs[file].imports) {
      if (dependency.external) continue;
      if (!allowed.test(dependency.path)) {
        throw new Error(`Model depends on an interaction module: ${file} -> ${dependency.path}`);
      }
      visit(dependency.path);
    }
  }

  modelFiles.forEach(visit);
  assertAcyclic(Object.fromEntries([...visited].map((file) => [file, inputs[file]])), 'public/app/');
}

module.exports = { assertAcyclic, assertModelDependencies };
