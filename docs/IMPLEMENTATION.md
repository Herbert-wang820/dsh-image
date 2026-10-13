# 实现说明与边界

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

安装契约由 `package.json` 的 `dsh` 字段决定，并由 `test/package-manifest.test.ts` 用真实
`loadProfileDirectory` + boot 流程校验（不是只解析 JSON）：

```jsonc
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // 必需：只声明 dsh.client 无法安装
  "client": { "platform": "web", "inject": [ … ] }
}
```

- 只有声明 `dsh.bundle` 才能被 `dsh plugin add` 安装；只声明 `dsh.client` 是最常见的被拒原因。
- `cordis.patch.yml` 的插入行 `name` 必须等于包名（`dsh-auto-visual`），`id` 必须等于插件条目 id
  （`auto-visual`），与设置页注册的 id 一致。
- `dsh.client.inject` 只列**声明了 `dsh.client` 的客户端包**，做的是浏览器模块图排序：缺一个会让
  插件等它而停等，多列一个非客户端包则没有对应图行。`dist/client.js` 里的 `require("react")` 与
  `require("@deepseek-ai/dsh-client-ui-primitives")` 由宿主打包器内联，官方客户端包同样**不**把它们
  写进 `inject`。测试会校验每个 `inject` 条目确实声明了 `dsh.client`。
- 官方 `@deepseek-ai/*` 一律声明为 `peerDependencies`，不打包进依赖。

**peer 范围必须带显式预发布分支。** node-semver 只在该范围里存在「同一个 major.minor.patch 元组
且自身带预发布标签」的比较符时，才放行预发布版本：

```jsonc
"@deepseek-ai/dsh": ">=0.1.0-rc.1 <0.2.0-0 || >=0.1.7-rc.1 <0.2.0-0"
```

第一个分支覆盖 `0.1.0-rc.*` 与所有 `0.1.x` 正式版，第二个分支覆盖当前 harness 所在的
`0.1.7-rc.*`。**harness 在新的 patch 元组上发布预发布版时，需要按同样形式追加一个分支**，否则
用户的 peer 解析会失败。该范围已双向验证：通过 harness 自身的兼容性门（`dsh-app-boot` 的
`evaluatePluginCompatibility`，`includePrerelease: true`），同时对当前运行版本满足 npm 的严格
semver 规则。

`license` 为 MIT 并附 `LICENSE`；`repository` 指向 GitHub 仓库；`files` 只收 `dist`、
`cordis.patch.yml`、`README.md` 与本文档，测试产物不进包。

### 投稿流程（待执行）

待提交条目已写好并本地校验：`docs/submission/data/plugins/Herbert-wang820__dsh-image.yml`
（分类 `vision`）。`test/submission-entry.test.ts` 检查文件名、`url`/`name` 一致性、分类取值、
描述格式（英文以句号结尾、单行、无营销词）以及列表拒绝的字段。

提交前需要在 GitHub 侧完成：

```sh
# 1. 推送（远端默认分支是 main；该机器 HTTPS 无凭据，用已注册的 SSH key）
git push -u origin main

# 2. 加 dsh-plugin topic（列表要求，需仓库写权限）
gh repo edit Herbert-wang820/dsh-image --add-topic dsh-plugin
# 或：curl -X PUT -H "Authorization: Bearer $GITHUB_TOKEN" \
#      -H "Accept: application/vnd.github+json" \
#      https://api.github.com/repos/Herbert-wang820/dsh-image/topics -d '{"names":["dsh-plugin"]}'
```

网页路径：仓库首页右栏 **About** 齿轮 → **Topics**。此外仓库需存在满 1 天（CI 自动检查）。
可选：发布 npm 包或在 GitHub Release 附 `.tgz`，安装时可跳过源码构建授权。

然后到 awesome-dsh-plugin 开 PR，**只新增一个文件**（不要手工编辑生成出来的 README，一个 PR
最多 3 条，且不要改动别人的条目）：

```sh
cp docs/submission/data/plugins/Herbert-wang820__dsh-image.yml \
   <awesome-dsh-plugin>/data/plugins/Herbert-wang820__dsh-image.yml
```

截图（可选）：列表商店页会从 README 抽取图片作为回退，README 中已放一张真实生成示例图。仓库当前
**没有** `screenshots.json`：本插件唯一的界面是设置页，实现环境无法截图，因此不拿非界面图片冒充
截图。

## 开发环境说明

- 本仓库的 `node_modules` 是指向本机已安装 DSH 依赖的符号链接（`.gitignore` 已忽略且不随包交付），
  因此这台机器上无需 `npm install` 即可跑测试；普通克隆需要正常安装 peer 依赖。
- `dist/` 不入库，由 `prepare` 或 `npm run build` 生成；`npm install` 会触发 `prepare` 自动构建。
- profile 目录只读时，`dsh plugin`、`--dump-config*` 等命令会因取锁失败而报 EROFS，此时不做任何
  修改，也不会绕过或提权重试。

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
