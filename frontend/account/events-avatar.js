import { closeAvatarCrop, confirmAvatarCrop, updateAvatarCropPreview } from './avatar.js';
import { byId } from './dom.js';
import { state } from './state.js';
import { setError } from './view.js';

function wireAvatarEvents() {
  byId('avatarRotation').addEventListener('input', updateAvatarCropPreview);
  byId('avatarZoom').addEventListener('input', updateAvatarCropPreview);
  byId('avatarCropStage').addEventListener('pointerdown', (event) => {
    const crop = state.avatarCrop;
    if (!crop) return;
    if (event.target.classList.contains('crop-handle')) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      crop.dragging = {
        mode: 'resize',
        pointerId: event.pointerId,
        centerX,
        centerY,
        distance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
        zoom: Number(byId('avatarZoom').value)
      };
    } else {
      crop.dragging = {
        mode: 'pan',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: crop.panX,
        panY: crop.panY
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add('is-dragging');
  });
  byId('avatarCropStage').addEventListener('pointermove', (event) => {
    const crop = state.avatarCrop;
    if (!crop?.dragging || crop.dragging.pointerId !== event.pointerId) return;
    if (crop.dragging.mode === 'resize') {
      const distance = Math.max(
        1,
        Math.hypot(event.clientX - crop.dragging.centerX, event.clientY - crop.dragging.centerY)
      );
      const zoom = byId('avatarZoom');
      zoom.value = String(
        Math.max(
          Number(zoom.min),
          Math.min(Number(zoom.max), Math.round((crop.dragging.zoom * distance) / crop.dragging.distance))
        )
      );
    } else {
      crop.panX = crop.dragging.panX + event.clientX - crop.dragging.x;
      crop.panY = crop.dragging.panY + event.clientY - crop.dragging.y;
    }
    updateAvatarCropPreview();
  });
  const finishAvatarPan = (event) => {
    const crop = state.avatarCrop;
    if (!crop?.dragging || crop.dragging.pointerId !== event.pointerId) return;
    crop.dragging = null;
    event.currentTarget.classList.remove('is-dragging');
  };
  byId('avatarCropStage').addEventListener('pointerup', finishAvatarPan);
  byId('avatarCropStage').addEventListener('pointercancel', finishAvatarPan);
  byId('avatarCropStage').addEventListener(
    'wheel',
    (event) => {
      if (!state.avatarCrop) return;
      event.preventDefault();
      const zoom = byId('avatarZoom');
      zoom.value = String(
        Math.max(Number(zoom.min), Math.min(Number(zoom.max), Number(zoom.value) - Math.sign(event.deltaY) * 5))
      );
      updateAvatarCropPreview();
    },
    { passive: false }
  );
  byId('cancelAvatarCropButton').addEventListener('click', () => closeAvatarCrop(null));
  byId('closeAvatarCropButton').addEventListener('click', () => closeAvatarCrop(null));
  byId('confirmAvatarCropButton').addEventListener('click', () =>
    confirmAvatarCrop().catch((error) => {
      closeAvatarCrop(null);
      setError(byId('profileError'), error.message || '头像裁剪失败');
    })
  );
}
export { wireAvatarEvents };
