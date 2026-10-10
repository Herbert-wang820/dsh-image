# DSH Auto Visual

为 DSH 提供图片素材规划、提示词整理、供应商解耦生成和使用登记。供应商可选：
`disabled`（默认，不生成）、`mock`（本地生成明确标注 MOCK TEST 的测试图，不联网）、
`openai`（任何 OpenAI 兼容 Images API，真实生成）。插件只负责规划、生成、校验和登记素材；
**它不会自己编辑 PPT、网页或文档**，插图由主 Agent 用制作工具完成。

## 当前功能

- `visual_plan`：建立素材计划，返回确定性的提示词；传 `planId` 查询已保存计划。
- `visual_generate`：生成一张计划内素材；存在且完整的结果直接复用；不自动重复不确定请求。
- `visual_finalize`：记录成果路径和使用位置；只验证图片完整性、成果存在，不验证真实嵌入或渲染。
- PPT、网站 logo/头图、文档插图的场景指导。
- 预算默认每个拥有素材的 Agent 会话累计 3 张，跨计划共享。
- PNG 签名、分块 CRC、解压上限、尺寸比例与 SHA-256 验证。
- 工作区内原子持久化、跨进程互斥、取消、安全失败与错误脱敏。
- **DSH 设置页「图片生成」**：使用 DSH 原生 `SettingsForm`/`SettingsValueField`/`SettingsSecretField`
  显示 mode / provider / model / baseURL / apiKey / maxAssets，并提供只验证鉴权与模型查询的
  「检查连接」。编辑先暂存为草稿，点击原生「保存」后以一次原子 mutation 写入 `auto-visual` 条目。

示例输出（真实生成，非 UI 截图）：

![示例输出](docs/auto-visual-generation-test.png)

## 运行环境

- Node.js 24+；针对 DSH **0.1.7-rc.2** 验证注册接口，peer 范围见下方「打包契约与版本兼容」。
- DSH 必须提供 tools、systemPrompt、fs、sandboxPolicy、sandbox、subprocess 服务。
- 仅支持能映射到 Host 的本地/同世界文件系统；远程执行世界未验证。
- 所有工具当前需要写权限（查询也获取工作区锁）；read-only 下拒绝，不自行请求提权。
- 沙箱必须返回 `full` enforcement；缺失或 partial 会拒绝，不能绕过。

## 开发与测试

```sh
npm install     # 安装 peer 依赖（全新克隆需要；本开发机上依赖已就绪，可跳过）
npm run check   # 构建 + 全部测试 + 客户端契约检查
```

`npm install` 会触发 `prepare` 自动构建，因为 `dist/` 不入库。开发依赖通过
peerDependencies 解析：本开发环境为避免联网安装，把 `node_modules` 指向本机已安装的 DSH
依赖（符号链接，已被 `.gitignore` 忽略，不随包交付）。普通环境应正常安装匹配版本的依赖，
而不是复制该链接。

构建使用 Node 内置 TypeScript 语法剥离，**不是 TypeScript 静态类型检查**。测试使用真实 DSH
defineTool 检查注册 schema，以及内存存储和受控测试上下文验证功能。存储测试中的 sandbox
替身仅用于测试 worker，不代表已验证生产内核隔离。

## 安装（需用户明确授权后自行执行）

包由两半组成，一次安装同时生效：

- **Host 半**：`dist/index.js`，注册三个工具与系统提示指导（Cordis 插件）。
- **Browser 半**：`dist/client.js`，在 Web GUI 设置里注册「图片生成」配置页。
  `package.json` 的 `dsh.client`（`platform: web` + `inject`）声明其存在与依赖。

推荐用安装脚本，它会先校验构建产物与清单，再委托 `dsh plugin`：

```sh
npm run build
node scripts/install.mjs --profile web          # 加 --dry-run 只校验不改动
```

脚本等价于手工执行：

```sh
dsh plugin --profile web add /absolute/path/to/plugin
```

`dsh plugin add` 会用 pnpm 把包装进 profile，并自动把包名并入 `dsh.profile.bundles`
（装完需按 DSH 的重启要求重启 Host，然后刷新页面）。profile 目录必须可写；
若文件系统是只读挂载，脚本会明确报错并**不做任何修改**。

