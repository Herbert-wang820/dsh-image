# DSH Auto Visual

DSH 插件的图片素材编排：把「需要什么图」变成结构化计划，交给可替换的供应方生成，再登记每张图
被用在哪里。它只产出与登记素材，**不自己编辑 PPT、网页或文档**——插图由主 Agent 用已有的制作
工具完成。

示例输出（`gpt-image-2` 真实生成，非界面截图）：

![示例输出](docs/auto-visual-generation-test.png)

## 设计理念

**职责分离。** 一次配图任务拆成三段，各自可以单独失败、单独重试：`visual_plan` 只做规划，
`visual_generate` 只做生成，`visual_finalize` 只做使用登记。插件不越界写交付物，所以换任何主
模型、任何制作工具都不影响它。

**供应方解耦。** 生成走 `ImageProvider` 接口，内置 `disabled`（默认）、`mock`（本地测试图）、
`openai`（任何 OpenAI 兼容 Images API）。计划里固定记录 `providerId` 与 `modelId`，生成前校验，
避免旧计划静默换成别的模型产出。

**默认不生成。** 出厂配置是 `mode: suggest` + `provider: disabled`：可以规划，但不会产生任何
调用与费用。生成必须显式把 `mode` 改成 `auto`。模拟供应方的产物带 MOCK TEST 标识，不会被当作
真实交付。

**事实与声明分开。** `visual_finalize` 记录的是「调用者声明把这张图用在了哪里」，只校验素材
完整性和成果路径存在，不冒充嵌入或渲染验证。分级验收标准见 `docs/TESTING.md`。

**幂等与不可变。** 已生成且完整的结果直接复用；图片一经写入不可覆盖；中断的请求恢复为
uncertain，而不是自动重试，避免重复计费。

**凭据最小暴露。** API Key 是 Host 侧 `role('secret')` 字段：写入后不回显，不随配置描述回传
浏览器，不进入对话、提示词、日志或元数据；密钥只在 Host 进程内使用。

**与 DSH 原生能力对齐。** 配置就是插件自己的 Cordis `Config`，设置页用 DSH 原生表单控件渲染并
跟随主题，保存走带 revision 的原子 mutation；连接检查通过插件自己的 Remote 命名空间提供。

## 安装与部署

### 环境要求

- Node.js 24+。
- DSH：针对 **0.1.7-rc.2** 验证；插件宿主需提供 tools、systemPrompt、fs、sandboxPolicy、
  sandbox、subprocess 服务。
- 仅支持能映射到 Host 的本地/同世界文件系统；远程执行世界未验证。
- 工具需要写权限（连查询也会取工作区锁），read-only 下直接拒绝，不自行提权。
- 沙箱必须返回 `full` enforcement；缺失或 partial 会拒绝，不允许未隔离降级。

### 安装

包由两半组成，一次安装同时生效：

- **Host 半** `dist/index.js`：注册三个工具与系统提示指导。
- **Browser 半** `dist/client.js`：在 Web GUI 的设置里注册「图片生成」一页。

把包规格交给 `dsh plugin`（本地路径、npm 包名或 pnpm 支持的 git 规格都可以）：

```sh
# 从 GitHub 源码安装；dist/ 不入库，需要允许 pnpm 运行 prepare 构建
dsh plugin --profile <profile> add github:Herbert-wang820/dsh-image

# 发布到 npm 之后（预构建产物，免构建授权）
dsh plugin --profile <profile> add dsh-auto-visual
```

本地开发用仓库里带校验的安装脚本：

```sh
npm run build
node scripts/install.mjs --profile web            # 加 --dry-run 只校验、不改动
```

脚本先校验构建产物与安装清单，再等价于手工执行 `dsh plugin --profile web add <本目录>`。它们都会
把包并入 profile 的 `dsh.profile.bundles`；**装完需重启 Host，然后刷新页面**。profile 目录必须
可写，只读挂载时脚本会明确报错并**不做任何修改**。

安装成功后的标志：设置面板导航里出现「图片生成」一节（section id `auto-visual`）。

### 配置

设置页直接绑定本插件的配置条目：

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `mode` | `off` / `suggest` / `auto` | 关闭 / 只规划 / 允许生成 |
| `provider` | `disabled` / `mock` / `openai` | 禁用 / 本地测试图 / OpenAI 兼容 Images API |
| `model` | 模型 ID | 如 `gpt-image-2`；`mock` 仅接受 `mock-v1` |
| `baseURL` | API 根地址 | 默认 `https://api.openai.com/v1` |
| `apiKey` | API Key | 直接输入、字符隐藏；保存后不回显，留空不覆盖已有密钥 |
| `maxAssets` | 1–100 | 每个会话的素材上限，默认 3 |

出厂默认：

```yaml
mode: suggest
provider: disabled
model: mock-v1
baseURL: https://api.openai.com/v1
apiKey: ''
maxAssets: 3
```

**先跑模拟链路**：把 `mode` 设为 `auto`、`provider` 设为 `mock` 并保存，即可在完全不联网的情况下
验证规划 → 生成 → 登记全流程。

