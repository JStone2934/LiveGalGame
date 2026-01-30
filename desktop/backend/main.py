import asyncio
import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Dict, Optional
from uuid import uuid4
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from starlette.websockets import WebSocketState


# ---------------------------------------------------------------------------
# Environment & paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
MEIPASS_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))
ASSETS_ROOT = MEIPASS_DIR if MEIPASS_DIR.exists() else PROJECT_ROOT
# Worker 脚本在 backend/asr/ 目录下
ASR_DIR = BASE_DIR / "asr"
if not ASR_DIR.exists():
    # 回退到打包环境或其他位置
    ASR_DIR = (ASSETS_ROOT / "asr") if (ASSETS_ROOT / "asr").exists() else (PROJECT_ROOT / "asr")

DEFAULT_ENGINE = os.environ.get("ASR_ENGINE", "siliconflow").lower()
DEFAULT_MODEL = os.environ.get("ASR_MODEL", "siliconflow-cloud")

# 支持的引擎列表
SUPPORTED_ENGINES = {"funasr", "siliconflow", "baidu"}


def _print_debug_info():
    """打印调试信息，帮助排查打包后路径问题"""
    print("=" * 60, file=sys.stderr)
    print("[ASR Backend] DEBUG INFO", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(f"  sys.executable: {sys.executable}", file=sys.stderr)
    print(f"  sys.argv: {sys.argv}", file=sys.stderr)
    print(f"  cwd: {os.getcwd()}", file=sys.stderr)
    print(f"  __file__: {__file__}", file=sys.stderr)
    print(f"  BASE_DIR: {BASE_DIR} (exists={BASE_DIR.exists()})", file=sys.stderr)
    print(f"  PROJECT_ROOT: {PROJECT_ROOT} (exists={PROJECT_ROOT.exists()})", file=sys.stderr)
    print(f"  has _MEIPASS: {hasattr(sys, '_MEIPASS')}", file=sys.stderr)
    if hasattr(sys, "_MEIPASS"):
        print(f"  sys._MEIPASS: {sys._MEIPASS}", file=sys.stderr)
    print(f"  MEIPASS_DIR: {MEIPASS_DIR} (exists={MEIPASS_DIR.exists()})", file=sys.stderr)
    print(f"  ASSETS_ROOT: {ASSETS_ROOT} (exists={ASSETS_ROOT.exists()})", file=sys.stderr)
    print(f"  ASR_DIR: {ASR_DIR} (exists={ASR_DIR.exists()})", file=sys.stderr)
    
    # 列出 ASR_DIR 内容
    if ASR_DIR.exists():
        try:
            files = list(ASR_DIR.iterdir())
            print(f"  ASR_DIR contents: {[f.name for f in files]}", file=sys.stderr)
        except Exception as e:
            print(f"  ASR_DIR list error: {e}", file=sys.stderr)
    
    # 检查 worker 脚本
    for worker_name in ["asr_funasr_worker.py", "asr_siliconflow_worker.py", "asr_worker.py"]:
        worker_path = ASR_DIR / worker_name
        print(f"  {worker_name}: {worker_path} (exists={worker_path.exists()})", file=sys.stderr)
    
    # 关键环境变量
    env_keys = ["ASR_ENGINE", "ASR_MODEL", "ASR_HOST", "ASR_PORT", "ASR_CACHE_DIR", 
                "HF_HOME", "MODELSCOPE_CACHE", "PYTHONPATH"]
    print("  Environment variables:", file=sys.stderr)
    for key in env_keys:
        val = os.environ.get(key, "<not set>")
        print(f"    {key}={val}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    sys.stderr.flush()


# 启动时打印调试信息
_print_debug_info()


def resolve_python_cmd() -> str:
    """解析 Python 命令（仅在非打包环境下使用）"""
    env_py = os.environ.get("ASR_PYTHON_PATH")
    if env_py and Path(env_py).exists():
        return env_py

    # Prefer the current interpreter if available
    if sys.executable and Path(sys.executable).exists():
        return sys.executable

    return "python.exe" if sys.platform.startswith("win") else "python3"


def is_packaged() -> bool:
    """检测是否在 PyInstaller 打包环境中运行"""
    return hasattr(sys, "_MEIPASS")


class WorkerBridge:
    """
    Thin bridge that keeps the existing stdin/stdout workers (asr_worker.py / asr_funasr_worker.py)
    and exposes them over WebSocket via FastAPI.
    """

    def __init__(self, engine: str, model: str):
        self.engine = engine
        self.model = model
        self.process: Optional[asyncio.subprocess.Process] = None
        self.stdout_task: Optional[asyncio.Task] = None
        self.ready_event = asyncio.Event()
        self.ws_clients: Dict[str, WebSocket] = {}
        self.pending_requests: Dict[str, asyncio.Future] = {}

    def _worker_script_path(self, packaged: bool) -> Path:
        """获取 worker 脚本路径（统一使用 Python 解释器启动，而非独立可执行文件）。"""
        # 无论是否打包，都使用 ASR_DIR，因为打包时文件在 _internal/asr/ 目录下
        base_dir = ASR_DIR
        if self.engine == "funasr":
            return base_dir / "asr_funasr_worker.py"
        if self.engine == "siliconflow":
            return base_dir / "asr_siliconflow_worker.py"
        if self.engine == "baidu":
            return base_dir / "asr_baidu_worker.py"
        # Fallback to generic worker
        return base_dir / "asr_worker.py"

    async def start(self):
        if self.process:
            return

        print(f"[WorkerBridge] engine={self.engine}, model={self.model}", file=sys.stderr)
        print(f"[WorkerBridge] is_packaged={is_packaged()}", file=sys.stderr)
        
        packaged = is_packaged()
        worker_path = self._worker_script_path(packaged)
        python_cmd = sys.executable if packaged else resolve_python_cmd()

        print(f"[WorkerBridge] worker_path={worker_path} (exists={worker_path.exists()})", file=sys.stderr)
        print(f"[WorkerBridge] python_cmd={python_cmd}", file=sys.stderr)
        
        env = os.environ.copy()
        
        # 判断是否使用 Large 模型（Large 版本默认不量化）
        is_large_model = "large" in self.model.lower()
        
        env.update(
            {
                "PYTHONUNBUFFERED": "1",
                "ASR_MODEL": self.model,
                "ASR_ENGINE": self.engine,
                # Large 模型默认不使用量化，精度更高
                "ASR_QUANTIZE": "false" if is_large_model else "true",
                # align ModelScope cache with ASR cache to avoid global locks
                "MODELSCOPE_CACHE": os.environ.get("MODELSCOPE_CACHE") or "",
                "MODELSCOPE_CACHE_HOME": os.environ.get("MODELSCOPE_CACHE") or "",
            }
        )

        if not worker_path.exists():
            parent = worker_path.parent
            print(f"[WorkerBridge] ERROR: Worker script not found!", file=sys.stderr)
            print(f"[WorkerBridge] Parent dir: {parent} (exists={parent.exists()})", file=sys.stderr)
            if parent.exists():
                try:
                    files = list(parent.iterdir())
                    print(f"[WorkerBridge] Parent contents: {[f.name for f in files]}", file=sys.stderr)
                except Exception as e:
                    print(f"[WorkerBridge] Cannot list parent: {e}", file=sys.stderr)
            sys.stderr.flush()
            raise FileNotFoundError(f"Worker script not found: {worker_path}")

        print(f"[WorkerBridge] Spawning worker subprocess...", file=sys.stderr)
        sys.stderr.flush()

        self.process = await asyncio.create_subprocess_exec(
            python_cmd,
            str(worker_path),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        print(f"[WorkerBridge] Worker process spawned, pid={self.process.pid}", file=sys.stderr)
        sys.stderr.flush()

        self.stdout_task = asyncio.create_task(self._consume_output())
        asyncio.create_task(self._consume_stderr())

    async def _consume_output(self):
        assert self.process and self.process.stdout
        print(f"[WorkerBridge] _consume_output started, reading worker stdout...", file=sys.stderr)
        sys.stderr.flush()
        async for line in self.process.stdout:
            line = line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                # Not a JSON line, print for debugging
                print(f"[WorkerBridge][stdout] (non-JSON): {line[:200]}", file=sys.stderr)
                sys.stderr.flush()
                continue

            if payload.get("status") == "ready":
                print(f"[WorkerBridge] Received READY signal from worker!", file=sys.stderr)
                sys.stderr.flush()
                self.ready_event.set()
                continue

            request_id = payload.get("request_id")
            session_id = payload.get("session_id")

            # Resolve pending HTTP requests
            if request_id and request_id in self.pending_requests:
                fut = self.pending_requests.pop(request_id)
                if not fut.done():
                    fut.set_result(payload)

            # Fan-out to websocket clients
            if session_id and session_id in self.ws_clients:
                ws = self.ws_clients[session_id]
                try:
                    await ws.send_json(payload)
                except RuntimeError:
                    # websocket already closed
                    pass
        
        # stdout 结束，说明进程已退出
        print(f"[WorkerBridge] Worker stdout closed (process exited)", file=sys.stderr)
        if self.process:
            print(f"[WorkerBridge] Process returncode={self.process.returncode}", file=sys.stderr)
        sys.stderr.flush()

    async def _consume_stderr(self):
        if not self.process or not self.process.stderr:
            return
        async for line in self.process.stderr:
            sys.stderr.write(line.decode("utf-8", errors="ignore"))
            sys.stderr.flush()

    async def ensure_ready(self):
        print(f"[WorkerBridge] ensure_ready() called, starting worker...", file=sys.stderr)
        sys.stderr.flush()
        await self.start()
        print(f"[WorkerBridge] Worker started, waiting for ready signal (timeout=300s)...", file=sys.stderr)
        sys.stderr.flush()
        try:
            await asyncio.wait_for(self.ready_event.wait(), timeout=300)  # allow slower first-time downloads
            print(f"[WorkerBridge] Worker is READY!", file=sys.stderr)
            sys.stderr.flush()
        except asyncio.TimeoutError as exc:
            print(f"[WorkerBridge] TIMEOUT waiting for worker ready signal!", file=sys.stderr)
            # 检查进程是否还活着
            if self.process:
                print(f"[WorkerBridge] Process returncode={self.process.returncode}", file=sys.stderr)
            sys.stderr.flush()
            raise RuntimeError("ASR worker did not become ready in time") from exc

    async def stop(self):
        if self.process:
            # 进程可能已提前退出，先检查 returncode，避免重复 terminate 触发 ProcessLookupError
            if self.process.returncode is None:
                try:
                    self.process.terminate()
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=10)
                except asyncio.TimeoutError:
                    try:
                        self.process.kill()
                    except ProcessLookupError:
                        pass
        if self.stdout_task:
            self.stdout_task.cancel()
        self.process = None
        self.stdout_task = None
        self.ready_event.clear()

    async def send(self, payload: dict):
        if not self.process or not self.process.stdin:
            raise RuntimeError("Worker process is not running")
        data = json.dumps(payload, ensure_ascii=False) + "\n"
        self.process.stdin.write(data.encode("utf-8"))
        await self.process.stdin.drain()

    async def force_commit(self, session_id: str):
        await self.send({"type": "force_commit", "session_id": session_id})

    async def reset_session(self, session_id: str):
        await self.send({"type": "reset_session", "session_id": session_id})

    def bind_ws(self, session_id: str, ws: WebSocket):
        self.ws_clients[session_id] = ws

    def unbind_ws(self, session_id: str):
        self.ws_clients.pop(session_id, None)

    async def request_transcribe(self, audio_path: str, timeout: float = 300.0):
        request_id = str(uuid4())
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self.pending_requests[request_id] = fut

        await self.send(
            {
                "type": "batch_file",
                "request_id": request_id,
                "audio_path": audio_path,
            }
        )
        return await asyncio.wait_for(fut, timeout=timeout)


app = FastAPI()

# CORS (for Web deployment)
cors_origins_raw = os.environ.get("ASR_CORS_ORIGINS", "*")
cors_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]
allow_all = not cors_origins or "*" in cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else cors_origins,
    allow_credentials=False if allow_all else True,
    allow_methods=["*"],
    allow_headers=["*"],
)
bridge: Optional[WorkerBridge] = None