也可以从远端安装：

```sh
# 从 GitHub 源码安装：dist/ 不在仓库里，需要 pnpm 允许运行 prepare 构建
dsh plugin --profile web add github:Herbert-wang820/dsh-image

# 或从 npm 安装（预构建，免 allowBuilds 构建授权；需先发布）
dsh plugin --profile web add dsh-auto-visual
```

安装后：设置面板导航中出现「图片生成」一节（section id `auto-visual`，order 150）。
该页直接绑定本插件条目的配置，可改：

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `mode` | `off` / `suggest` / `auto` | 是否允许自动规划、是否允许生成 |
| `provider` | `disabled` / `mock` / `openai` | 禁用、测试或 OpenAI 兼容 Images API |
| `model` | 模型 ID | 如 `gpt-image-1`；mock 仅支持 `mock-v1` |
| `baseURL` | API 根地址 | 默认 `https://api.openai.com/v1` |
| `apiKey` | API Key | 直接输入的隐藏密钥；保存后不回显，留空不覆盖现有密钥 |
| `maxAssets` | 1–100 | 每个会话的素材上限 |

包声明的默认配置：

```yaml
mode: suggest
provider: disabled
model: mock-v1
baseURL: https://api.openai.com/v1
apiKey: ''
maxAssets: 3
```

默认可以规划，但**不能生成**。页面上或 profile 中显式改为：

```yaml
mode: auto
provider: mock
maxAssets: 3
```

即可跑通模拟链路。真实生成可在页面中设置 `provider: openai`、`model: gpt-image-1`，
并填写兼容接口的 `baseURL` 和隐藏的 `apiKey`。密钥直接在设置页输入，保存后不会回显；留空不会覆盖原有密钥。
适配器发送 `POST /images/generations`，要求返回 `data[0].b64_json` PNG；目前仅支持 `1:1`。
模型切换后应创建新计划；计划记录模型 ID，防止旧计划静默使用新模型。

密钥以 Host 侧 `role('secret')` 配置字段保存：Host 向浏览器描述配置时会移除该值，
页面只显示「已保存 / 尚未保存」。**注意：该值会写入本插件条目的 profile 配置
（`cordis.patch.yml`）明文，只是不会回传浏览器、不进入对话/提示词/日志/元数据。**
如果要求密钥完全不落在 profile 文件里，应改用 DSH 的 credentials 凭据域
（`ctx.remote.credentials` + `@deepseek-ai/dsh-credentials-local`），本插件目前没有采用该方案。

这里展示的是插件配置字段，不是完整 profile patch。当前开发实例已通过
`dsh plugin --profile web add /root/projects/plugin` 安装为本地链接，并确认最终组合配置包含
`auto-visual` 条目。代码更新后仍须按 DSH 的插件重载/重启要求生效；没有承诺自动热更新，
也没有启动替代 Web 服务。

## 配置页实现要点

设置页用 DSH 客户端插件的 `settings.section` 槽位注册：

- `ctx.slots.inject("settings.section", …)` → `ctx.slots.register({name:"settings.section", id:"auto-visual", order, label, locale, inject}, 组件)`
- `inject` 工厂把 `configForms.get("auto-visual")` 结果交给组件，组件经该作用域读写配置，`subscribe` 跟随变更。
- Host 半的 `Config` 字段必须带 `.volatile()`，否则 Host 拒绝从设置页写入。
- 入口 id 必须与 `cordis.patch.yml` 里插入的行 id（`auto-visual`）一致。
- **Remote 命名空间必须在挂载后声明依赖。** 连接检查服务由本插件自己通过
  `ctx.remote.$mount()` 挂载，其 Service 落在兄弟 fiber 上；Cordis 只把
  `ctx.remote.<namespace>` 提供给显式声明该名字的插件（否则报
  `cannot get property "remote.autoVisualConnection" without inject`）。因此注册顺序固定为：
  先 `await ctx.remote.$mount(...)`，再 `ctx.inject(["remote.autoVisualConnection", …], registerSection)`，
  并在该子上下文中读取服务；卸载时先释放 UI fiber，再释放 Remote。
  命名空间必须先挂载再声明，写进静态 `inject` 会让插件等待自己而永久停等。

