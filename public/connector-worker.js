"use strict";
importScripts("connector-router.js");
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, revision: data.revision, result: ConnectorRouter.route(data.input) });
  } catch (error) {
    self.postMessage({ id: data.id, revision: data.revision, error: String(error.message || error) });
  }
};
