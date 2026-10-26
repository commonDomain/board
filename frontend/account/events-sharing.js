import { byId } from './dom.js';
import { copyText } from './recovery.js';
import { request } from './request.js';
import { cancelRemoval, confirmRemoval, openEndSharingConfirm, renderSharing } from './sharing.js';
import { global } from './state.js';
import { setError } from './view.js';

function wireSharingEvents() {
  byId('generateShareCodeButton').addEventListener('click', async () => {
    try {
      const result = await request('/api/sharing/invite-code', { method: 'POST' });
      byId('shareCodeValue').textContent = result.inviteCode;
      byId('shareCodePanel').hidden = false;
      renderSharing(result.sharing);
    } catch (error) {
      setError(byId('profileError'), error.message);
    }
  });
  byId('copyShareCodeButton').addEventListener('click', () =>
    copyText(byId('shareCodeValue').textContent).catch(() => {})
  );
  byId('endShareGroupButton').addEventListener('click', openEndSharingConfirm);
  byId('joinShareButton').addEventListener('click', () => {
    byId('joinShareForm').hidden = false;
    byId('joinShareCode').focus();
  });
  byId('joinShareForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await request('/api/sharing/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteCode: byId('joinShareCode').value })
      });
      byId('joinShareForm').hidden = true;
      renderSharing(result.sharing);
      global.dispatchEvent(new CustomEvent('muse:sharing-changed'));
    } catch (error) {
      setError(byId('profileError'), error.message);
    }
  });
  byId('cancelSharingRemovalButton').addEventListener('click', cancelRemoval);
  byId('confirmSharingRemovalButton').addEventListener('click', confirmRemoval);
}
export { wireSharingEvents };
