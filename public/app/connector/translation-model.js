// Connector rectangles are derived from routes; moving the rectangle cannot
// move the actual line. Bindings stay attached while free endpoints and user
// route controls move with their owning selection or frame.
function translatedConnectorGeometry(start, dx, dy, movesBinding = () => false) {
  const source = structuredClone(start.source);
  const target = structuredClone(start.target);
  const route = structuredClone(start.route);
  for (const terminal of [source, target]) {
    if (!terminal.binding || movesBinding(terminal.binding)) {
      terminal.fallback.x += dx;
      terminal.fallback.y += dy;
    }
  }
  for (const constraint of route.constraints) for (const key of ['a', 'b']) {
    if (!constraint[key]) continue;
    constraint[key].x += dx;
    constraint[key].y += dy;
  }
  return { source, target, route };
}

export { translatedConnectorGeometry };
