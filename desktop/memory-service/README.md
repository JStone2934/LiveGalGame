# Structured Memory Service (Sidecar)

面向 LiveGalGame 的轻量级画像 / 事件侧车服务，结构化存储、无默认向量召回，供桌面端通过 `MEMORY_API_BASE_URL` 访问，遵从 Model First 原则。

## 功能
- `GET /profiles`：按 user/project/topic/sub_topic/tag/time 过滤画像
- `POST /profiles`：新增/更新/追加画像（mode: add|update|append|replace）
- `GET /events`：按 user/project/tag/time 查询事件
- `POST /events`：写入事件（含 profile_delta）
- `GET /health`：健康检查

## 目录
- `pyproject.toml`**：依赖由 uv 管理**
- `main.py`：入口，启动 uvicorn 加载 app
- `app/`：模块化代码
  - `db.py`：引擎 & session
  - `models.py`：SQLModel 定义（Profile/Event）
  - `schemas.py`：Pydantic I/O 模型
  - `crud/`：业务操作拆分
  - `routes/`：FastAPI 路由
  - `__init__.py`：create_app 注册路由

## 快速启动（使用 uv）
```bash
cd desktop/memory-service
uv venv
source .venv/bin/activate  # Windows: .\.venv\Scripts\activate
uv sync
uv run main.py  # 默认 0.0.0.0:8000
```

可通过环境变量调整：
- `PORT`：端口，默认 8000
- `MEMORY_DB_PATH`：SQLite 路径，默认 ./memory.db

## 与桌面端联调
1) 启动本服务：`uv run main.py`
2) 启动 Electron 应用前设置：`export MEMORY_API_BASE_URL=http://127.0.0.1:8000/`
3) 渲染层可调用：
   - `window.electronAPI.memoryQueryProfiles({ userId, projectId, topic, sub_topic, tag, time_from, time_to, limit })`
   - `window.electronAPI.memoryQueryEvents({ userId, projectId, tag, time_from, time_to, limit })`

## 发行版建议（自动配置最佳实践）
首选方案：将 Memory Service 打成独立可执行文件并随 Electron 分发，启动时自动托管，用户无需安装 Python。

推荐步骤：
1. 使用 PyInstaller 生成单文件可执行（示例）：
   ```bash
   cd desktop/memory-service
   uv venv && source .venv/bin/activate
   uv sync
   pyinstaller --onefile --name memory-service main.py
   ```
   产物位于 `dist/memory-service`（macOS arm64 约 20–40 MB）。

2. 在 Electron 主进程启动时：
   - 检测 `resources/memory-service/memory-service` 是否存在；若无则解压/复制。
   - 选取空闲端口（如 18000+随机），`spawn` 可执行并设置 `MEMORY_API_BASE_URL=http://127.0.0.1:<port>/` 后再创建窗口。
   - 调用 `/health` 探活，进程退出时清理。

3. macOS 发布需 codesign/notarize；未签名时用户需“右键打开”绕过 Gatekeeper。

4. 开发者仍可用 uv 启动，保持兼容。

## 设计要点
- 结构化过滤为主，不依赖向量检索；需要向量召回时可另行扩展。
- 简单 SQLite 持久化，便于本地开发；如需多实例或持久化升级，可替换为 Postgres，修改 `create_engine` 连接串即可。
- 默认 80% 逻辑交给模型：侧车只提供 CRUD 与过滤，不做复杂合并；合并策略留给上层模型或额外的 profile_merger 服务。

## 开发/测试便捷命令（可选）
```bash
# 本地运行
uv run main.py

# 调试请求
curl 'http://127.0.0.1:8000/health'
```
