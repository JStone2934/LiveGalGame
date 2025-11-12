技术架构（Electron Win/mac）

总体分层
- 应用壳（Electron）
  - Main 进程：窗口与菜单管理、托盘、协议拦截、系统权限与设备枚举、快捷键注册、持久化层、更新与崩溃上报、后台任务调度。
  - Renderer 渲染器：主窗体（仪表盘/存档/复盘）、HUD 浮窗、设置页、模型配置页。
  - Preload：安全桥接（contextIsolation），暴露受控 API（音频设备列表、录制控制、模型推理调用、DB 访问）。
- 实时能力
  - 音频采集层：麦克风（getUserMedia）与系统音频（desktopCapturer/屏幕共享音轨/虚拟声卡），统一为标准 MediaStream。
  - 转写 ASR：可插拔（本地 Whisper/WebRTC-ASR、远端流式 ASR）。通过 WebWorker/Node Worker Threads 进行推理或数据编解码。
  - 语义分析与建议生成：LLM 推理（流式），意图分类、策略模板填充、效果预测打分。
- 业务域
  - 人物与对话：存档、会话片段、事件（建议卡触发/采纳/得分）。
  - 评分与可视化：好感度曲线、事件时间轴。
- 存储
  - SQLite（better-sqlite3）作为本地嵌入式数据库；附件（音频片段、报表导出）走应用数据目录。
  - 可选云同步：基于用户账户登录的增量上传（非 MVP）。
- UI 技术
  - 前端：React + Vite（或 Next.js in SPA 模式），Tailwind/UNO CSS；可复用移动端设计语言但为桌面优化尺寸与布局。

关键模块与边界
- WindowManager（Main）
  - 创建/销毁主窗体与 HUD；控制置顶、鼠标穿透、圆角与阴影。
  - 托盘菜单：开始/停止对话、快速切换人物、静音/监听状态。
- AudioController（Renderer + Preload 桥接）
  - 枚举设备；启动/停止录制；回调分发（VAD 边界、RMS 音量、丢包）。
  - Windows：desktopCapturer 选择“全部屏幕 + 系统音频”；macOS：要求屏幕录制权限后获取系统音轨。
- AsrService
  - 输入：双通道音频帧（mic/system）；输出：带时间戳的转写段落。
  - 可配置：本地 vs 远端；采样率、分段策略、语言。
- NlpService / LlmService
  - LLM 供应商插件：OpenAI、Anthropic、本地 Oobabooga（HTTP 推理接口）。
  - 统一流式接口（SSE/WebSocket/HTTP chunked）与重试/超时/速率限制。
- SuggestionEngine
  - 触发条件：意图分类、关键词、对话上下文变化。
  - 输出卡片：标题、文案、标签、效果预测分值、追问建议。
- FeedbackEngine
  - 评分规则：基于用户采纳与对话后续反馈；为 HUD 播放动画提供数值与文案。
- DataLayer（SQLite）
  - 表：person、conversation、turn、event、score、model_profile、settings（详见 data-model.md）。
  - 统一事务与迁移；预编译语句；导入/导出。

安全与隔离
- 启用 contextIsolation、关闭 nodeIntegration；仅通过 preload 暴露白名单 API。
- CSP 与内容来源白名单；敏感配置（API Key）加密存储（OS Keychain/DPAPI）。
- 自动更新与签名校验（electron-updater + code sign）。

性能与稳定性
- 音频与 ASR 在独立线程/进程执行，避免阻塞 UI。
- 流水线背压：ASR 输出分段驱动 LLM；超时与丢包处理。
- 日志分级：主进程/渲染器/服务各自记录并汇聚（可选 Sentry）。

可扩展性
- Provider 插件：新增 LLM/ASR 仅需实现统一接口。
- 建议卡模板：以 JSON/Prompt 模板化，可热更新。


