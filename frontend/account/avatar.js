import { byId } from './dom.js';
import { global, state } from './state.js';

const AVATAR_CROP_VIEWPORT = 360;

function updateAvatarCropPreview() {
  const crop = state.avatarCrop;
  if (!crop) return;
  const rotation = Number(byId('avatarRotation').value) || 0;
  const zoom = Math.max(1, Number(byId('avatarZoom').value) / 100 || 1);
  crop.rotation = rotation;
  crop.scale = crop.minScale * zoom;
  byId('avatarRotationValue').textContent = `${rotation}°`;
  byId('avatarCropPreview').style.transform =
    `translate(-50%, -50%) translate(${crop.panX}px, ${crop.panY}px) rotate(${rotation}deg) scale(${crop.scale})`;
}

function closeAvatarCrop(result = null) {
  const crop = state.avatarCrop;
  if (!crop) return;
  state.avatarCrop = null;
  byId('avatarCropDialog').hidden = true;
  URL.revokeObjectURL(crop.url);
  crop.resolve(result);
}

async function confirmAvatarCrop() {
  const crop = state.avatarCrop;
  if (!crop) return;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ratio = canvas.width / crop.viewportSize;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2 + crop.panX * ratio, canvas.height / 2 + crop.panY * ratio);
  context.rotate((crop.rotation * Math.PI) / 180);
  context.scale(crop.scale * ratio, crop.scale * ratio);
  context.drawImage(crop.image, -crop.image.naturalWidth / 2, -crop.image.naturalHeight / 2);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('头像裁剪失败');
  closeAvatarCrop(blob);
}

async function chooseAvatarCrop(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('头像图片损坏或格式无效');
  }
  return new Promise((resolve) => {
    const viewportSize = Math.min(AVATAR_CROP_VIEWPORT, Math.max(240, global.innerWidth - 64));
    const minScale = Math.max(viewportSize / image.naturalWidth, viewportSize / image.naturalHeight);
    state.avatarCrop = {
      image,
      url,
      resolve,
      viewportSize,
      minScale,
      scale: minScale,
      rotation: 0,
      panX: 0,
      panY: 0,
      dragging: null
    };
    byId('avatarRotation').value = '0';
    byId('avatarZoom').value = '100';
    byId('avatarCropPreview').src = url;
    updateAvatarCropPreview();
    byId('avatarCropDialog').hidden = false;
    requestAnimationFrame(() => byId('confirmAvatarCropButton').focus({ preventScroll: true }));
  });
}

export { AVATAR_CROP_VIEWPORT, chooseAvatarCrop, closeAvatarCrop, confirmAvatarCrop, updateAvatarCropPreview };
