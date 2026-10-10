# 验收记录与后续测试

## 自动测试覆盖

- 核心：真实可解码 MOCK TEST PNG；跨计划预算；生成结果复用与 hash；取消；供应商错误脱敏；非法图片；非法 ID/输入；suggest/off；中断恢复；无隐式 mock；提示词最小化；损坏元数据；写入失败不泄漏内存状态。
- 插件：使用安装版本的真实 defineTool 校验三项工具注册及 output；off 模式；无 Agent 拒绝。
- 存储：受控子进程写入；原子替换/图片不覆盖；权限与缺失/partial 沙箱拒绝；同世界要求；锁冲突与异常释放；路径穿越、符号链接；token 所有权；取消；错误脱敏。
- 客户端半（`test/client-harness.mjs`）：在 Node 里模拟模块加载器、DSH 原生设置表单模型与
  `configForms`，断言：模块 id 与 `inject` 导出正确；`settings.section` 以 id `auto-visual`
  注册一次；面板使用原生 `SettingsForm` + 六个 `SettingsValueField`；输入只产生草稿、不提前写入；
  点击保存后通过带 revision 的原子 `mutate` 写入；保存后的值和只读状态正确反映。

- 模型：计划持久化模型 ID；切换模型拒绝旧计划请求；配置值进入 provider 和 OpenAI 兼容请求；缺失密钥/不支持比例在请求前拒绝。测试不访问真实接口。

执行：`npm run check`（含上述全部）。构建使用语法剥离，不替代静态类型检查。测试使用沙箱服务替身
检查契约及 worker 行为，未声称验证当前生产沙箱的内核隔离；client 契约测试不代表已在真实浏览器中目视确认。

## 尚未完成/不能据此声称完成

- 真实图片模型与 Key 的鉴权、生成、费用及失败恢复。
- **在运行中的 Web profile 实际安装并目视确认设置页**：已通过
  `dsh plugin --profile web add /root/projects/plugin` 安装，并由 `dsh --profile web --dump-config`
  确认最终配置含 `auto-visual`。现有 GUI 受浏览器会话鉴权保护，尚未完成目视点击验收；
  刷新现有页面后应验证设置页出现和可写。
- 安装到当前运行中的 Web profile 后的真实模型自动触发。
- 真实 PPTX/DOCX 图片嵌入、网页浏览器渲染及视觉质量验收。
- 多平台/远程文件系统兼容性。
- `npm pack --dry-run --ignore-scripts` 尝试被沙箱拒绝：npm 要写工作区外的默认缓存目录，返回 EROFS/exit 226。没有绕过或提权重试，因此不把打包检查列为通过。

## 有模型后的三场景验收

1. PPT：制作包含原创插画的演示；真实出图；核查实际嵌入、裁切、可读性与页码。
2. 网站：生成 logo 符号或 hero，文字使用真实字体；核查资源请求、相对路径、响应式布局。
3. 文档：插图放在对应段落；添加说明；核查嵌入资源和渲染。

每个场景记录是否自动触发、调用参数、真实图片路径、成果位置、结构验证、渲染验证和未验证项。不能将 visual_finalize 的存在性检查当作嵌入证明。
