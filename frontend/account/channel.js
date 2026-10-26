import { global } from './state.js';

let accountChannel;

function initializeAccountChannel(refreshAccountFromOtherTab) {
  accountChannel = global.createAccountChannel(global, () => {
    void refreshAccountFromOtherTab();
  });
  global.addEventListener('muse:logout', () => accountChannel.publish());
}
export { accountChannel, initializeAccountChannel };
