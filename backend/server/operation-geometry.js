import ConnectorCore from '../../public/connector-core.js';

function itemIndex(state, id) {
  return state.items.findIndex((item) => item.id === id);
}

function itemEdgePoint(item, towardPoint) {
  const centerX = item.x + item.w / 2;
  const centerY = item.y + item.h / 2;
  const dx = towardPoint.x - centerX;
  const dy = towardPoint.y - centerY;
  if (!dx && !dy) return { x: centerX, y: centerY };
  const scale = Math.min(
    Math.max(1, item.w / 2) / Math.abs(dx || 1e-6),
    Math.max(1, item.h / 2) / Math.abs(dy || 1e-6)
  );
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

function connectorEndpointsForState(state, connector) {
  if (connector.connectorVersion) {
    const resolve = (terminal, toward) => {
      if (!terminal?.binding || terminal.status === 'orphan' || terminal.binding.content) return terminal.fallback;
      const collection = terminal.binding.kind === 'section' ? state.sections : state.items;
      const owner = collection.find((item) => item.id === terminal.binding.id);
      return owner ? ConnectorCore.anchor(owner, toward, terminal.anchor) : terminal.fallback;
    };
    const start = resolve(connector.source, connector.target.fallback);
    return { start, end: resolve(connector.target, start) };
  }
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const startFallback = { x: connector.startX, y: connector.startY };
  const endFallback = { x: connector.endX, y: connector.endY };
  const startTarget = connector.startId ? byId.get(connector.startId) : null;
  const endTarget = connector.endId ? byId.get(connector.endId) : null;
  const start = startTarget ? itemEdgePoint(startTarget, endFallback) : startFallback;
  const end = endTarget ? itemEdgePoint(endTarget, start) : endFallback;
  return { start, end };
}

export { itemIndex, itemEdgePoint, connectorEndpointsForState };
