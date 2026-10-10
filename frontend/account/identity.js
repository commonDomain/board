import { byId } from './dom.js';
import { state } from './state.js';
import { avatarMarkup, refreshIcons } from './view.js';

function renderIdentity() {
  const user = state.session?.user;
  const name = user?.username || '游客';
  byId('accountButton').dataset.tooltip = name;
  byId('accountButton').setAttribute('aria-label', `打开用户菜单，${name}`);
  byId('accountAvatar').innerHTML = avatarMarkup(user);
  byId('accountMenuName').textContent = name;
  byId('accountMenuId').textContent = user?.accountId || '仅保存在当前浏览器';
  byId('openProfileButton').querySelector('span').textContent = user ? '修改用户信息' : '登录 / 创建账号';
  byId('logoutButton').hidden = !user;
  refreshIcons(byId('accountButton'));
}
export { renderIdentity };
