import { state } from './state.js';

function updateConnectorDraft() {
  const draft = state.connectorDraft;
  if (!draft) {
    return;
  }
  draft.temp.setAttribute('x1', draft.startPoint.x);
  draft.temp.setAttribute('y1', draft.startPoint.y);
  draft.temp.setAttribute('x2', draft.endPoint.x);
  draft.temp.setAttribute('y2', draft.endPoint.y);
}

function cancelConnectorDraft() {
  if (window.ConnectorUI) return window.ConnectorUI.cancel();
  if (state.connectorDraft) {
    state.connectorDraft.temp.remove();
    state.connectorDraft = null;
  }
}
export { updateConnectorDraft, cancelConnectorDraft };
