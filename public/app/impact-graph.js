import { state } from './state.js';
import {MAX_DEPTH,MAX_MOTION_EDGES,MAX_MOTION_NODES,entity,visible,boundIds} from './impact-primitives.js';

function collect(rootId) {
  const nodes = new Map([[rootId, { depth: 0, direction: 'root', via: null }]]);
  const edges = new Map();
  const graphNodes = new Map(nodes);
  const graphEdges = new Map();
  let frontier = [rootId];
  for (let depth = 1; frontier.length; depth++) {
    const next = [];
    for (const id of frontier)
      for (const edgeId of state.connectorIndex.get(id) || []) {
        const line = state.items.get(edgeId);
        if (!line || line.type !== 'connector' || !visible(line)) continue;
        const [sourceId, targetId] = boundIds(line);
        if (!sourceId || !targetId || (sourceId !== id && targetId !== id)) continue;
        const neighborId = sourceId === id ? targetId : sourceId;
        if (neighborId === id || !visible(entity(neighborId))) continue;
        if (line.connectorVersion) {
          const endpoint = sourceId === id ? line.target : line.source;
          if (window.ConnectorUI?.resolve(endpoint, endpoint.fallback).status === 'hidden') continue;
        }
        const direction = sourceId === id ? 'out' : 'in';
        if (!graphEdges.has(edgeId)) graphEdges.set(edgeId, { depth, direction, sourceId, targetId });
        if (depth <= MAX_DEPTH && !edges.has(edgeId)) edges.set(edgeId, { depth, direction, sourceId, targetId });
        if (!graphNodes.has(neighborId)) {
          const info = { depth, direction, via: edgeId };
          graphNodes.set(neighborId, info);
          if (depth <= MAX_DEPTH) nodes.set(neighborId, info);
          next.push(neighborId);
        }
      }
    frontier = next;
  }
  const contextSections = new Set();
  for (const id of nodes.keys()) {
    if (state.sections.has(id)) contextSections.add(id);
    const sectionId = entity(id)?.sectionId;
    if (sectionId) contextSections.add(sectionId);
  }
  return {
    rootId,
    boardId: state.boardId,
    nodes,
    edges,
    graphNodes,
    graphEdges,
    contextSections,
    motionNodes: new Set([...nodes.keys()].slice(0, MAX_MOTION_NODES)),
    motionEdges: new Set([...edges.keys()].slice(0, MAX_MOTION_EDGES))
  };
}

function graphSignature(data) {
  return JSON.stringify([
    [...data.graphNodes].map(([id, info]) => [id, info.depth, info.direction, info.via]),
    [...data.graphEdges].map(([id, info]) => [id, info.depth, info.direction, info.sourceId, info.targetId])
  ]);
}
export { collect, graphSignature };