**再切真实生成**：把 `provider` 设为 `openai`，填 `model`、`baseURL` 和 `apiKey` 后保存。适配器
向 `POST {baseURL}/images/generations` 发请求，要求返回 `data[0].b64_json` 的 PNG；当前仅支持
`1:1`。切换模型后应新建计划——旧计划记录着原模型 ID，不会静默换模型。

### 验证部署

设置页的「检查连接」只做一件事：用已保存的密钥按配置请求 `GET {baseURL}/models/{model}`，确认
鉴权可用且模型 ID 匹配。它**不生成图片**，因此通过检查不等于具备生图权限；反过来，接口不支持
模型查询时会报无法确认而不是保存失败。失败会区分 `CHECK_UNAVAILABLE`（Host 半未加载）与
`CHECK_FAILED`（调用失败，附网关错误码）。

## 使用

三个工具构成完整闭环：

1. `visual_plan`：给出任务标签与素材列表（用途、主体、风格、放置位置、比例、是否必需），返回
   确定性的提示词与素材 ID；只传 `planId` 可回查已保存的计划。
2. `visual_generate`：按 `planId` + `assetId` 生成一张；已存在且完整的结果直接复用。
3. `visual_finalize`：主 Agent 用制作工具把图插进交付物后，回填**工作区相对路径**和实际位置。

```json
{
  "task": "网站首页配图",
  "assets": [{
    "purpose": "website hero illustration",
    "subject": "abstract collaborative research workspace",
    "style": "navy and teal, minimal flat illustration",
    "placement": "right side hero; leave left side clear for text",
    "ratio": "1:1",
    "required": true
  }]
}
```

素材与记录写在当前工作区的 `.dsh-auto-visual/<会话摘要>/` 下。对外发布网页或 Markdown 时，要把
用到的图片复制到公开资源目录——不能假设隐藏目录会被一起打包。

## 安全与凭据

- 密钥以 Host 侧 `role('secret')` 配置字段保存：Host 向浏览器描述配置时会移除该值，页面只显示
  「已保存 / 尚未保存」。
- **取舍说明：**该值会以明文写入本插件条目的 profile 配置（`cordis.patch.yml`），只是不回传浏览器、
  不进入对话/提示词/日志/元数据。若要求密钥完全不落在 profile 文件中，应改用 DSH 的 credentials
  凭据域（`ctx.remote.credentials` + `@deepseek-ai/dsh-credentials-local`），本插件目前没有采用。
- 供应商错误信息经过脱敏后才向上抛出，不携带响应正文或凭据。

## 持久化与恢复

- 每次工具操作持有工作区级互斥锁，不并行修改记录；图片不可覆盖，记录原子替换。
- 中断的 generating 请求恢复为 uncertain，不自动重试。
- 插件不抢占遗留锁。遇到锁冲突先确认没有活跃操作，再由操作员清理 `.dsh-auto-visual/.lock`；
  不要在生成过程中删除锁。
- 预算按**拥有素材的 Agent 会话**跨计划累计，不是自然语言里的「任务」边界，也没有跨子 Agent 的
  全局汇总。上级 Agent 不应靠并行委派绕过限制。
- 失败素材同样占用预算，防止无限失败重试。

## 已知限制

1. OpenAI 兼容适配器仅支持同步返回 base64 PNG、`1:1`；不下载返回 URL，参考图与图片编辑未实现。
   具体支持的模型由供应方决定，页面允许填任意模型 ID。
2. 不重写 PPT/Word/网页编辑器，也不保证任意主模型都会主动触发配图。
3. PNG 校验只覆盖非隔行、8-bit 灰度/RGB/灰度 Alpha/RGBA 子集、最长边 4096，不支持所有合法 PNG。
4. 不提供视觉质量判定，也不提供通用 PPTX/DOCX 嵌入结构检查。
5. 工作区内文件按可信协作场景处理；同权限下的恶意并发改名不在防护范围内，外层效果由 DSH
   sandbox 负责。
6. 不会用 Mock 图片充当用户要求的真实图片交付。

## 扩展新的图片供应方

若目标服务不兼容 OpenAI Images 协议，请提供 API 文档、鉴权方式、尺寸与格式支持、同步或异步
返回、限流与费用、幂等/查询/取消能力。核心导出 `ImageProvider` 接口：实现 `validate` 与
`generate` 即可接入，供应方凭据同样只在 Host 进程内使用，不进入对话、提示词、元数据或日志，也
不向图片下载域名转发生成凭据。

## 开发

```sh
npm run check     # 构建 + 全部测试 + 客户端契约检查（dist/ 不入库，构建由 prepare 负责）
```

构建使用 Node 内置 TypeScript 语法剥离，**不是静态类型检查**。测试用真实 DSH 的 defineTool、
Typert Gateway、设置服务与 profile/bundle 加载路径校验契约，另有一份不依赖浏览器的客户端契约
harness。实现细节、打包契约与投稿说明见 `docs/IMPLEMENTATION.md`，测试覆盖与未验证项见
`docs/TESTING.md`。

## 许可证

[MIT](LICENSE)