@app.on_event("startup")
async def startup():
    global bridge
    bridge = WorkerBridge(engine=DEFAULT_ENGINE, model=DEFAULT_MODEL)
    await bridge.ensure_ready()


@app.on_event("shutdown")
async def shutdown():
    if bridge:
        await bridge.stop()


@app.get("/health")
async def health():
    return {"status": "ok", "engine": DEFAULT_ENGINE, "model": DEFAULT_MODEL}


# ---------------------------------------------------------------------------
# LLM API Routes (for Web deployment)
# ---------------------------------------------------------------------------
from pydantic import BaseModel
from typing import List, Optional as Opt


class SuggestionRequest(BaseModel):
    """Request body for generating suggestions."""
    character: dict
    messages: List[dict]
    character_details: Opt[dict] = None
    user_profile: Opt[dict] = None
    trigger_type: str = "manual"
    previous_suggestions: Opt[List[str]] = None
    count: int = 3


class AffinityRequest(BaseModel):
    """Request body for calculating affinity change."""
    character: dict
    selected_suggestion: str
    affinity_delta: int
    messages: Opt[List[dict]] = None


@app.get("/api/llm/status")
async def llm_status():
    """Check LLM service status."""
    from llm_service import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
    has_key = bool(LLM_API_KEY)
    return {
        "ready": has_key,
        "model": LLM_MODEL if has_key else None,
        "base_url": LLM_BASE_URL if has_key else None,
        "message": "LLM 服务已就绪" if has_key else "LLM API Key 未配置"
    }


