import { state } from './state.js';

function stopPairingPoll() {
  if (state.pairingTimer) clearTimeout(state.pairingTimer);
  state.pairingTimer = null;
}
export { stopPairingPoll };
