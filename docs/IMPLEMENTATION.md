# 实施方案与边界（第一版）

## 目标
自动配图编排：语义判断 → 结构化素材计划 → 提示词整理 → 生成并持久化 → 主 Agent 回填 → 分级验证。默认禁用生成；可显式启用模拟供应商，或配置 OpenAI 兼容 Images API 与模型 ID。

## 已核实接口
目标版本 DSH 0.1.7-rc.2。Cordis ESM 插件 named exports name/inject/Config/apply；defineTool 使用属性映射 DSL 和 canonical JSON output；systemPrompt.section 注册指导；sandboxPolicy.resolve 从调用会话获取权限与工作区；fs 支持受限读取和文本写入，但不支持通用二进制写入。因此图片/记录写入经同世界受约束子进程进行，要求 full sandbox enforcement，不允许未隔离降级。远程工作区不保证可用，无法证明同世界时拒绝。

## 界面接入（client 半）
DSH 的 Web 设置是客户端插件，不是一个独立服务。已核实的接法：

- 包声明 `dsh.client`（`platform: "web"` + `inject`）并提供 `exports["./client"]`；
  Host 据此把该包作为浏览器模块加载。`inject` 只列真正提供所需服务的包
  （locale / ui-renderer / ui-settings），多列一个未挂载的包会让插件停等。
- 浏览器半是 `window.__ModuleLoader__.load({id, factory})` 模块，导出 `inject` 与 `apply`。
- `apply` 先 `await ctx.remote.$mount()` 挂载本插件的 `autoVisualConnection` Remote descriptor，
  随后必须 **在挂载之后** 用 `ctx.inject(["remote.autoVisualConnection", …], registerSection)`
  建立依赖，再在该子上下文里注册设置页并读取 `ctx.remote.autoVisualConnection`。
  已核实原因：命名空间 Service 由 `$mount` 装在兄弟 fiber 上，Cordis 只把
  `ctx.remote.<namespace>` 提供给显式声明该名字的 fiber，否则抛
  `cannot get property "remote.autoVisualConnection" without inject`（注册页仍会渲染，
  只有服务读取失败）。把该名字写进静态 `inject` 会让插件等待自己而永久停等；
  这与 DSH 自身 `dsh-experimental-client-ui-voice-input` 的客户端写法一致。
  卸载时先释放 UI fiber（会注销槽位与表单），再释放 Remote。
- 连接检查失败区分为 `CHECK_UNAVAILABLE`（Host 半未加载、命名空间不存在）与
  `CHECK_FAILED`（RPC 失败，附带网关错误码），便于区分部署问题与真实调用失败。
- `apply` 经 `ctx.slots.inject("settings.section", …)` + `ctx.slots.register({...}, 组件)`
  注册设置页；`inject` 工厂把 `configForms.get("<entry id>")` 的结果、表单模型和作用域
  快照 store 交给组件。
- 0.1.7 设置模型下，插件自己的 Cordis `Config` 就是它的设置表单；Host 只服务
  `volatile()` 字段并拒绝写其他路径，因此可编辑字段都带 `.volatile()`。
- 入口 id 必须等于 `cordis.patch.yml` 插入行的 id（`auto-visual`）。
- 构建仍是语法剥离：`src/client.ts` 是纯 JS（`React.createElement`，无 JSX），
  与 dist 逐字节一致，因此不需要打包器；没有引入新的构建依赖。

## 功能边界
- 插件管理计划、图片和记录；主 Agent 使用现有 PPT/网页/文档制作工具完成插入。
- 不根据关键词强制生成，不自动写入任意成果。
- 图片只支持首版定义的 PNG 子集；真实供应商接入时按其格式扩展或安全转换。
- 模拟图片是明确标注 MOCK TEST 的测试图，不是模型生成的正式配图。
- 基础完整性检查 + 使用声明，不冒充结构嵌入或视觉渲染验证。
- 设置页使用 DSH 原生 `SettingsForm`、`SettingsValueField`、`SettingsSecretField` 与 `SettingsFormModel`，编辑运行模式、供应商、模型 ID、API 地址、写入后不回显的 API Key 和素材预算；
  草稿在点击保存前不写入；普通字段通过 `mutate` 保存，密钥作为 schema `role('secret')` 字段单独写入，空输入不覆盖已有值；
  密钥徽标读取 `remote.settings.describe()` 的 `secrets` 旁路（只报告该槽位是否已设置，不回传值），该命名空间读取失败时仅降级徽标，不影响页面。