@app.post("/api/llm/suggestions")
async def generate_suggestions(req: SuggestionRequest):
    """Generate reply suggestions based on conversation context."""
    from llm_service import get_suggestion_service
    
    try:
        service = get_suggestion_service()
        result = await service.generate(
            character=req.character,
            messages=req.messages,
            character_details=req.character_details,
            user_profile=req.user_profile,
            trigger_type=req.trigger_type,
            previous_suggestions=req.previous_suggestions,
            count=req.count
        )
        
        # Convert to dict for JSON response
        suggestions = [
            {
                "text": s.text,
                "affinity_delta": s.affinity_delta,
                "tags": s.tags
            }
            for s in result.suggestions
        ]
        
        return {
            "success": True,
            "skip": result.skip,
            "suggestions": suggestions,
            "metadata": result.metadata
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "suggestions": []
        }


@app.post("/api/affinity/calculate")
async def calculate_affinity(req: AffinityRequest):
    """Calculate new affinity based on selected suggestion."""
    try:
        current_affinity = req.character.get("affinity", 50)
        new_affinity = max(0, min(100, current_affinity + req.affinity_delta))
        
        return {
            "success": True,
            "previous_affinity": current_affinity,
            "new_affinity": new_affinity,
            "delta": req.affinity_delta,
            "selected": req.selected_suggestion
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not bridge:
        raise HTTPException(status_code=500, detail="ASR bridge not initialized")

    suffix = Path(file.filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = await bridge.request_transcribe(tmp_path)
        return JSONResponse(result)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket, session_id: str):
    if not bridge:
        await websocket.close(code=1011)
        return

    await bridge.ensure_ready()
    await websocket.accept()
    bridge.bind_ws(session_id, websocket)

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            if message.get("bytes") is not None:
                audio_bytes: bytes = message["bytes"]
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
                await bridge.send(
                    {
                        "type": "streaming_chunk",
                        "session_id": session_id,
                        "audio_data": audio_b64,
                        "timestamp": int(time.time() * 1000),
                        "is_final": False,
                    }
                )
            elif message.get("text"):
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                msg_type = payload.get("type")
                if msg_type == "force_commit":
                    await bridge.force_commit(session_id)
                elif msg_type == "reset_session":
                    await bridge.reset_session(session_id)
    except WebSocketDisconnect:
        pass
    finally:
        bridge.unbind_ws(session_id)
        try:
            await bridge.reset_session(session_id)
        except Exception:
            pass
        # 客户端已断开时避免重复发送 close 触发 RuntimeError
        if websocket.application_state != WebSocketState.DISCONNECTED:
            try:
                await websocket.close()
            except RuntimeError:
                pass


def mount_web_static():
    """Optionally serve built web assets from FastAPI (for quick deployment)."""
    static_dir_raw = os.environ.get("WEB_STATIC_DIR") or os.environ.get("ASR_WEB_STATIC_DIR")
    if not static_dir_raw:
        return

    static_dir = Path(static_dir_raw)
    if not static_dir.is_absolute():
        static_dir = (PROJECT_ROOT / static_dir).resolve()

    if static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="web")
        print(f"[ASR API] Serving web static from {static_dir}", file=sys.stderr)
    else:
        print(f"[ASR API] WEB_STATIC_DIR not found: {static_dir}", file=sys.stderr)


