// Only untouched stock notes qualify. User text, formatting and geometry win
// over a template upgrade, including in a previously saved guide copy.
const GUIDE_LAYOUT_UPDATES = [
  { id: 'note_540347a19a6a4cf1', x: -411, y: -69.33333333333333, fill: '#fff4b2',
    sectionId: 'section_cf0e0d81c1e54128',
    before: '快速开始｜1 选择或新建画布 · 2 放下内容并连线 · 3 保存或导出成果',
    text: '快速开始\n1 选择或新建画布\n2 放下内容并连线\n3 保存或导出成果',
    layout: { x: -434, y: -85, w: 180, h: 180 } },
  { id: 'note_4352b1344ef94c68', x: -157.66666666666666, y: -69.33333333333333, fill: '#fff4b2',
    sectionId: 'section_cf0e0d81c1e54128',
    before: '导航要领｜滚轮缩放 · 拖动空白处平移 · 双击内容进入编辑 · Shift+S 快速建画框',
    text: '导航要领\n滚轮缩放\n空白处拖动平移\n双击内容进入编辑\nShift+S 建画框',
    layout: { x: -234, y: -85, w: 180, h: 180 } },
  { id: 'note_c4ad4a25457d47e9', x: -411, y: 317.3333333333333, fill: '#e8f1ff',
    sectionId: 'section_cbe06313cec946fd',
    before: '协作｜已注册用户可同步与共享 · 游客数据只保存在当前浏览器 · 更换设备前先登录并保存',
    text: '协作\n注册用户可同步与共享\n游客数据仅存于本机\n换设备前请登录并保存',
    layout: { w: 260, h: 180 } },
  { id: 'note_cc2d7558220f4d4a', x: -91, y: 317.3333333333333, fill: '#e8f8f0',
    sectionId: 'section_cbe06313cec946fd',
    before: '保存与导出｜看到“已保存”再离开 · PNG 适合快速分享 · 原画布便于继续编辑',
    text: '保存与导出\n看到“已保存”再离开\nPNG 适合快速分享\n原画布便于继续编辑',
    layout: { w: 260, h: 180 } },
  { id: 'note_f673958308a9435f', x: 229, y: 317.3333333333333, fill: '#f2ecff',
    sectionId: 'section_cbe06313cec946fd',
    before: '不容易发现｜双击内容进入编辑 · 画框可折叠、锁定、单独导出 · 重要内容先命名再整理',
    text: '不容易发现\n双击内容进入编辑\n画框可折叠、锁定\n也可单独导出\n重要内容先命名再整理',
    layout: { w: 260, h: 180 } }
];

function migrateGuideLayout(snapshot) {
  const changed = [];
  for (const update of GUIDE_LAYOUT_UPDATES) {
    const item = snapshot?.items?.find(entry => entry.id === update.id);
    if (!item || item.type !== 'note' || item.text !== update.before || ![item.x, item.y].every(Number.isFinite) ||
        item.w !== 210 || item.h !== 150 || Math.abs(item.x - update.x) > .001 || Math.abs(item.y - update.y) > .001 ||
        item.sectionId !== update.sectionId || item.layerId !== 'layer_default' || item.groupId ||
        item.rotation || item.locked || item.hidden || item.noteFill !== update.fill ||
        (item.noteStyle || 'paper') !== 'paper' || (item.noteBorder || 'none') !== 'none' ||
        item.noteShadow === false || (item.noteOpacity ?? 1) !== 1 ||
        item.fontSize !== 16 || item.color !== '#111111' || item.fontFamily !== 'system-ui, sans-serif' ||
        item.bold || item.italic || item.underline || (item.align || 'left') !== 'left' ||
        item.completedLines?.length || item.lineStyles?.some(style => style !== 'none')) continue;
    const runs = item.richText || [];
    if (runs.length && (runs.map(run => run.text).join('') !== update.before || runs.some(run =>
      run.bold || run.italic || run.underline || (run.color || '#111111') !== '#111111' ||
      (run.fontSize || 16) !== 16 || (run.fontFamily || 'system-ui, sans-serif') !== 'system-ui, sans-serif'))) continue;
    Object.assign(item, update.layout, { text: update.text,
      richText: [{ ...(runs[0] || {}), text: update.text }],
      contentVersion: (item.contentVersion || 0) + 1,
      lineStyles: update.text.split('\n').map(() => 'none') });
    changed.push(item.id);
  }
  return changed;
}

export { migrateGuideLayout };