连接检查结果区分两类失败：`CHECK_UNAVAILABLE` 表示 Host 半没加载（服务未挂载），
`CHECK_FAILED` 表示 RPC 真实失败，并附带网关错误码。

`node test/client-harness.mjs` 在 Node 里模拟模块加载器 + 最小 hooks 运行时，校验注册、绑定、
渲染、保存、密钥徽标与连接检查分支（无需浏览器）。`test/client-remote.test.ts` 额外用真实的
浏览器 Typert registry + `@deepseek-ai/dsh-api-gateway` 客户端 bundle 与真实 Cordis fiber 复现
命名空间可见性，`test/gateway.test.ts` 在 Host 侧用真实 Gateway 调用同一方法。

## 打包契约与版本兼容

`package.json` 的 `dsh` 字段是安装契约，由 `test/package-manifest.test.ts` 用真实
`loadProfileDirectory` + boot 流程校验（不是只解析 JSON）：

```jsonc
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // 必需：只有 dsh.client 无法安装
  "client": { "platform": "web", "inject": [ … ] }
}
```

- 只有声明 `dsh.bundle` 才能被 `dsh plugin add` 安装；只声明 `dsh.client` 是常见的被拒原因。
- `cordis.patch.yml` 的插入行 `name` 必须等于包名（`dsh-auto-visual`），`id` 必须等于插件条目 id
  （`auto-visual`），与设置页注册的 id 一致。
- `dsh.client.inject` 只列**声明了 `dsh.client` 的客户端包**，做的是模块图排序：缺一个会让
  插件等它而停等，多列一个非客户端包则没有对应图行。`dist/client.js` 里的
  `require("react")` 与 `require("@deepseek-ai/dsh-client-ui-primitives")` 由宿主打包器内联，
  官方客户端包同样**不**把它们写进 `inject`，因此这里也不列。
  `test/package-manifest.test.ts` 会校验每个 `inject` 条目确实声明了 `dsh.client`。
- 官方 `@deepseek-ai/*` 一律声明为 `peerDependencies`，不打包进依赖。

**peer 范围必须带显式预发布分支。** node-semver 只在该范围里存在「同一个
major.minor.patch 元组且自身带预发布标签」的比较符时，才放行预发布版本。因此

```jsonc
"@deepseek-ai/dsh": ">=0.1.0-rc.1 <0.2.0-0 || >=0.1.7-rc.1 <0.2.0-0"
```

第一个分支覆盖 `0.1.0-rc.*` 与所有 `0.1.x` 正式版，第二个分支覆盖当前 harness 所在的
`0.1.7-rc.*`。**harness 在新的 patch 元组上发布预发布版时，需要按同样形式追加一个分支**，
否则用户的 peer 解析会失败。已验证：该范围通过 harness 自身的兼容性门（`dsh-app-boot` 的
`evaluatePluginCompatibility`，`includePrerelease: true`），同时对当前运行版本满足 npm 的严格
semver 规则。

## 提交到 awesome-dsh-plugin 列表

待提交的条目已经写好并本地校验：`docs/submission/data/plugins/Herbert-wang820__dsh-image.yml`。
`test/submission-entry.test.ts` 会检查文件名、`url`/`name` 一致性、分类取值、描述格式（英文以
句号结尾、单行、无营销词）以及列表拒绝的字段。

在此之前需要在 GitHub 侧完成：

1. 把本仓库推送到 `https://github.com/Herbert-wang820/dsh-image`（远端默认分支是 `main`）：

   ```sh
   git remote add origin https://github.com/Herbert-wang820/dsh-image.git   # 已配置过可跳过
   git push -u origin main
   ```

2. 给仓库加上 `dsh-plugin` topic（列表要求）。两种方式任选：

   ```sh
   # 已登录的 GitHub CLI
   gh repo edit Herbert-wang820/dsh-image --add-topic dsh-plugin

   # 或者用有 repo 权限的 PAT
   curl -X PUT \
     -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/Herbert-wang820/dsh-image/topics \
     -d '{"names":["dsh-plugin"]}'
   ```

   也可以直接在网页上操作：仓库首页右栏 **About** 旁的齿轮 → **Topics**。
   topic 需要仓库写入权限，未认证的请求一定会失败。

