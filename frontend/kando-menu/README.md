# 圆盘工具盘（Kando 菜单引擎）

非经典主题下，右键画布空白处或手指长按会打开圆盘工具盘。渲染与交互来自开源项目 [Kando](https://github.com/kando-menu/kando)（代码 MIT，菜单主题 CC0-1.0），取自提交 `09ab6c6dd1249de61069abda0f90fc9405099404`（2026-10-21）。

## 目录

| 路径 | 来源 |
| --- | --- |
| `vendor/menu-renderer/*` | Kando `src/menu-renderer`，保留原文件头与 SPDX 声明 |
| `vendor/common/math/index.ts`、`vendor/common/key-mapper.ts` | Kando `src/common` 原文件 |
| `vendor/common/index.ts` | 精简替身：只保留渲染器运行所需的枚举与类型，不含 Electron 设置与 IPC |
| `vendor/common/icon-themes/icon-theme-registry.ts` | 替身：改用画板现有的 Lucide 图标 |
| `shims/events.js` | 浏览器版 EventEmitter |
| `index.ts` | 画板适配层，暴露 `createWheel(host, { renderIcon, onSelect, onClose })` |

主题样式见 `frontend/styles/themes/wheel.css`：第一部分由 Kando `index.scss` 转写为普通 CSS，第二部分基于 Kando “Default” 主题（CC0）改写，并跟随当前界面主题取色。

## 对 Kando 源码的修改

均以 `[Museboard patch]` 注释标出：

1. `menu-theme.ts`：主题样式随画板 CSS 一起发布，未提供主题目录时不再创建 `file://` 样式链接。
2. `input-methods/gamepad.ts`：游戏手柄轮询改为显式开启（`Gamepad.pollingEnabled`），避免窗口获得焦点后每帧轮询。

## 构建

`npm run build:frontend` 会把 `index.ts` 打包为 `public/kando-menu.js`（ESM，首次打开圆盘时才加载）。升级 Kando 时，用新版本覆盖 `vendor/` 中对应文件，重新应用上面两处修改，再运行 `npm run check` 与界面检查。
