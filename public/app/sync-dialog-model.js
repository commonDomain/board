// User-facing state is separate from server diagnostics and recovery actions.
export function describeSyncIssue(state, imageCount = 0) {
  const reason = state.syncQueue.blockedReason || '';
  const safety = state.draftRestoreFailed ? '原草稿记录已保留。请勿清除浏览器数据。' :
    state.draftStorageFailed ? '请保持此页面开启，避免关闭后丢失修改。系统会自动重试保存。' :
    state.draftRestoring ? '正在读取本机草稿，请稍候。' :
    state.draftStoragePending ? '正在保存本机草稿，请暂时不要关闭页面。' :
    state.syncQueue.length ? '未同步修改已保存在此浏览器，尚未同步到其他设备。' : '当前没有待提交的画布修改。';
  const result = (title, description, action, label) => ({ title, description, action, label, safety });
  if (state.draftDiscardPending) return result('正在使用云端版本', '正在清理当前画布的本地草稿，其他画布不受影响。', 'wait', '正在处理…');
  if (state.draftRestoring) return result('正在恢复草稿', '恢复完成后会自动继续同步。', 'wait', '正在恢复…');
  if (state.draftRestoreFailed) return result('暂时无法读取草稿', '已暂停编辑，正在自动重试。', 'restore', '重新读取');
  if (state.draftStorageFailed) return result('草稿暂未保存', '已暂停编辑，正在自动重试。保存成功后会恢复编辑。', 'persist', '重新保存');
  if (state.accessReadOnly) return result('暂时无法编辑', '当前账号已没有编辑权限，请联系画布所有者。', 'none', '');
  if (state.compatibilityReadOnly) return result('需要更新页面', '当前页面无法处理新版画布内容。本地草稿已保留，请刷新页面后重试。', 'none', '');
  if (imageCount) return result(imageCount === 1 ? '有一张图片待处理' : `有 ${imageCount} 张图片待处理`,
    '这张图片的访问权限已失效。重新选择原图即可恢复；不依赖它的文字和背景修改会继续同步。', 'image', '重新选择图片');
  if (/冲突|已有其他修改|CONTENT_CONFLICT|CONNECTOR_CONFLICT|CONNECTOR_VERSION|ELEMENT_CONFLICT|元素已被其他成员|旧版草稿/.test(reason))
    return result('有修改需要处理', '云端已有更新。可恢复本地修改，或丢弃草稿并使用云端版本。', 'conflict', '处理冲突');
  if (/锁定|locked/i.test(reason)) return result('目标图层已锁定', '解锁图层后可继续同步。未完成前已暂停编辑。', 'retry', '解锁后重试');
  if (reason) return result('部分修改暂未同步', '服务器暂未接受这些修改。可以重试，或查看详细原因。', 'retry', '立即重试');
  if (state.syncQueue.length) return result(state.connected ? '正在同步修改' : '等待网络恢复',
    state.connected ? '修改会自动同步，无需重复点击。' : '联网后会自动同步，本地草稿保存完成后可以继续编辑。', 'retry', '立即重试');
  return result('问题已处理', '无需其他操作，可以关闭此窗口。', 'done', '完成');
}
