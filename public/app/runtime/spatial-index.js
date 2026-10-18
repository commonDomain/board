const spatialIndexRuntime = {
  geometrySelectionSequence: 0,
  latestGeometrySelectionSequence: 0,
  completedGeometrySelectionSequence: 0,
  pendingGeometrySelection: null,
  geometryMarqueeFinalize: null
};

function invalidateMarqueeSelection() {
  spatialIndexRuntime.latestGeometrySelectionSequence = ++spatialIndexRuntime.geometrySelectionSequence;
  spatialIndexRuntime.pendingGeometrySelection = null;
  spatialIndexRuntime.geometryMarqueeFinalize = null;
}

export { spatialIndexRuntime, invalidateMarqueeSelection };
