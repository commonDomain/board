import { closeAvatarCrop } from './avatar.js';
import { byId } from './dom.js';
import { closeRecentAuth } from './credentials.js';
import { cancelPairing } from './passkey.js';
import { closeDeleteAccountDialog, closeEmailManager, discardPendingAvatar } from './profile.js';
import { closeSessionConfirmation } from './sessions.js';
import { cancelRemoval } from './sharing.js';

function manageAccountDialogKeyboard(event) {
  const overlay = Array.from(document.querySelectorAll('.account-overlay:not([hidden])')).at(-1);
  if (!overlay) return;
  if (event.key === 'Escape') {
    if (overlay.id === 'profileDialog') {
      event.preventDefault();
      discardPendingAvatar();
      overlay.hidden = true;
      byId('accountButton').focus({ preventScroll: true });
    } else if (overlay.id === 'avatarCropDialog') {
      event.preventDefault();
      closeAvatarCrop(null);
    } else if (overlay.id === 'emailManageDialog') {
      event.preventDefault();
      closeEmailManager();
    } else if (overlay.id === 'deleteAccountDialog' && !byId('confirmDeleteAccountButton').disabled) {
      event.preventDefault();
      closeDeleteAccountDialog();
    } else if (overlay.id === 'sessionConfirmDialog' && !byId('confirmSessionButton').disabled) {
      event.preventDefault();
      closeSessionConfirmation();
    } else if (overlay.id === 'recentAuthDialog' && !byId('confirmRecentAuthButton').disabled) {
      event.preventDefault();
      closeRecentAuth(new Error('已取消身份确认'));
    } else if (overlay.id === 'pairingDialog') {
      event.preventDefault();
      void cancelPairing();
    } else if (overlay.id === 'guestImportDialog') {
      event.preventDefault();
      byId('skipGuestImportButton').click();
    } else if (overlay.id === 'sharingConfirmDialog' && !byId('cancelSharingRemovalButton').disabled) {
      event.preventDefault();
      cancelRemoval();
    }
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    overlay.querySelectorAll(
      'button:not([hidden]):not([disabled]), input:not([hidden]):not([disabled]), summary, a[href]'
    )
  ).filter((control) => control.offsetParent !== null);
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export { manageAccountDialogKeyboard };