- 支持 OpenAI 兼容 Images API（同步 base64 PNG、1:1）；模型 ID 随计划持久化并进入实际请求。密钥由插件 secret 配置直接提供，Host 向浏览器描述配置时会脱敏。
  已知取舍：该 secret 仍会以明文写入本插件条目的 profile 配置（`cordis.patch.yml`）。若要求密钥不落 profile，需要改为 DSH credentials 凭据域（`ctx.remote.credentials` + Host 侧 `ctx.credentials`），当前未采用。未实现参考图、重绘、矢量 logo、商标保证。
- 无真实供应商配置默认禁用生成；用户显式选择 mock 才可运行模拟链路。
- 预算按拥有素材的 Agent 会话跨计划累计，不具备任务看板级/跨子 Agent 汇总预算。上级 Agent 不应并行委派以绕过限制。
- 跨进程通过工作区锁防止并发记录覆盖；崩溃遗留锁不自动抢占，需要确认没有活跃操作后由操作员恢复。

## 打包与提交（按 awesome-dsh-plugin 贡献指南）

- `package.json` 的 `dsh.bundle.patch` 是可安装性的唯一来源；只声明 `dsh.client` 无法被
  `dsh plugin add` 安装。`dsh.client.inject` 只列声明了 `dsh.client` 的客户端包；客户端库
  （react、ui-primitives）由宿主打包器内联，官方包同样不列进 `inject`。
- 官方 `@deepseek-ai/*` 一律用 `peerDependencies`；peer 范围必须带显式预发布分支，否则
  node-semver 会静默排除 harness 的预发布版本。当前范围由 harness 自身的
  `evaluatePluginCompatibility`（`includePrerelease: true`）与 npm 严格 semver 双向验证。
- `license` 为 MIT 并附 `LICENSE`；`repository` 指向 GitHub 仓库。
- 待提交条目：`docs/submission/data/plugins/Herbert-wang820__dsh-image.yml`（分类 `vision`），
  提交前需把仓库推送到 GitHub、加 `dsh-plugin` topic、满足 1 天仓库年龄。
- 校验测试：`test/package-manifest.test.ts`（真实 `loadProfileDirectory` + boot 走完
  bundle → patch → 包解析 → 插件加载，并校验 `inject` 条目确为客户端包）、
  `test/submission-entry.test.ts`（条目字段与格式）。
- 截图：仓库未提供 `screenshots.json`。唯一界面是设置页，当前环境无法截图，因此不用非界面
  图片冒充截图；商店页会回退到 README 中的真实生成示例图。

## 完成定义
1. 开发初版：构建、模拟单元/集成测试、注册 smoke test、client 半契约测试通过。
2. 真实接入：根据用户后续接口文档配置真实适配器与凭据，真实生成通过。
3. 端到端验收：真实素材进入 PPT/网站/文档并通过制作工具检查。
4. 界面验收：当前 Web profile 已安装本地链接，最终组合配置已确认包含 `auto-visual`，浏览器 bundle
   语法与客户端契约测试通过。由于现有 `127.0.0.1:3080` 受浏览器会话鉴权保护且没有隐式 DOM，
   尚未声称完成真实页面的目视/点击确认；刷新页面后应在设置导航中验收。
不能以第 1 项替代第 2、3、4 项。

## 后续真实供应商
需要 base URL、模型 ID、API 文档、鉴权方式、尺寸/格式、同步或异步返回、限流/费用、幂等/查询/取消能力。Key 通过插件的 write-only secret 字段配置，不回传浏览器，也不放对话、提示词、元数据和日志。不得默认任意 OpenAI-compatible 服务兼容。网络下载需大小/类型限制、重定向及私网策略，不向图片下载域名转发生成 API 凭据。
