# Repository Guidelines
For vibe-coding models
## Project Structure & Module Organization
- `src/main.js` is the Electron main process entry; preload lives in `src/preload.js` and core modules in `src/core/`.
- Renderer UI is React under `src/renderer/` (pages, components, styles).
- ASR and audio tooling live in `src/asr/` and `src/native/` (native system audio capture).
- Python-related assets and backends live in `python-env/`, `python-bootstrap/`, and `backend/`.
- Build outputs go to `dist/` (renderer) and `release/` (packaged apps).
- Helper scripts are in `scripts/` (dev, build, model download, test utilities).

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
