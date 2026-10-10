import { getViewportDropPoint } from './geometry.js';

import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';

import { makeId } from './utilities.js';
import { nextZ } from './canvas-state.js';
import { extractHttpUrl, normalizeKdocsUrl } from './kdocs-model.js';

let openAdaptiveDialog,
  restoreNavigationTool;

function configureKdocs(callbacks) {
  ({
    openAdaptiveDialog,
    restoreNavigationTool
  } = callbacks);
}

const kdocsInstances = new Map();

function renderKdocsEmbed(item) {
  const card = document.createElement('section');
  card.className = 'kdocs-embed-card';

  const header = document.createElement('header');
  header.className = 'kdocs-embed-header';
  header.title = '拖动 WPS 云文档';

  const brand = document.createElement('span');
  brand.className = 'kdocs-embed-brand';
  const brandIcon = document.createElement('i');
  brandIcon.dataset.lucide = 'file-spreadsheet';
  brandIcon.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.className = 'kdocs-embed-title';
  title.textContent = item.title || 'WPS 云文档';
  brand.append(brandIcon, title);

  const actions = document.createElement('span');
  actions.className = 'kdocs-embed-actions';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'kdocs-embed-action';
  reload.title = '重新载入最新内容';
  reload.setAttribute('aria-label', '重新载入最新内容');
  reload.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i>';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'kdocs-embed-action';
  open.title = '在新窗口打开';
  open.setAttribute('aria-label', '在新窗口打开');
  open.innerHTML = '<i data-lucide="external-link" aria-hidden="true"></i>';
  actions.append(reload, open);
  header.append(brand, actions);

  const mount = document.createElement('div');
  mount.className = 'kdocs-embed-mount';
  mount.dataset.url = item.url;
  const status = document.createElement('div');
  status.className = 'kdocs-embed-status';
  status.textContent = '正在载入 WPS 云文档…';
  mount.appendChild(status);

  const stopActionPointer = (event) => event.stopPropagation();
  reload.addEventListener('pointerdown', stopActionPointer);
  open.addEventListener('pointerdown', stopActionPointer);
  reload.addEventListener('click', (event) => {
    event.stopPropagation();
    initializeKdocsEmbed(item, card, true);
  });
  open.addEventListener('click', (event) => {
    event.stopPropagation();
    window.open(item.url, '_blank', 'noopener,noreferrer');
  });

  card.append(header, mount);
  return card;
}

function destroyKdocsInstance(itemId) {
  const instance = kdocsInstances.get(itemId);
  if (!instance) {
    return;
  }
  kdocsInstances.delete(itemId);
  try {
    instance.destroy?.();
  } catch (error) {
    console.warn('Could not destroy WPS WebOffice instance.', error);
  }
}

function destroyAllKdocsInstances() {
  for (const itemId of Array.from(kdocsInstances.keys())) {
    destroyKdocsInstance(itemId);
  }
}

function initializeKdocsEmbed(item, card, announceReload = false) {
  const mount = card?.querySelector('.kdocs-embed-mount');
  if (!mount) {
    return;
  }
  destroyKdocsInstance(item.id);
  mount.textContent = '';
  const status = document.createElement('div');
  status.className = 'kdocs-embed-status';
  status.textContent = announceReload ? '正在重新获取最新内容…' : '正在载入 WPS 云文档…';
  mount.appendChild(status);
  if (typeof window.WebOfficeSDK !== 'function') {
    status.classList.add('is-error');
    status.textContent = 'WPS 云文档组件未加载，请刷新页面重试';
    return;
  }
  try {
    // WebOffice SDK 2.x exposes a constructable multi-instance client. A
    // separate instance keeps multiple cloud documents independent.
    const instance = new window.WebOfficeSDK({
      url: item.url,
      mount,
      // Keep the full WebOffice chrome. SDK `embed` mode appends
      // simple=1&hidecmb=1&embed=1, which also removes the spreadsheet
      // workbook/sheet navigation bar.
      isListenResize: true,
      attrAllow: 'clipboard-read; clipboard-write; fullscreen; autoplay',
      commonOptions: {
        isShowTopArea: true,
        isShowHeader: true,
        isBrowserViewFullscreen: false,
        isIframeViewFullscreen: false,
        acceptVisualViewportResizeEvent: true
      }
    });
    if (!instance?.iframe) {
      throw new Error('WebOffice SDK did not create an iframe');
    }
    instance.iframe.classList.add('kdocs-embed-frame');
    instance.iframe.dataset.url = item.url;
    instance.iframe.title = `${item.title || 'WPS 云文档'}（交互式内容）`;
    instance.iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    kdocsInstances.set(item.id, instance);
    Promise.resolve(
      instance.on?.('fileOpen', (result) => {
        if (!mount.isConnected || kdocsInstances.get(item.id) !== instance) {
          return;
        }
        if (result?.success === false) {
          status.classList.add('is-error');
          status.textContent = '云文档打开失败，请检查分享权限或在新窗口打开';
        } else {
          status.remove();
        }
      })
    ).catch(() => {});
    Promise.resolve(
      instance.on?.('error', () => {
        if (status.isConnected) {
          status.classList.add('is-error');
          status.textContent = '云文档暂时无法加载，可点击刷新或在新窗口打开';
        }
      })
    ).catch(() => {});
  } catch (error) {
    console.error(error);
    status.classList.add('is-error');
    status.textContent = 'WPS 云文档组件初始化失败，请刷新后重试';
  }
}

function addKdocsEmbedItem(url) {
  const normalizedUrl = normalizeKdocsUrl(url);
  if (!normalizedUrl) {
    return false;
  }
  const point = getViewportDropPoint(720, 520, true);
  const inserted = upsertItem(
    {
      id: makeId('kdocs'),
      type: 'kdocs',
      title: 'WPS 云文档',
      url: normalizedUrl,
      x: point.x,
      y: point.y,
      w: 720,
      h: 520,
      rotation: 0,
      z: nextZ()
    },
    { select: true }
  );
  if (inserted) {
    restoreNavigationTool();
    showToast('已嵌入 WPS 云文档，内容会在每次打开画板时重新加载');
  }
  return inserted;
}

async function openKdocsInsertDialog() {
  const url = await openAdaptiveDialog({
    mode: 'prompt',
    title: '插入共享文档',
    message: '文档会在每次打开画板时重新加载。',
    inputLabel: 'WPS 共享链接或包含链接的文字',
    inputType: 'url',
    inputMode: 'url',
    maxLength: 4096,
    confirmLabel: '插入文档',
    validate: (value) => {
      if (!String(value || '').trim()) return '请输入共享文档链接';
      if (!extractHttpUrl(value)) return '没有找到 http 或 https 链接';
      if (!normalizeKdocsUrl(value)) return '仅支持 https://www.kdocs.cn/ 下的安全共享链接';
      return '';
    }
  });
  if (url === null) return false;
  if (!addKdocsEmbedItem(url)) {
    showToast('WPS 共享链接无效，请重新复制后再试');
    return false;
  }
  return true;
}
export {
  kdocsInstances,
  renderKdocsEmbed,
  destroyKdocsInstance,
  destroyAllKdocsInstances,
  initializeKdocsEmbed,
  addKdocsEmbedItem,
  openKdocsInsertDialog
};

export { configureKdocs };
