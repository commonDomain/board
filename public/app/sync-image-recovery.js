import { normalizeImageForBoard } from './image-upload-model.js';
import { state } from './state.js';

export function blockedSyncImages() {
  const head = state.syncQueue.serialize().entries[0];
  if (!head?.error || !(head.errorImage || head.error === 'This image is not available to the current account.' || head.error.includes('无权提交'))) return [];
  const images = new Map();
  const visit = op => {
    if (op.kind === 'batch') return op.ops.forEach(visit);
    const item = op.item;
    if (op.kind !== 'upsert' || item?.type !== 'image' || !/^\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/i.test(item.src)) return;
    if (head.errorImage && item.id !== head.errorImage.itemId) return;
    images.set(item.src, { src: item.src, label: item.navigatorName || item.id });
  };
  visit(head.op);
  return [...images.values()];
}

export async function recoverSyncImage(file, source) {
  const queue = state.syncQueue, boardId = state.boardId, epoch = state.canvasEpoch;
  const ownerId = window.MuseAccount?.session?.user?.id;
  const generation = window.WhiteboardStorage?.getGeneration();
  const opId = queue.serialize().entries[0]?.opId;
  const current = () => state.syncQueue === queue && state.boardId === boardId && state.canvasEpoch === epoch &&
    ownerId && window.MuseAccount?.session?.user?.id === ownerId && generation === window.WhiteboardStorage?.getGeneration() &&
    !state.switchingCanvas;
  if (!current() || !blockedSyncImages().some(image => image.src === source)) throw new Error('账号、画布或失败图片已变化，请重新打开同步问题。');
  const image = await normalizeImageForBoard(file);
  if (!current() || queue.serialize().entries[0]?.opId !== opId) throw new Error('待同步操作已变化，请重新打开同步问题。');
  const response = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': image.mimeType }, body: image.blob });
  if (!response.ok) throw new Error(`原图上传失败（${response.status}），待同步草稿仍保留。`);
  const asset = await response.json();
  if (!current() || queue.serialize().entries[0]?.opId !== opId) throw new Error('账号或画布已变化，未修改待同步队列。');
  const before = queue.serialize();
  queue.replaceBlockedImage(source, asset);
  const ready = queue.serialize();
  delete ready.entries[0].error; delete ready.entries[0].errorImage;
  try {
    if (await window.WhiteboardStorage?.saveOutbox(boardId, ready.entries.map(entry => ({ type: 'op', ...entry }))) !== true) throw new Error('恢复后的图片未能保存在本机，请保持此页面开启后重试。');
  } catch (error) {
    // Editing while upload/storage completes may append new operations; retain them too.
    const later = queue.serialize().entries.slice(before.entries.length);
    queue.restore({ ...before, entries: [...before.entries, ...later] });
    throw error;
  }
  if (!current()) return false;
  queue.resume();
  return true;
}
