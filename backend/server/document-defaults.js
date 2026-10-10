
import { DOCUMENT_VERSION } from './config.js';

function defaultLayer() {
  return {
    id: 'layer_default',
    name: '图层 1',
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal'
  };
}

function defaultSettings() {
  return {
    background: {
      type: 'blank',
      color: '#ffffff',
      spacing: 24,
      opacity: 1
    }
  };
}

function defaultState(boardId) {
  const state = {
    version: DOCUMENT_VERSION,
    boardId,
    revision: 0,
    savedAt: null,
    updatedAt: Date.now(),
    items: [],
    sections: [],
    groups: [],
    layers: [defaultLayer()],
    settings: defaultSettings()
  };
  
  return state;
}

export { defaultLayer, defaultSettings, defaultState };