mount_web_static()


def main():
    host = os.environ.get("ASR_HOST", "127.0.0.1")
    port = int(os.environ.get("ASR_PORT", "0") or 0)
    if port == 0:
        # pick random free port if not set
        import socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((host, 0))
            port = s.getsockname()[1]

    print(f"[ASR API] Starting FastAPI server on {host}:{port} (engine={DEFAULT_ENGINE}, model={DEFAULT_MODEL})")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    import runpy

    # Simple argument parsing to support running worker scripts in packaged environment
    if len(sys.argv) > 1 and sys.argv[1].endswith(".py"):
        script_path = Path(sys.argv[1])
        # Security check: only allow running scripts from ASR_DIR
        # NOTE: Path.is_relative_to was introduced in Python 3.9. PyInstaller builds may use older versions.
        # Use Path.relative_to for broad compatibility.
        try:
            script_path.resolve().relative_to(ASR_DIR.resolve())
            is_relative = True
        except Exception:
            is_relative = False
            
        if script_path.exists() and (is_relative or os.environ.get("ALLOW_ARBITRARY_SCRIPTS") == "1"):
            # Adjust sys.argv so the script sees itself as argv[0]
            sys.argv = sys.argv[1:]
            print(f"[ASR Launcher] Running script: {script_path}", file=sys.stderr)
            try:
                runpy.run_path(str(script_path), run_name="__main__")
            except Exception as e:
                print(f"[ASR Launcher] Error running script: {e}", file=sys.stderr)
                import traceback
                traceback.print_exc()
                sys.exit(1)
            sys.exit(0)
        else:
             print(f"[ASR Launcher] Script not found or not allowed: {script_path}", file=sys.stderr)
             if not is_relative:
                 print(f"[ASR Launcher] Script must be in {ASR_DIR}", file=sys.stderr)

    main()
