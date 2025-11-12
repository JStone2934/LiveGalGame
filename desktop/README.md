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

网络与下载加速（可选）
- 若需要下载外部依赖（如语音/ASR 模型或静态资源），可先执行本地代理命令 `dl1` 来启用代理以加速；大文件下载建议采用多进程/分片并发方式（实现细节在后续实现阶段落地）。

最低系统要求
- Windows 10 19045+（x64/arm64 可选）、macOS 12+（Intel/Apple Silicon）
- 麦克风可用；若需捕获系统音频：Windows 无需额外驱动，macOS 需屏幕录制权限或使用虚拟声卡

版权与许可
根据企业内部策略补充。默认保留所有权利。 


