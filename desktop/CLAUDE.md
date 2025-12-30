# Repository Guidelines
For vibe-coding models
## Project Structure & Module Organization
Electron 主进程：src/main.js 负责 .env 手动加载、文件日志、ASR 缓存/密钥注入、初始化窗口/IPC/快捷键/权限/ASR 预加载器，并在启动链路中逐步计时。
Core 层：src/core/modules/ 下大量 IPC handler（配置、ASR 音频、LLM、媒体、memory、review、telemetry、window），加上 window-manager、shortcut-manager、permission-manager、review-service 等服务。
ASR 前后端：
JS 侧：src/asr/ 包含 model-manager.js（缓存/下载/探测）、asr-service.js（启动/管理后端子进程与健康检查）、model-cache.js、audio-utils.js 等。
Python 侧：backend/main.py 提供 FastAPI + WebSocket bridge；backend/asr/asr_funasr_worker.py、asr_siliconflow_worker.py、asr_baidu_worker.py 分别处理不同引擎。
辅助脚本：scripts/download_funasr_model.py 用于模型预下载。
Renderer（React）：src/renderer/pages/ASRSettings.jsx 等页面承载大量状态与事件监听；components/Audio/*、hooks/useAudio*、HUD 相关组件在 renderer/ 内。
其他：memory-service/ 是独立 FastAPI 微服务；db/ 提供 SQLite schema 与模块化 DAO。

## Build, Test, and Development Commands
- `pnpm install` installs dependencies and runs `postinstall` (rebuilds `better-sqlite3`).
- `pnpm dev` starts the full desktop dev flow (Electron + Vite).
- `pnpm run prepare:python` prepares the local ASR Python environment (`PREPARE_PYTHON_MODE=bundle` for portable builds).
- `pnpm run build` runs prebuild + Vite build + Electron Builder packaging.
- `pnpm run build:mac` / `pnpm run build:win` build platform-specific installers.
- `pnpm run preview` serves the built renderer for inspection.

## Coding Style & Naming Conventions
- JavaScript/TypeScript uses ESM imports, semicolons, and 2-space indentation; follow existing file style.
- React components are PascalCase (`CharacterModal.jsx`), utilities/modules are kebab or camel case (`asr-cache-env.js`).
- Keep Electron main/preload logic in `src/` and avoid mixing UI concerns into main process modules.

## Testing Guidelines
- Automated tests are mostly script-driven: `pnpm run test:asr`, `pnpm run test:settings-logs`, `pnpm run test:audio`.
- Additional utilities live in `scripts/test-*.{js,py}`; run them directly when validating audio/ASR flows.
- Name new tests with clear `test-` prefixes and document any required hardware or model downloads.

## Commit & Pull Request Guidelines
- Commit messages generally follow Conventional Commits (`feat(scope):`, `fix(scope):`, `refactor(scope):`). Use a short, scoped summary.
- Git history shows these common types/scopes: `feat`, `fix`, `refactor`, `chore`, `security` with scopes like `main`, `ci`, `python-env`, `asr`, `ui`, `docs`, `review`, `prompt`, `tests`.
- Messages may be bilingual (English/中文); keep them concise and consistent with existing history.
- PRs should describe user-facing behavior changes, note platform impact (macOS/Windows), and include screenshots/GIFs for UI updates.
- If the change touches ASR or model caches, mention any new env vars or migration steps.

## Configuration & Security Notes
- Local ASR caches can be redirected via `ASR_CACHE_BASE`; keep sensitive paths out of logs.
- Avoid widening IPC surface area without validation (see `src/core/modules/`).
