import { SHARING_ENABLED } from './config.js';
import { readJsonBody } from './http-body.js';
import { sendJson } from './http-response.js';
import { servicesRuntime } from './runtime/services.js';
import { disconnectRevokedUser, notifySharingChanged } from './session-access.js';

async function handleSharingGet(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/sharing') {
    if (!SHARING_ENABLED) {
      sendJson(res, 503, { error: '实时共享暂时关闭', code: 'SHARING_DISABLED' });
      return true;
    }
    sendJson(res, 200, servicesRuntime.accountService.getSharing(session.userId));
    return true;
  }
  return false;
}

async function handleSharingInviteCodePost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/sharing/invite-code') {
    if (!SHARING_ENABLED) {
      sendJson(res, 503, { error: '实时共享暂时关闭', code: 'SHARING_DISABLED' });
      return true;
    }
    sendJson(res, 200, servicesRuntime.accountService.regenerateInviteCode(session.userId));
    return true;
  }
  return false;
}

async function handleSharingJoinPost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/sharing/join') {
    if (!SHARING_ENABLED) {
      sendJson(res, 503, { error: '实时共享暂时关闭', code: 'SHARING_DISABLED' });
      return true;
    }
    const body = await readJsonBody(req);
    const sharing = servicesRuntime.accountService.joinGroup(session.userId, body?.inviteCode);
    notifySharingChanged(
      sharing.members.map((member) => member.id),
      'membership'
    );
    sendJson(res, 200, { sharing });
    return true;
  }
  return false;
}

async function handleSharingMembersIdDelete(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;
  const memberMatch = pathname.match(/^\/api\/sharing\/members\/([0-9a-f-]{36})$/);
  if (memberMatch && req.method === 'DELETE') {
    if (!SHARING_ENABLED) {
      sendJson(res, 503, { error: '实时共享暂时关闭', code: 'SHARING_DISABLED' });
      return true;
    }
    const group = servicesRuntime.accountService.groupForUser(session.userId);
    const affectedUserIds = group
      ? servicesRuntime.database
          .prepare('SELECT user_id FROM share_members WHERE group_id = ?')
          .all(group.id)
          .map((row) => row.user_id)
      : [];
    const result = servicesRuntime.accountService.removeMember(session.userId, memberMatch[1]);
    for (const userId of affectedUserIds) disconnectRevokedUser(userId);
    notifySharingChanged(affectedUserIds, 'membership');
    sendJson(res, 200, result);
    return true;
  }
  return false;
}

async function handleSharingLeavePost(req, res, requestUrl, session) {
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/sharing/leave') {
    if (!SHARING_ENABLED) {
      sendJson(res, 503, { error: '实时共享暂时关闭', code: 'SHARING_DISABLED' });
      return true;
    }
    const before = servicesRuntime.accountService.groupForUser(session.userId);
    const sharing = servicesRuntime.accountService.leaveGroup(session.userId);
    disconnectRevokedUser(session.userId);
    if (before) {
      for (const row of servicesRuntime.database
        .prepare('SELECT user_id FROM share_members WHERE group_id = ?')
        .all(before.id))
        disconnectRevokedUser(row.user_id);
    }
    const affectedUserIds = before
      ? servicesRuntime.database
          .prepare('SELECT user_id FROM share_members WHERE group_id = ?')
          .all(before.id)
          .map((row) => row.user_id)
      : [];
    notifySharingChanged([...affectedUserIds, session.userId], 'membership');
    sendJson(res, 200, { sharing });
    return true;
  }
  return false;
}
export {
  handleSharingGet,
  handleSharingInviteCodePost,
  handleSharingJoinPost,
  handleSharingMembersIdDelete,
  handleSharingLeavePost
};
