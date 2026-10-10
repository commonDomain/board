# 代码维护说明

## 入口与源码

`backend/server.js` 只启动服务，`backend/server/bootstrap.js` 负责装配。HTTP 路由、WebSocket 消息、操作校验、数据库和后台任务分别放在 `backend/server/` 下的对应模块。账号接口由 `account-api.js` 分派，邮箱、扫码、Passkey、资料、会话与共享各有独立处理文件。

通用环境配置在 `config.js`，地图凭据、限流和配额在 `amap-config.js`，环境变量的类型校验在 `environment-settings.js`。对象允许值和静态资源策略分别在 `item-schema.js` 与 `static-policy.js`，使用这些常量无需加载服务配置。

`AccountService` 保留调用入口与配置，具体流程放在 `account-sessions.js`、`account-pairing.js`、`account-passkeys.js`、`account-recovery.js`、`account-sharing.js` 和 `account-email.js`。这些函数接收账号服务上下文，跨流程协调经过公共入口，不修改类的原型。表结构由 `account-schema.js` 管理。XMind 按 OAuth、令牌存储、远程调用、链接和同步拆分，文档转换位于 `xmind-document.js`。

`public/app.js` 加载 `public/app/bootstrap.js`。画布、笔记、对象编辑、历史、同步、目录和导出按功能放在 `public/app/`，连接线功能进一步归入 `public/app/connector/`。这些文件使用原生 ES 模块，导入路径保持相对路径，以兼容带版本号的静态资源地址和子路径部署。

| 源码目录 | 职责 | 构建产物 |
| --- | --- | --- |
| `frontend/formula/` | 公式解析、求值、引用重写与函数 | `public/sheet-formula.js` |
| `frontend/sheet-core/` | 工作簿、单元格、结构修改和历史 | `public/sheet-core.js` |
| `frontend/sheet-view/` | 表格坐标、绘制与命中测试 | `public/sheet-view.js` |
| `frontend/sheet-editor/` | 工具栏、输入、菜单和编辑器生命周期 | `public/sheet-editor.js` |
| `frontend/sheet-xlsx/` | XLSX XML、读写、导入限制与 Worker 调度 | `public/sheet-xlsx.js` |
| `frontend/account/` | 登录、资料、会话、共享与隐私锁 | `public/account.js` |
| `frontend/brush/` | 采样、几何、笔刷与绘制 | `public/brush-engine.js` |
| `frontend/styles/` | 按界面组件划分的样式 | `public/styles.css` |

生成文件保留原有浏览器接口及需要的 Node 接口。修改源码后运行 `npm run build:frontend`；`npm start` 会先构建依赖和前端组件。样式顺序由 `frontend/styles/index.css` 决定，调整顺序前需检查层叠覆盖关系。

## 状态与依赖

客户端文档和会话状态集中在 `public/app/state.js`；DOM 引用在 `elements.js`。不调用其他交互流程的计算、查询和局部界面辅助函数抽到功能对应的 `*-model.js` 或 `*-data.js`，调用者直接导入实际归属文件。定时器、编辑上下文、缓存等运行状态由对应功能的 `runtime/` 模块持有。新增状态应放在实际使用它的功能内，仅在需要共享时导出。

独立笔记的界面、编辑器、模型和存储在 `frontend/notebook/`，由 `public/app/notes-bridge.js` 接入画布，服务端接口与独立表结构在 `backend/server/notebooks.js`。两端通过复制交换内容，不共享元素或坐标。旧画布笔记元数据由 `legacy-note-cleanup.js` 一次性移除，保留画布对象。目录控制由 `navigator-controller.js` 负责。脑图结构与测量在 `mindmap-model.js`，导入和放置流程在 `mindmap-import.js`。连接线工具栏、控件和交互分开；影响分析分别管理图计算、视觉效果、相机、面板和运行状态。账号界面的跨标签刷新在启动时作为明确回调传给频道，DOM 查询和身份显示不依赖认证流程。

表格编辑器和渲染器按实例创建功能模块，通过参数传递 DOM、状态和回调。工作簿的修改仍经过 store 的事务与历史入口，避免绕过撤销和公式重算。回调在装配完成后执行，不在构造时读取尚未创建的其他功能。

服务端 `operations.js` 校验操作形状与批次预算，再分派给笔记、对象、容器和设置处理函数。调用方负责草稿事务；批次共享操作计数，不能分别重置预算。数据库服务由启动模块初始化后注入运行状态。

画布入口先调用 `composition/index.js`，按指针、编辑、文档、视图、同步和连接线装配交互回调，再初始化连接线与主界面。需要调用其他交互流程的模块通过各自的 `configure…` 接口接收明确的函数；数据与计算辅助函数继续直接导入。装配文件只连接功能，不处理业务，不提供通用函数注册表。回调必须在初始化之前绑定，模块顶层不能执行依赖这些回调的操作。

## 构建与静态检查

```sh
npm run build
npm run check
```

静态检查覆盖项目源码中的未声明变量、重复键、不可达代码及应用入口的导入解析，阻止服务端、账号界面和整个画布依赖图重新引入循环依赖，并禁止模型层依赖交互控制模块。

项目已移除测试代码、一次性维护脚本及历史验证产物。真实邮箱收件、实体认证器、真实手机和生产网络需对应条件下验证。

`data/`、`data1/` 及部署配置指向的数据目录可能包含数据库、原图和备份，不属于临时产物。临时测试目录须由创建它的脚本清理，并在递归删除前确认绝对路径位于预期范围。
