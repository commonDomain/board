import { configurePointerInteractions } from './pointer.js';
import { configureDocumentInteractions } from './document.js';
import { configureViewInteractions } from './view.js';
import { configureConnectorsInteractions } from './connectors.js';
import { configureEditingInteractions } from './editing.js';
import { configureSyncInteractions } from './sync.js';

// Bind interactions before any startup work or event handler can run.
function configureInteractions() {
  configurePointerInteractions();
  configureDocumentInteractions();
  configureViewInteractions();
  configureConnectorsInteractions();
  configureEditingInteractions();
  configureSyncInteractions();
}

export { configureInteractions };