3. 仓库存在满 1 天（CI 自动检查；不满足时做完功能再来即可，不影响后续提交）。
4. 可选：发布 npm 包（`repository` 字段需指回该仓库），或在 GitHub Release 附一个
   `.tgz` 预构建包——两者都能让安装跳过源码构建授权。

然后到 awesome-dsh-plugin 仓库开 PR，**只新增一个文件**：

```sh
cp docs/submission/data/plugins/Herbert-wang820__dsh-image.yml \
   <awesome-dsh-plugin>/data/plugins/Herbert-wang820__dsh-image.yml
```

不要手工编辑那两个生成出来的 README；一个 PR 最多 3 条，且不要改动别人的条目。

截图是可选项：列表的商店页会从 README 抽取图片作为回退，本 README 已包含一张真实生成示例图。
若想指定顺序与取舍，在仓库根放 `screenshots.json`（1–8 张、路径不得跳出插件目录）。当前
**没有**该文件：本插件唯一的界面是设置页，而这里无法截图，所以不拿非界面图片冒充截图。

## 操作示例

先让 Agent 创建计划：

```json
{
  "task": "测试网站配图闭环",
  "assets": [{
    "purpose": "website hero illustration",
    "subject": "abstract collaborative research workspace",
    "style": "navy and teal, minimal flat illustration",
    "placement": "right side hero; leave left side clear for text",
    "ratio": "16:9",
    "required": true
  }]
}
```

再向 visual_generate 传计划和素材 ID。`mock` 供应商的结果包含 `mock: true` 和明显的 MOCK TEST 标识；
`openai` 供应商则是真实模型输出。主 Agent 使用现有制作工具插入图片后，调用 visual_finalize 并传真实成果的工作区相对路径和位置。**该记录仍只是使用声明；必须用制作/渲染工具另外验证。**

图片和记录保存在工作区 `.dsh-auto-visual/<会话摘要>/`。网页或 Markdown 发布时，要把素材复制到公开资源目录并确保交付包含图片，不能假设隐藏目录会被打包。

## 持久化和恢复

- 每次工具操作持有工作区级互斥锁，不并行修改记录。
- 图片不可覆盖；记录原子替换。
- 中断的 generating 请求恢复为 uncertain，不重复计费式重试。
- 插件不自动抢占遗留锁。遇到锁冲突先确认是否存在活跃操作；只有确认全部结束后，由操作员检查并清理 `.dsh-auto-visual/.lock`。不要在生成中删除锁。
- 预算按会话累计，不是任意自然语言“任务”边界；没有跨子 Agent 的全局预算。
- 失败素材也保留预算占用，防止无限失败重试。当前没有重置预算/删除计划的工具。

## 明确限制

1. OpenAI 兼容适配器仅支持同步 base64 PNG、`1:1`，不下载返回 URL；参考图与图片编辑未实现。
   接口实际支持的模型由供应商决定，页面允许填写自定义模型 ID。
2. 不重写 PPT/Word/网页编辑器；不保证任意主模型都自动触发。
3. PNG 校验仅支持非隔行、8-bit 灰度/RGB/灰度 Alpha/RGBA 子集，最长边 4096；不支持所有合法 PNG。
4. 不提供真实视觉质量判定，也不提供通用 PPTX/DOCX 嵌入结构检查。
5. 工作区内文件属于可信协作场景；不提供对恶意同权限并发文件重命名的独立隔离。外层文件效果由 DSH sandbox 负责。
6. 不以 Mock 图片作为用户要求的真实图片交付。
7. 配置页编辑本插件的运行、供应商、模型、接口、隐藏密钥和预算字段；`mock` 与模型的组合在生成前校验，`openai` 的凭据、比例和接口响应在生成前/生成时校验。

## 扩展其他真实模型供应商

当前已有 OpenAI 兼容 Images API。若目标服务不兼容该协议，请提供 API 文档、鉴权类型、尺寸/格式支持、同步或异步返回、限流与任务查询能力。
Key 使用设置页的写入后不回显 secret 字段，不进入浏览器回读、对话、提示词、元数据或日志。核心导出 `ImageProvider` 接口供扩展。

验收分为：开发模拟通过 → 真实生图通过 → 真实 PPT/网站/文档回填验证通过。它们不是同一件事。

