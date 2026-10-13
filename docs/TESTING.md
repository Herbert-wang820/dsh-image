# 测试覆盖与验收状态

执行方式：`npm run check`（构建 + 全部测试 + 客户端契约检查）。构建只是语法剥离，不替代静态类型
检查；测试里的 sandbox 替身只用于受控 worker 行为，不代表已验证当前生产沙箱的内核隔离。

## 自动测试覆盖

- **核心**（`test/core.test.ts`）：真实可解码的 MOCK TEST PNG；跨计划预算；结果复用与 hash；
  取消；供应方错误脱敏；非法图片输出；非法 ID/输入；suggest/off 语义；中断恢复为 uncertain；
  无隐式 mock；提示词最小化；损坏元数据；写入失败不泄漏内存状态。
- **插件**（`test/plugin.test.ts`）：用安装版本的真实 defineTool 校验三个工具的注册与 output；
  `off` 模式不注册；无 Agent 上下文拒绝执行；volatile 配置改动被后续工具执行读到。
- **存储**（`test/storage.test.ts`）：受控子进程写入与原子替换；图片不可覆盖；policy、缺失/partial
  沙箱、非同世界一律拒绝；锁冲突与异常释放；路径穿越、绝对路径、符号链接拒绝；token 所有权；
  取消后仍释放锁；错误脱敏。
- **供应方**（`test/provider.test.ts`、`test/connection.test.ts`）：配置的模型 ID 进入实际请求；
  密钥不进日志；非法端点、缺失密钥、不支持比例在请求前拒绝；连接检查按 401/404/429 等分类，且
  **不发送生成请求**。
- **Host 侧真实 Gateway**（`test/gateway.test.ts`）：挂载安装版本的真实 Typert registry 与
  `@deepseek-ai/dsh-api-gateway`，通过公开 API 调用 `autoVisualConnection/checkConnection`，
  走的是 SRC marker 发现路径而非伪造描述符。
- **真实设置服务**（`test/settings.test.ts`）：真实 boot + Include + `dsh-settings` +
  `dsh-config-editor`，在临时 workspace 里验证落盘、回读、revision 递增、stale revision 拒绝、
  校验失败不改动磁盘与运行值，以及 `role('secret')` 字段在 `describe` 中被脱敏。
- **浏览器侧**（`test/client-remote.test.ts`）：用真实的浏览器 Typert registry、真实的
  `@deepseek-ai/dsh-api-gateway` 客户端 bundle、真实 Cordis fiber 加载本插件的 `dist/client.js`，
  证明设置面板拿到的命名空间可以真正发起 RPC；`test/remote-resolution.test.ts` 固定了它依赖的
  Cordis 可见性规则。
- **客户端契约**（`test/client-harness.mjs`）：在 Node 里模拟模块加载器与最小 hooks 运行时，
  断言模块 id 与 `inject` 导出、`settings.section` 以 id `auto-visual` 注册一次、面板使用原生
  `SettingsForm` + 五个 `SettingsValueField` + 一个 `SettingsSecretField`、编辑只产生草稿、保存
  走带 revision 的原子 `mutate`、密钥徽标与连接检查三种结果分支，以及只读状态。
- **打包契约**（`test/package-manifest.test.ts`）：真实 `loadProfileDirectory` + boot 走完
  `dsh.bundle` → `cordis.patch.yml` → 包解析 → 插件加载，并校验 `dsh.client.inject` 的每个条目
  确实是客户端包。
- **投稿条目**（`test/submission-entry.test.ts`）：条目文件名、`url`/`name` 一致性、分类取值、
  描述格式与列表拒绝的字段。
- **仓库卫生**（`test/repo-hygiene.test.ts`）：扫描全部受版本控制的文件，包括把 `.docx` 当作
  压缩包解开后逐部件检查，禁止出现凭据形态的字符串、私钥块、本机绝对路径，以及不在白名单里的
  主机名；示例文档另有一条「不得记录接口地址」的断言。避免把私有网关等写进要公开的产物。

## 已完成的真实链路验证

- **真实生成**：通过设置页配置 OpenAI 兼容供应方后，`visual_plan` → `visual_generate` 产出了
  1024×1024 PNG（`mock: false`，模型 `gpt-image-2`，记录 SHA-256），图片经目视确认与需求一致。
- **文档落地**：该图片被嵌入 `docs/auto-visual-generation-test.docx`，由 `scripts/verify-docx.py`
  做结构校验（zip CRC、各部件 XML 合法、关系与内容类型完整、内嵌字节与源图 SHA-256 相同、
  绘制尺寸与图片宽高比一致），并由 `visual_finalize` 登记使用位置。
- **安装路径**：仓库已推送到 GitHub；`docs/submission/` 下的条目可提交到插件列表。

## 尚未验证，不能据此声称完成

- **Office 渲染**：本环境没有 Word，LibreOffice 在沙箱内无法启动（连纯文本都加载失败），
  所以示例 docx 只有结构层面的证据，没有「打开后排版正确」的验证。
- **真实页面的目视与点击确认**：现有 GUI 受浏览器会话鉴权保护且没有隐式 DOM，设置页只在契约
  层面（真实 bundle + 真实 Cordis）验证过，未在浏览器里目视确认。
- **连接检查的边界**：它只验证鉴权与模型查询，不代表具备生图权限；生图权限只能由一次真实生成
  证明。
- **PPT / 网站场景**：真实素材进入 PPT 与网页后的嵌入、裁切、响应式表现与视觉质量尚未验收。
- **多平台与远程文件系统**：远程执行世界未验证，非同世界时插件选择拒绝而非降级。
- **npm 打包检查**：`npm pack --dry-run --ignore-scripts` 在沙箱内被拒绝（npm 需要写工作区外的
  默认缓存目录，返回 EROFS），没有绕过或提权重试，因此不把该检查列为已通过。

## 三场景验收清单（后续执行时使用）

1. **PPT**：制作含原创插画的演示；真实出图；核查实际嵌入、裁切、可读性与页码。
2. **网站**：生成 logo 符号或 hero，文字使用真实字体；核查资源请求、相对路径、响应式布局。
3. **文档**：插图放在对应段落并加说明；核查嵌入资源与渲染。

每个场景记录是否自动触发、调用参数、真实图片路径、成果位置、结构验证、渲染验证与未验证项。
**`visual_finalize` 的存在性检查不能当作嵌入证明。**
