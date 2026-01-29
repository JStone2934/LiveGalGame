# LiveGalGame Web 端部署说明（云端 ASR）

> 本文面向 `web-migration` 分支：Web 端仅使用**云端 ASR**（不再使用本地 FunASR）。

## 1. 架构概览

- 前端：Vite + React（静态资源）
- ASR 后端：FastAPI + WebSocket（转发到云端 ASR 服务）
- 数据存储（当前版本）：浏览器 localStorage（仅前端本地）

```
Browser (React)
  |  WebSocket (wss://.../ws/transcribe?session_id=...)
  v
FastAPI ASR Bridge
  |  Cloud ASR
  v
SiliconFlow / Baidu
```

## 2. 关键改动说明

- ASR 默认引擎已切换为云端：`siliconflow`（可改为 `baidu`）。
- 前端不再依赖 Electron IPC：通过 `window.electronAPI` 的 Web 适配层调用。
- ASR 模型管理仅保留云端预设，FunASR 本地模型下载已禁用。
- 对话/角色/设置等数据暂存于浏览器 localStorage（非服务器持久化）。

## 3. 后端部署（ASR Bridge）

### 3.1 环境变量

```
ASR_ENGINE=siliconflow           # 或 baidu
ASR_MODEL=siliconflow-cloud      # 或 baidu-cloud
ASR_HOST=0.0.0.0
ASR_PORT=8000
ASR_CORS_ORIGINS=https://your-web-domain.com

# SiliconFlow
SILICONFLOW_API_KEY=YOUR_KEY
# 可选：SILICONFLOW_MODEL=TeleAI/TeleSpeechASR

# Baidu（使用 baidu 时需要）
BAIDU_APP_ID=...
BAIDU_API_KEY=...
BAIDU_SECRET_KEY=...
```

`ASR_CORS_ORIGINS` 支持逗号分隔多个域名；设置为 `*` 表示全部允许（生产不推荐）。

### 3.2 启动方式

推荐使用 uvicorn：

```
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

健康检查：

```
GET http://<host>:8000/health
```

WebSocket：

```
ws://<host>:8000/ws/transcribe?session_id=speaker1
```

## 4. 前端构建与配置

### 4.1 环境变量（前端）

通过 Vite 环境变量指定 ASR 地址：

```
VITE_ASR_BASE_URL=https://asr.example.com
# 或分别指定：
# VITE_ASR_WS_URL=wss://asr.example.com
# VITE_ASR_HTTP_URL=https://asr.example.com
```

如果未设置，默认使用当前页面的 `window.location.origin`。

### 4.2 构建

```
pnpm run build:vite
```

产物输出到：`dist/renderer/`

### 4.3 开发

```
pnpm run dev:vite
```

## 5. Nginx 参考配置（静态 + WS 代理）

```nginx
server {
    listen 80;
    server_name your-web-domain.com;

    root /var/www/livegalgame/dist/renderer;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # WebSocket ASR
    location /ws/transcribe {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # (可选) 直连 /health 或 /transcribe
    location /health {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

生产建议启用 HTTPS 并使用 `wss://`。

## 6. 当前限制（已知）

- **数据存储仅在浏览器 localStorage**，刷新/跨设备不会同步。
- **建议/复盘/LLM 功能为占位**（未接入服务端 API）。
- **录音回放/音频文件管理未启用**（Web 端不支持本地文件管理）。

如需完整线上体验，请增加后端业务 API（数据库、LLM、回放等），并将 `web-api` 适配层替换为真实请求。

## 7. 推荐上线流程

1) 部署 ASR Bridge（FastAPI + 云端 ASR）
2) 配置 Nginx 反向代理与 HTTPS
3) 构建前端并部署静态文件
4) 设置 `VITE_ASR_BASE_URL` 指向 ASR 服务域名
5) 浏览器打开 Web 端，测试麦克风与识别

