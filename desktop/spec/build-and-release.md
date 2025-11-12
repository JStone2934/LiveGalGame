构建、签名与发布（Windows/macOS）

工具链
- electron-builder 24+（建议）或 electron-forge。本文以 electron-builder 为例。
- Node.js 20+，pnpm。

目录与脚本（建议）
- package.json
  - "dev": 同时启动 main 与 renderer，启用热重载
  - "build:win": electron-builder --win nsis
  - "build:mac": electron-builder --mac dmg

electron-builder 配置要点
- appId: com.livegalgame.desktop
- asar: true
- files: dist/**, build/**
- extraResources: 语音/模型/词典（如有）
- mac:
  - category: public.app-category.productivity
  - hardenedRuntime: true
  - entitlements: build/mac/entitlements.plist
  - entitlementsInherit: build/mac/entitlements.plist
  - gatekeeperAssess: false
  - notarize: 使用 Apple ID/Keychain（CI 中配置 APPLE_ID 等）
- win:
  - target: nsis
  - publisherName: 组织/公司名称
  - signingHashAlgorithms: ["sha256"]
  - rfc3161TimeStampServer: http://timestamp.digicert.com

权限与 Entitlements（macOS）
- 需要：麦克风（com.apple.security.device.audio-input）
- 屏幕录制：不在 Entitlements 配置，而在系统“隐私与安全性”里由应用触发时请求
- 可选：辅助功能（用于全局快捷键/前台检测，通常不必）

CI/CD（建议）
- GitHub Actions / GitLab CI：
  - 矩阵构建：macos-latest + windows-latest
  - 缓存 node_modules；签名证书和 Apple Notarization 凭据用 Secrets
  - 工件：.dmg、.exe（或 .msi）、RELEASES
- 自动更新：electron-updater + 静态文件托管（GitHub Releases/自建 CDN）

验证清单（出厂前）
- 安装成功；首次启动权限请求文案正确；音频测试可用。
- HUD 能置顶且不抢焦点；Win/mac 均可捕获系统音频（或提供降级指引）。
- 签名有效；macOS 可通过 Gatekeeper；可完成 Notarization。

网络与加速
- 下载外部资源（ASR/LLM 相关权重/词典）时，支持代理与断点续传。可建议用户运行 `dl1` 以加速，并使用多进程/分片并发。


