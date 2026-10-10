import { byId } from './dom.js';
import { request } from './request.js';
import { global, gsap, state } from './state.js';
import { avatarMarkup, escapeAttribute, escapeHtml, refreshIcons, setError } from './view.js';

function memberRects() {
  return new Map(
    Array.from(byId('memberChain').querySelectorAll('.member-node'), (node) => [
      node.dataset.userId,
      node.getBoundingClientRect()
    ])
  );
}

function animateFlip(previous) {
  if (!gsap) return;
  state.lockTimeline?.kill();
  const timeline = gsap.timeline({
    onComplete: () => {
      state.lockTimeline = null;
    }
  });
  state.lockTimeline = timeline;
  for (const node of byId('memberChain').querySelectorAll('.member-node')) {
    const before = previous.get(node.dataset.userId);
    if (!before) continue;
    const after = node.getBoundingClientRect();
    timeline.fromTo(
      node,
      { x: before.left - after.left, y: before.top - after.top },
      {
        x: 0,
        y: 0,
        duration: 0.42,
        ease: 'power3.out',
        clearProps: 'transform,willChange'
      },
      0
    );
  }
}

function memberTooltip(lock, visible) {
  let tip = document.querySelector('.member-lock-tip');
  if (!visible) {
    tip?.remove();
    return;
  }
  tip = document.createElement('div');
  tip.className = 'member-lock-tip';
  tip.textContent = lock.dataset.self === 'true' ? '点击退出数据共享' : '点击取消和该用户数据共享';
  document.body.appendChild(tip);
  const rect = lock.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, rect.left + rect.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${Math.max(8, rect.top - tip.offsetHeight - 7)}px`;
}

function appendUnlockIconAnimation(timeline, closedLock, openLock, position = 0) {
  timeline
    .set(closedLock, { autoAlpha: 1, x: 0, y: 0, rotation: 0, scale: 1, transformOrigin: '38% 70%' }, position)
    .set(openLock, { autoAlpha: 0, x: -5, y: 3, rotation: -16, scale: 0.94, transformOrigin: '38% 70%' }, position)
    .to(closedLock, { autoAlpha: 0, y: 2, scale: 0.98, duration: 0.1, ease: 'power1.out' }, position)
    .to(openLock, { autoAlpha: 1, duration: 0.12, ease: 'power1.out' }, position + 0.09)
    .to(openLock, { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.34, ease: 'back.out(1.7)' }, position + 0.09);
  return timeline;
}

function appendLockIconAnimation(timeline, closedLock, openLock, position = 0) {
  timeline
    .set(openLock, { autoAlpha: 0, x: -5, y: 3, rotation: -16, scale: 0.94, transformOrigin: '38% 70%' }, position)
    .set(closedLock, { autoAlpha: 0, y: -6, rotation: -8, scale: 0.82, transformOrigin: '38% 70%' }, position)
    .to(
      closedLock,
      { autoAlpha: 1, y: 0, rotation: 0, scale: 1, duration: 0.34, ease: 'back.out(1.7)' },
      position + 0.06
    );
  return timeline;
}

function animateLock(lock, open) {
  const closedLock = lock?.querySelector('.member-lock-closed');
  const openLock = lock?.querySelector('.member-lock-open');
  if (!closedLock || !openLock) return;
  lock._museLockTimeline?.kill();
  if (!gsap) {
    closedLock.style.opacity = open ? '0' : '1';
    closedLock.style.visibility = open ? 'hidden' : 'visible';
    openLock.style.opacity = open ? '1' : '0';
    openLock.style.visibility = open ? 'visible' : 'hidden';
    openLock.style.transform = '';
    return;
  }
  if (open) {
    lock._museLockTimeline = appendUnlockIconAnimation(
      gsap.timeline({
        onComplete: () => {
          lock._museLockTimeline = null;
        }
      }),
      closedLock,
      openLock
    );
    return;
  }
  lock._museLockTimeline = gsap
    .timeline({
      onComplete: () => {
        lock._museLockTimeline = null;
        gsap.set([closedLock, openLock], { clearProps: 'transform,opacity,visibility,willChange' });
      }
    })
    .to(openLock, { autoAlpha: 0, x: -5, y: 3, rotation: -16, scale: 0.94, duration: 0.14, ease: 'power1.in' })
    .to(closedLock, { autoAlpha: 1, y: 0, scale: 1, duration: 0.16, ease: 'power1.out' }, '>-0.03');
}

function renderSharing(sharing) {
  state.sharing = sharing || { members: [state.session.user] };
  state.session.sharing = state.sharing;
  const chain = byId('memberChain');
  chain.textContent = '';
  const members = state.sharing.members || [];
  const currentId = state.session.user.id;
  const maximum = Number(state.authProviders.sharingMaxMembers) || 5;
  const hasGroup = Boolean(state.sharing.groupId);
  const waitingForMembers = hasGroup && state.sharing.isOwner && members.length === 1;
  const memberNameCounts = new Map();
  for (const member of members) {
    const key = String(member.username || '')
      .trim()
      .toLocaleLowerCase('zh-CN');
    memberNameCounts.set(key, (memberNameCounts.get(key) || 0) + 1);
  }
  members.forEach((member, index) => {
    if (index > 0) {
      const lock = document.createElement('button');
      const clickable = state.sharing.isOwner || member.id === currentId;
      lock.type = 'button';
      lock.className = 'member-lock';
      lock.disabled = !clickable;
      lock.dataset.userId = member.id;
      lock.dataset.self = String(member.id === currentId && !state.sharing.isOwner);
      lock.setAttribute(
        'aria-label',
        clickable
          ? lock.dataset.self === 'true'
            ? '退出共享组'
            : `取消与${member.username}的数据共享`
          : '共享成员连接'
      );
      lock.innerHTML =
        '<i class="member-lock-glyph member-lock-closed" data-lucide="lock-keyhole" aria-hidden="true"></i><i class="member-lock-glyph member-lock-open" data-lucide="unlock" aria-hidden="true"></i>';
      if (clickable) {
        lock.addEventListener('pointerenter', () => memberTooltip(lock, true));
        lock.addEventListener('pointerleave', () => memberTooltip(lock, false));
        lock.addEventListener('focus', () => memberTooltip(lock, true));
        lock.addEventListener('blur', () => memberTooltip(lock, false));
        lock.addEventListener('click', () => openRemovalConfirm(member, lock));
      }
      chain.appendChild(lock);
    }
    const node = document.createElement('div');
    node.className = 'member-node';
    node.dataset.userId = member.id;
    const nameKey = String(member.username || '')
      .trim()
      .toLocaleLowerCase('zh-CN');
    const displayName =
      memberNameCounts.get(nameKey) > 1 ? `${member.username} · ${member.accountSuffix}` : member.username;
    node.innerHTML = `<span class="account-avatar">${avatarMarkup(member)}</span><small title="${escapeAttribute(displayName)}">${escapeHtml(displayName)}</small>`;
    chain.appendChild(node);
  });
  if (!members.length) chain.innerHTML = '<span class="member-empty">尚未开启共享</span>';
  byId('sharingStatus').hidden = !hasGroup;
  byId('sharingStatusLabel').textContent = waitingForMembers ? '等待成员加入' : '共享进行中';
  byId('sharingStatusHint').textContent = waitingForMembers ? '共享码已生效，发送给需要协作的人' : '';
  byId('sharingStatusHint').hidden = !waitingForMembers;
  byId('sharingMemberCount').textContent = `${members.length}/${maximum}`;
  byId('generateShareCodeButton').hidden = Boolean(hasGroup && !state.sharing.isOwner);
  byId('generateShareCodeButton').querySelector('span').textContent = state.sharing.hasInviteCode
    ? '重新生成共享码'
    : '生成共享码';
  byId('endShareGroupButton').hidden = !waitingForMembers;
  byId('joinShareButton').hidden = hasGroup;
  byId('sharingSectionActions').classList.toggle('is-ungrouped', !hasGroup);
  if (hasGroup) byId('joinShareForm').hidden = true;
  if (!hasGroup || !state.sharing.isOwner) {
    byId('shareCodePanel').hidden = true;
    byId('shareCodeValue').textContent = '';
  }
  refreshIcons(chain);
  refreshIcons(byId('sharingStatus'));
}

function openRemovalConfirm(member, lock) {
  state.lockTimeline?.kill();
  state.lockTimeline = null;
  const selfLeaving = member.id === state.session.user.id && !state.sharing.isOwner;
  state.removal = { member, lock, action: selfLeaving ? 'leave' : 'remove', returnFocus: lock };
  memberTooltip(lock, false);
  byId('sharingConfirmAvatar').innerHTML = avatarMarkup(member);
  byId('sharingConfirmTitle').textContent = selfLeaving ? '退出当前共享组？' : '取消与该成员共享？';
  byId('sharingConfirmDescription').textContent = selfLeaving
    ? `将取消你与「${member.username} · ${member.accountSuffix}」所在共享组的数据共享。`
    : `将取消与「${member.username} · ${member.accountSuffix}」的数据共享。`;
  byId('sharingConfirmImpact').textContent = selfLeaving
    ? '退出后，双方将无法继续访问彼此的共享画布和共享笔记，笔记编辑锁也会失效。内容仍归原所有者保存。'
    : '对方离开后，双方将无法继续访问彼此的共享画布和共享笔记，笔记编辑锁也会失效。内容仍归原所有者保存。';
  byId('confirmSharingRemovalButton').textContent = selfLeaving ? '确认退出' : '确认取消共享';
  byId('sharingConfirmDialog').hidden = false;
  refreshIcons(byId('sharingConfirmDialog'));
  requestAnimationFrame(() => byId('cancelSharingRemovalButton').focus({ preventScroll: true }));
}

function openEndSharingConfirm() {
  const member = state.session?.user;
  if (!member || !state.sharing?.isOwner || (state.sharing.members || []).length !== 1) return;
  state.removal = { member, lock: null, action: 'end', returnFocus: byId('endShareGroupButton') };
  byId('sharingConfirmAvatar').innerHTML = avatarMarkup(member);
  byId('sharingConfirmTitle').textContent = '结束当前共享组？';
  byId('sharingConfirmDescription').textContent = '共享码会立即失效，之后无法再通过该共享码加入。';
  byId('sharingConfirmImpact').textContent = '当前共享组只有你一名成员。结束共享不会删除账号、画布或笔记内容。';
  byId('confirmSharingRemovalButton').textContent = '确认结束共享';
  byId('sharingConfirmDialog').hidden = false;
  refreshIcons(byId('sharingConfirmDialog'));
  requestAnimationFrame(() => byId('cancelSharingRemovalButton').focus({ preventScroll: true }));
}

function cancelRemoval() {
  if (!state.removal) return;
  const lock = state.removal.lock;
  const returnFocus = state.removal.returnFocus;
  state.lockTimeline?.kill();
  state.lockTimeline = null;
  animateLock(lock, false);
  state.removal = null;
  byId('sharingConfirmDialog').hidden = true;
  requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }));
}

async function confirmRemoval() {
  if (!state.removal) return;
  const removal = state.removal;
  const confirm = byId('confirmSharingRemovalButton');
  const cancel = byId('cancelSharingRemovalButton');
  confirm.disabled = cancel.disabled = true;
  removal.lock?.classList.add('is-waiting');
  removal.lock?.setAttribute('aria-busy', 'true');
  try {
    const leavingGroup = removal.action === 'leave' || removal.action === 'end';
    const result = await request(
      leavingGroup ? '/api/sharing/leave' : `/api/sharing/members/${encodeURIComponent(removal.member.id)}`,
      { method: leavingGroup ? 'POST' : 'DELETE' }
    );
    const oldRects = memberRects();
    const node = byId('memberChain').querySelector(`.member-node[data-user-id="${CSS.escape(removal.member.id)}"]`);
    byId('sharingConfirmDialog').hidden = true;
    if (removal.lock) {
      animateLock(removal.lock, true);
      await new Promise((resolve) => setTimeout(resolve, 720));
    }
    if (removal.action !== 'end' && gsap && node) {
      await new Promise((resolve) => {
        state.lockTimeline?.kill();
        state.lockTimeline = gsap
          .timeline({ onComplete: resolve })
          .to(node, { x: 12, autoAlpha: 0, duration: 0.24, ease: 'power2.in' });
      });
    }
    state.removal = null;
    renderSharing(result.sharing);
    animateFlip(oldRects);
    global.dispatchEvent(new CustomEvent('muse:sharing-changed'));
    requestAnimationFrame(() =>
      (removal.action === 'end' ? byId('generateShareCodeButton') : byId('closeProfileButton'))?.focus({
        preventScroll: true
      })
    );
  } catch (error) {
    removal.lock?.classList.remove('is-waiting');
    removal.lock?.removeAttribute('aria-busy');
    animateLock(removal.lock, false);
    setError(byId('profileError'), error.message || '取消共享失败');
    byId('sharingConfirmDialog').hidden = true;
    state.removal = null;
    requestAnimationFrame(() => removal.returnFocus?.focus({ preventScroll: true }));
  } finally {
    confirm.disabled = cancel.disabled = false;
  }
}

export {
  animateFlip,
  animateLock,
  appendLockIconAnimation,
  appendUnlockIconAnimation,
  cancelRemoval,
  confirmRemoval,
  memberRects,
  memberTooltip,
  openEndSharingConfirm,
  openRemovalConfirm,
  renderSharing
};
