// Thresholds describe mounted viewport work, independently of document size.
const VIEWPORT_LOAD_THRESHOLDS = Object.freeze([
  { tier: 'small', items: 0, connectors: 0, complexity: 0 },
  { tier: 'medium', items: 200, connectors: 100, complexity: 500 },
  { tier: 'large', items: 600, connectors: 300, complexity: 1800 },
  { tier: 'extreme', items: 1200, connectors: 800, complexity: 6000 }
]);

function viewportLoadIndex(metrics, scale = 1) {
  for (let index = VIEWPORT_LOAD_THRESHOLDS.length - 1; index > 0; index--) {
    const threshold = VIEWPORT_LOAD_THRESHOLDS[index];
    if (['items', 'connectors', 'complexity'].some(key => (Number(metrics[key]) || 0) >= threshold[key] * scale)) return index;
  }
  return 0;
}

function resolveViewportLoad(metrics, previous = {}, now = 0) {
  const index = viewportLoadIndex(metrics);
  const current = Math.max(0, VIEWPORT_LOAD_THRESHOLDS.findIndex(entry => entry.tier === previous.tier));
  if (index >= current) return { tier: VIEWPORT_LOAD_THRESHOLDS[index].tier, downgradeAt: null };
  // Leave a tier only after its workload falls by 20% and stays there 500ms.
  if (viewportLoadIndex(metrics, .8) >= current) return { tier: previous.tier, downgradeAt: null };
  if (previous.downgradeAt == null) return { tier: previous.tier, downgradeAt: now + 500 };
  return now >= previous.downgradeAt
    ? { tier: VIEWPORT_LOAD_THRESHOLDS[index].tier, downgradeAt: null }
    : previous;
}

function viewportWorkPolicy(tier) {
  const dense = tier === 'large' || tier === 'extreme';
  // From 200 visible objects, rasterizing the board on every pan/zoom frame
  // costs more than compositing a cached layer that is re-rastered on settle.
  const navigationLayer = dense || tier === 'medium';
  return { dense, navigationLayer, connectorBudgetMs: tier === 'extreme' ? 2 : dense ? 3 : 5,
    mountLimit: tier === 'extreme' ? 16 : dense ? 32 : 120,
    mountBudgetMs: dense ? 4 : 6 };
}

export { VIEWPORT_LOAD_THRESHOLDS, resolveViewportLoad, viewportWorkPolicy };
