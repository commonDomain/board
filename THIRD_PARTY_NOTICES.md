# 第三方组件与素材

Museboard 的 Apache-2.0 授权适用于项目原创代码与文档。第三方组件与素材保留各自的许可证与版权声明，不能通过本项目的 `LICENSE` 获得额外授权。

## 随仓库提供的浏览器组件

| 组件 | 对应文件 | 授权与声明 |
| --- | --- | --- |
| Lucide 0.468.0 | `public/vendor/icons.min.js` | ISC；部分图标源自采用 MIT 的 Feather，见 [原始声明](public/vendor/icons.LICENSE.txt) |
| perfect-freehand 1.2.3 | `public/vendor/perfect-freehand.min.js` | [MIT](public/vendor/perfect-freehand.LICENSE.txt) |
| SimpleWebAuthn Browser 13.3.0 | `public/vendor/simplewebauthn-browser.min.js` | [MIT](public/vendor/simplewebauthn-browser.LICENSE.txt) |
| fflate 0.8.3 | `public/vendor/fflate.min.js` | [MIT](public/vendor/fflate.LICENSE.txt) |
| saxes 6.0.0 | `public/vendor/saxes.min.js` | [ISC 与上游声明](public/vendor/saxes.LICENSE.txt) |
| xmlchars | 包含在 `public/vendor/saxes.min.js` 中 | [MIT](public/vendor/xmlchars.LICENSE.txt) |
| GSAP 3.15.0 | `public/vendor/gsap.min.js` | [GSAP Standard License](https://gsap.com/community/standard-license/)；保留 bundle 中的版权声明，使用与分发须遵守 GSAP 自身条款 |
| Libraries 效果适配 | 相关界面效果 | [MIT 与来源声明](public/vendor/libraries-effects.LICENSE.txt) |
| Liquid Glass | `public/vendor/liquid-glass.js` | [MIT](public/vendor/liquid-glass.LICENSE.txt) |
| WPS WebOffice SDK 2.0.7 | `public/vendor/web-office-sdk-solution-v2.0.7.umd.js` | [官方 SDK 文档](https://open.wps.cn/documents/app-integration-dev/docs-center/online-preview-edit/web/jssdk) |

前端构建产物中包含的其他第三方组件须保留原有许可注释。通过 npm 安装的服务端、构建工具和其他依赖，以各包附带的许可证为准；`package-lock.json` 记录安装版本。这份说明不将这些组件重新授权为 Apache-2.0。

## 背景素材

背景图片的来源及各自授权见 [背景素材说明](public/backgrounds/README.md)。分发这些素材时应同时保留该说明及适用的署名。
