import { MAX_BATCH_OPERATIONS } from './config.js';
import { ProtocolError } from './protocol-error.js';

import { applySheetCommand, applyUpsert, applyTransform, applyDelete } from './operations-items.js';
import {
  applySectionUpsert,
  applyGroupUpsert,
  applyReparent,
  applySetFlags,
  applyDeleteContainer
} from './operations-containers.js';
import { applyLayers, applySettings, applyClear } from './operations-settings.js';

const handlers = {'sheet-command': applySheetCommand,
upsert: applyUpsert,
'section-upsert': applySectionUpsert,
'group-upsert': applyGroupUpsert,
reparent: applyReparent,
transform: applyTransform,
layout: applyTransform,
'set-flags': applySetFlags,
'delete-container': applyDeleteContainer,
layers: applyLayers,
settings: applySettings,
delete: applyDelete,
clear: applyClear};

// The caller owns the draft transaction. Batch children share the same operation budget.
async function applyOperationToDraft(state, rawOperation, context = { depth: 0, count: 0 }) {
  if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) {
    throw new ProtocolError('INVALID_OPERATION', 'Operation must be an object.');
  }
  context.count += 1;
  if (context.count > MAX_BATCH_OPERATIONS + 4 || context.depth > 4) {
    throw new ProtocolError('INVALID_OPERATION', 'Batch contains too many operations.');
  }

  if (rawOperation.kind === 'batch') {
    if (
      !Array.isArray(rawOperation.ops) ||
      !rawOperation.ops.length ||
      rawOperation.ops.length > MAX_BATCH_OPERATIONS
    ) {
      throw new ProtocolError(
        'INVALID_OPERATION',
        `Batch must contain between 1 and ${MAX_BATCH_OPERATIONS} operations.`
      );
    }
    const canonical = [];
    for (const subOperation of rawOperation.ops) {
      const childContext = { depth: context.depth + 1, count: context.count, userId: context.userId };
      canonical.push(await applyOperationToDraft(state, subOperation, childContext));
      context.count = childContext.count;
    }
    return { kind: 'batch', ops: canonical };
  }

  if (!Object.hasOwn(handlers, rawOperation.kind)) {
    throw new ProtocolError('INVALID_OPERATION', 'Unsupported board operation.');
  }
  return handlers[rawOperation.kind](state, rawOperation, context);
}

export { applyOperationToDraft };
