# LiveGalGame Web 端部署说明（云端 ASR + LLM）

> 本文面向 `web-migration` 分支：Web 端使用**云端 ASR** 和 **LLM API**，实现完整的语音对话 + 回复建议功能。

## 1. 架构概览

```
Browser (React)
  │
  ├─ WebSocket ──→ /ws/transcribe (ASR 语音识别)
  │
  └─ HTTP ──→ /api/llm/suggestions (LLM 回复建议)
              /api/llm/status (LLM 状态检查)
              /api/affinity/calculate (好感度计算)
  │
FastAPI Backend
  │
  ├─→ SiliconFlow / Baidu ASR API
  └─→ OpenAI-compatible LLM API
```

**核心特性：**
- 前端：Vite + React（静态资源）
- ASR 后端：FastAPI + WebSocket（转发到云端 ASR 服务）
- LLM 后端：FastAPI + HTTP（调用 OpenAI 兼容 API）
- 数据存储：浏览器 localStorage（前端本地）

## 2. 关键功能说明

| 功能 | 状态 | 说明 |
|------|------|------|
| 语音识别 (ASR) | ✅ | 云端 SiliconFlow/Baidu |
| 角色/对话管理 | ✅ | localStorage 适配 |
| LLM 回复建议 | ✅ | 后端 API 调用 LLM |
| 好感度计算 | ✅ | 基于建议选择自动更新 |
| 对话复盘 | ⏳ | 待实现 |
| 用户数据同步 | ⏳ | 待实现（需数据库） |

## 3. 后端部署

### 3.1 环境变量（完整配置）

```bash
# === ASR 配置 ===
ASR_ENGINE=siliconflow           # 或 baidu
ASR_MODEL=siliconflow-cloud      # 或 baidu-cloud
ASR_HOST=0.0.0.0
ASR_PORT=8000
ASR_CORS_ORIGINS=https://your-web-domain.com

# SiliconFlow ASR
SILICONFLOW_API_KEY=YOUR_SILICONFLOW_KEY

# Baidu ASR（如使用 baidu 引擎）
BAIDU_APP_ID=...
BAIDU_API_KEY=...
BAIDU_SECRET_KEY=...

# === LLM 配置 ===
LLM_API_KEY=sk-xxx              # OpenAI 或兼容 API 的密钥
LLM_BASE_URL=https://api.openai.com/v1  # 或其他兼容端点
LLM_MODEL=gpt-4o-mini           # 推荐低成本模型
LLM_TIMEOUT_MS=30000            # 超时时间（毫秒）

# === 静态文件托管（可选）===
WEB_STATIC_DIR=dist/renderer    # 让后端同时提供前端
```

**常用 LLM 配置示例：**

```bash
# OpenAI
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# DeepSeek
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# 国内中转
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.your-proxy.com/v1
LLM_MODEL=gpt-4o-mini
```

### 3.2 启动后端

```bash
cd desktop/backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 3.3 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | ASR 健康检查 |
| `/api/llm/status` | GET | LLM 服务状态 |
| `/api/llm/suggestions` | POST | 生成回复建议 |
| `/api/affinity/calculate` | POST | 计算好感度变化 |
| `/ws/transcribe` | WebSocket | ASR 实时语音识别 |

**示例：检查 LLM 状态**
```bash
curl http://localhost:8000/api/llm/status
# {"ready": true, "model": "gpt-4o-mini", "message": "LLM 服务已就绪"}
```

**示例：生成建议**
```bash
curl -X POST http://localhost:8000/api/llm/suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "character": {"name": "小明", "affinity": 50},
    "messages": [
      {"sender": "character", "content": "今天天气真好啊", "timestamp": 1706600000000}
    ],
    "count": 3
  }'
```

### 3.4 一键部署（后端 + 前端）

```bash
# 1. 构建前端
cd desktop
pnpm run build:vite

# 2. 启动后端并托管前端
cd backend
WEB_STATIC_DIR=../dist/renderer python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

访问 `http://<host>:8000/` 即可使用完整 Web 端。

## 4. 前端配置

### 4.1 环境变量

```bash
# .env.production
VITE_ASR_BASE_URL=https://api.your-domain.com
# 或分别指定：
# VITE_ASR_WS_URL=wss://api.your-domain.com
# VITE_ASR_HTTP_URL=https://api.your-domain.com
```

如未设置，默认使用当前页面的 `window.location.origin`。

### 4.2 构建

```bash
pnpm run build:vite
# 产物输出到 dist/renderer/
```

### 4.3 本地开发

```bash
pnpm run dev:vite
```

## 5. Nginx 配置（推荐）

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    root /var/www/livegalgame/dist/renderer;
    index index.html;

    # 前端 SPA
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ASR WebSocket
    location /ws/transcribe {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

## 6. 当前限制

- **数据仅存储在浏览器 localStorage**，刷新保留但跨设备不同步
- **对话复盘功能**待实现
- **录音回放/音频管理**Web 端不支持
- **用户认证**未实现（所有用户共享后端资源）

## 7. 推荐上线流程

1. 配置环境变量（ASR + LLM API Key）
2. 构建前端：`pnpm run build:vite`
3. 启动后端：`uvicorn main:app --host 0.0.0.0 --port 8000`
4. 配置 Nginx 反向代理 + HTTPS
5. 测试：
   - 打开网页，检查 ASR 状态
   - 创建角色，开始对话
   - 测试语音识别
   - 测试 LLM 建议生成

## 8. 故障排查

**ASR 不工作**
```bash
curl http://localhost:8000/health
# 检查 SILICONFLOW_API_KEY 是否配置
```

**LLM 建议失败**
```bash
curl http://localhost:8000/api/llm/status
# 检查 LLM_API_KEY 是否配置
```

**WebSocket 连接失败**
- 检查 Nginx WebSocket 代理配置
- 确保使用 `wss://` (HTTPS) 或 `ws://` (HTTP)

**CORS 错误**
- 检查 `ASR_CORS_ORIGINS` 是否包含前端域名
