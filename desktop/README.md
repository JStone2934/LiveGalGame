LiveGalGame Desktop - 开发总览

概述
LiveGalGame Desktop 是基于 Electron 的跨平台桌面应用（Windows/macOS）。它将移动端原型的“准备 → 实时辅助 → 复盘学习”核心用户旅程重构为桌面体验：与任意线上聊天工具（微信、QQ、Telegram、Discord、Zoom/Teams 等）并行工作，通过浮动 HUD 提供实时转录、AI 建议与即时反馈动画，并在主窗体中完成对话归档与复盘分析。

关键差异（桌面版相对移动端）
- 无摄像头相关能力与权限请求；仅麦克风与系统音频捕获。
- 面向“线上聊天”的并行辅助：以半透明浮窗（HUD）叠加在任意聊天应用之上，不干扰当前窗口焦点。
- 系统音频采集：Windows 通过 WASAPI Loopback（Electron desktopCapturer）；macOS 通过屏幕共享音轨或虚拟声卡方案（详见 spec/audio-capture-tech-note.md）。
- 权限与安全模型按桌面系统规范（麦克风、屏幕录制/系统音频、辅助功能/可选的快捷键监听）。

仓库结构（文档）
- spec/prd-desktop.md 桌面版 PRD（以核心用户旅程为主线）
- spec/tech-architecture.md 技术架构与模块边界
- spec/audio-capture-tech-note.md 系统音频与麦克风采集技术方案
- spec/llm-integration.md LLM/语音模型集成与配置体验
- spec/hud-ux.md HUD 浮窗交互与状态机
- spec/data-model.md 数据模型与存储
- spec/build-and-release.md 构建、签名与发布（Win/mac）
- spec/privacy-and-permissions.md 隐私、权限与安全
- spec/test-plan.md 测试计划与验收标准

本地开发（概览）
1) Node.js 20+，pnpm 8+（建议）
2) 克隆仓库并安装依赖：`pnpm install`
3) 开发启动：`pnpm dev`（主进程 + 渲染器热重载）
4) 打包：`pnpm build:win` / `pnpm build:mac`（详见 spec/build-and-release.md）

## 快速启动命令

### 安装依赖
```bash
cd /Users/cccmmmdd/LiveGalGame/desktop
pnpm install
```

### 开发模式启动
```bash
pnpm dev
```
启动后，Electron 窗口会自动打开，默认显示主界面。开发模式下会自动打开开发者工具。

### 页面导航
- **总览**: 显示统计数据和最近对话
- **攻略对象**: 管理所有攻略对象（即将推出）
- **对话编辑器**: 编辑对话内容（即将推出）
- **LLM 配置**: 配置 AI 模型（即将推出）
- **设置**: 应用设置（即将推出）

### 快捷键
- **Ctrl+R** (Windows/Linux) 或 **Cmd+R** (macOS): 刷新窗口
- **Ctrl+Shift+I** (Windows/Linux) 或 **Cmd+Shift+I** (macOS): 打开/关闭开发者工具
- **ESC**: 预留快捷键（后续用于 HUD 最小化）

### 功能测试步骤
1. **页面导航**: 点击左侧导航菜单（总览/攻略对象/对话编辑器等），查看页面切换
   - 点击"对话编辑器"导航菜单，应该跳转到对话编辑器页面
   - 点击"返回总览"按钮，应该回到总览页
2. **统计数据**: 查看总览页的4个统计卡片（攻略对象/对话/分支/故事标记）
3. **最近对话**: 查看对话卡片列表，悬停显示编辑按钮
4. **创建对话**: 点击"新对话"按钮或"创建新对话"卡片，应该跳转到对话编辑器
5. **实时助手**: 点击"实时助手"按钮（后续将打开HUD浮窗）

页面跳转已实现：
- 总览页 → 对话编辑器：左侧导航菜单或"创建新对话"卡片
- 对话编辑器 → 总览页：左侧"返回总览"按钮

### 生产环境构建
```bash
# Windows 安装包
pnpm build:win

# macOS 安装包
pnpm build:mac

# 或通用构建
pnpm build
```

构建输出在 `dist/` 目录下。

网络与下载加速（可选）
- 若需要下载外部依赖（如语音/ASR 模型或静态资源），可先执行本地代理命令 `dl1` 来启用代理以加速；大文件下载建议采用多进程/分片并发方式（实现细节在后续实现阶段落地）。

最低系统要求
- Windows 10 19045+（x64/arm64 可选）、macOS 12+（Intel/Apple Silicon）
- 麦克风可用；若需捕获系统音频：Windows 无需额外驱动，macOS 需屏幕录制权限或使用虚拟声卡

## 开发进度

### 已完成阶段
- **阶段 0**: 基础项目搭建 ✅
  - Electron 项目初始化
  - 基础文件结构创建
  - 开发环境配置

- **阶段 1**: 主窗口UI框架 ✅
  - 窗口配置和快捷键
  - 三栏布局（对话列表/对话详情/AI分析）
  - 对话列表组件（支持切换）
  - 对话详情组件（消息气泡）
  - AI分析面板（动态洞察、标签管理）

### 下一步计划
- **阶段 1.6**: ✅ 已完成 - 将对话编辑器独立为单独页面 `conversation-editor.html`
- **阶段 2**: HUD浮窗基础（进行中）
- **阶段 3**: 音频采集与权限
- **阶段 4**: Mock语音识别和LLM集成
- **阶段 5**: 即时反馈系统（好感度动画）

完整开发计划详见：`/Users/cccmmmdd/LiveGalGame/desktop/DEVELOPMENT_PLAN.md`

## 版权与许可
根据企业内部策略补充。默认保留所有权利。


