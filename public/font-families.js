'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MuseFontFamilies = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Keep canvas text and worksheet cells on the same values. The first family
  // in each stack is the user's choice; the rest guarantee readable output on
  // devices where that commercial or operating-system font is unavailable.
  const options = [
    { value: 'system-ui, sans-serif', label: '系统默认' },
    { value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif', label: '苹方' },
    { value: '"Microsoft YaHei", "PingFang SC", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif', label: '微软雅黑' },
    { value: 'DengXian, "Microsoft YaHei", "PingFang SC", sans-serif', label: '等线' },
    { value: '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif', label: '思源黑体' },
    { value: 'SimSun, "Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", serif', label: '宋体' },
    { value: '"Source Han Serif SC", "Noto Serif CJK SC", SimSun, "Songti SC", serif', label: '思源宋体' },
    { value: 'FangSong, STFangsong, "Source Han Serif SC", serif', label: '仿宋' },
    { value: 'KaiTi, STKaiti, "Source Han Serif SC", serif', label: '楷体' },
    { value: 'SimHei, "Microsoft YaHei", "PingFang SC", sans-serif', label: '黑体' },
    { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
    { value: 'Aptos, Calibri, Arial, sans-serif', label: 'Aptos' },
    { value: 'Calibri, Aptos, Arial, sans-serif', label: 'Calibri' },
    { value: 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif', label: 'Arial' },
    { value: '"Times New Roman", "Source Han Serif SC", SimSun, serif', label: 'Times New Roman' },
    { value: 'Georgia, "Source Han Serif SC", SimSun, serif', label: 'Georgia' },
    { value: 'Consolas, "Cascadia Mono", "SFMono-Regular", monospace', label: 'Consolas' }
  ];

  return Object.freeze({
    options: Object.freeze(options.map((font) => Object.freeze(font)))
  });
});
