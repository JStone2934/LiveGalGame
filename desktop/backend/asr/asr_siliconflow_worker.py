#!/usr/bin/env python3
# coding: utf-8
"""
SiliconFlow ASR Worker - Parallel Redundant Architecture (并行冗余架构)

策略：
- VAD 精准断句：使用 FunASR 轻量级 FSMN-VAD 模型（本地推理，延迟低）
- 并行冗余请求：每段音频同时发送 N 个（默认2个）请求到云端 API
- Race 机制：只接受最先返回的结果，其他自动取消
- 段落独立：每段音频独立处理，不等待前一段完成

优势：
- 高可靠性：单个请求失败不影响结果
- 低延迟：总是取最快返回的那个
- 简化逻辑：无需复杂的重试和补偿机制
"""

import base64
import concurrent.futures
import io
import json
import os
import platform
import sys
import time
import traceback
import wave
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

# ==============================================================================
# IPC 通道重定向
# ==============================================================================
ipc_fd = os.dup(sys.stdout.fileno())
ipc_channel = os.fdopen(ipc_fd, "w", buffering=1, encoding="utf-8")
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
sys.stdout = sys.stderr


def send_ipc_message(data: dict):
    try:
        ipc_channel.write(json.dumps(data, ensure_ascii=False) + "\n")
        ipc_channel.flush()
    except Exception as exc:
        sys.stderr.write(f"[IPC Error] {exc}\n")
        sys.stderr.flush()


# ==============================================================================
# 配置
# ==============================================================================
API_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"
_SF_API_KEY_OBFUSCATED = "c2staWJndG9zZmhuYmZxbmlueWVtYnRvY3B2eGJ2aG1qb3JuemJsZWZteWxlamd2a2xr"
API_KEY = os.environ.get("SILICONFLOW_API_KEY", base64.b64decode(_SF_API_KEY_OBFUSCATED).decode()).strip()
MODEL_NAME = os.environ.get("SILICONFLOW_MODEL", "TeleAI/TeleSpeechASR").strip()

SAMPLE_RATE = int(os.environ.get("ASR_SAMPLE_RATE", "16000"))
CHUNK_MS = 200  # VAD 输入块大小
MAX_BUFFER_SEC = float(os.environ.get("SF_MAX_BUFFER_SEC", "5.0"))  # 降低到5秒，避免单句过长
REQUEST_TIMEOUT = float(os.environ.get("SF_REQUEST_TIMEOUT", "25.0"))

# 并行冗余配置
PARALLEL_REQUESTS = int(os.environ.get("SF_PARALLEL_REQUESTS", "2"))  # 每段发送的并行请求数

# VAD 配置
SILENCE_THRESHOLD_CHUNKS = int(os.environ.get("SF_SILENCE_CHUNKS", "2"))  # 降低到2，更快断句（原3）
USE_FUNASR_VAD = os.environ.get("SF_USE_FUNASR_VAD", "1") in ("1", "true", "yes")

# VAD 推理设备选择（仅影响本地 VAD；云端 SiliconFlow ASR 不受影响）
# - auto: 自动选择（优先 CUDA，其次 ROCm，其次 DirectML，最后 CPU）
# - cpu/cuda/rocm/dml: 强制指定
SF_VAD_DEVICE = os.environ.get("SF_VAD_DEVICE", "auto").strip().lower()
SF_VAD_DEVICE_ID = int(os.environ.get("SF_VAD_DEVICE_ID", "0"))

MIN_SENT_CHARS = 2
SENTENCE_END_PUNCT = set("。！？!?.；;")


def decode_audio_chunk(audio_b64: str) -> np.ndarray:
    """Base64 -> float32 PCM"""
    audio_bytes = base64.b64decode(audio_b64)
    audio_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
    return audio_int16.astype(np.float32)


def pcm_to_wav_bytes(pcm: np.ndarray, sample_rate: int) -> bytes:
    """float32/int16 -> wav bytes"""
    if pcm.dtype != np.int16:
        if np.max(np.abs(pcm)) <= 1.0:
            pcm = (pcm * 32767).astype(np.int16)
        else:
            pcm = pcm.astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def smart_concat(history: str, new_text: str) -> str:
    """智能拼接文本"""
    if not new_text:
        return history
    if not history:
        return new_text
    if new_text.startswith(history):
        return new_text
    if history.endswith(new_text):
        return history
    # 检查重叠
    overlap_len = min(len(history), len(new_text))
    for i in range(overlap_len, 0, -1):
        if history.endswith(new_text[:i]):
            return history + new_text[i:]
    # 无重叠，添加空格
    if history and not history.endswith(tuple(SENTENCE_END_PUNCT)) and not history.endswith((" ", "\n")):
        return history + " " + new_text
    return history + new_text


@dataclass
class SessionState:
    audio_buffer: List[np.ndarray] = field(default_factory=list)
    silence_counter: int = 0
    is_speaking: bool = False
    start_time_ms: int = 0
    # 移除 committed_text，每段独立返回
    # committed_text: str = ""
    segment_seq: int = 0

    def reset(self):
        self.audio_buffer.clear()
        self.silence_counter = 0
        self.is_speaking = False
        self.start_time_ms = 0

    def reset_all(self):
        self.reset()
        self.segment_seq = 0


class SiliconFlowWorker:
    def __init__(self):
        self.sessions: Dict[str, SessionState] = {}
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)
        self.vad_model = None
        self._vad_device_info = {"device": "cpu", "device_id": -1, "provider": "CPUExecutionProvider", "providers": []}

        # 加载轻量级 VAD 模型
        if USE_FUNASR_VAD:
            self._load_vad_model()
        
        sys.stderr.write(f"[SF Worker] Parallel Redundant Mode\n")
        sys.stderr.write(f"[SF Worker] - Model: {MODEL_NAME}\n")
        sys.stderr.write(f"[SF Worker] - Parallel requests: {PARALLEL_REQUESTS}\n")
        if self.vad_model:
            sys.stderr.write(
                "[SF Worker] - VAD: FunASR FSMN-VAD"
                f" (device={self._vad_device_info.get('device')}, device_id={self._vad_device_info.get('device_id')}, "
                f"provider={self._vad_device_info.get('provider')})\n"
            )
        else:
            sys.stderr.write(f"[SF Worker] - VAD: Simple RMS\n")
        sys.stderr.write(f"[SF Worker] - Max buffer: {MAX_BUFFER_SEC}s\n")
        sys.stderr.flush()

    def _detect_onnx_vad_device(self) -> dict:
        """
        自动检测 onnxruntime 可用的执行后端，并选择 VAD 使用的设备。

        注意：
        - 这里只能控制「本地 VAD」的推理设备；SiliconFlow 云端 ASR 不会使用本机 GPU。
        - funasr_onnx 的 Fsmn_vad 接口通常通过 device_id 控制是否走 GPU（>=0）或 CPU（-1）。
        - Provider 选择受安装的 onnxruntime 版本影响：
          * NVIDIA：onnxruntime-gpu -> CUDAExecutionProvider
          * AMD/Win：onnxruntime-directml -> DmlExecutionProvider（适配 A/N/Intel）
          * AMD/Linux：onnxruntime-rocm -> ROCMExecutionProvider
        """
        forced = SF_VAD_DEVICE
        device_id = SF_VAD_DEVICE_ID

        try:
            import onnxruntime as ort  # type: ignore

            providers = ort.get_available_providers() or []
        except Exception:
            providers = []

        providers_set = {p.lower(): p for p in providers}
        has_cuda = "cudaexecutionprovider" in providers_set
        has_rocm = "rocmexecutionprovider" in providers_set
        has_dml = "dmlexecutionprovider" in providers_set

        def _cpu():
            return {
                "device": "cpu",
                "device_id": -1,
                "provider": "CPUExecutionProvider",
                "providers": providers,
            }

        def _gpu(provider_key: str, device: str):
            return {
                "device": device,
                "device_id": device_id,
                "provider": providers_set.get(provider_key, provider_key),
                "providers": providers,
            }

        # 强制模式
        if forced in ("cpu", "none", "off", "-1"):
            return _cpu()
        if forced in ("cuda", "nvidia"):
            return _gpu("cudaexecutionprovider", "cuda") if has_cuda else _cpu()
        if forced in ("rocm", "amd"):
            return _gpu("rocmexecutionprovider", "rocm") if has_rocm else _cpu()
        if forced in ("dml", "directml"):
            return _gpu("dmlexecutionprovider", "dml") if has_dml else _cpu()

        # auto：按优先级选择（CUDA > ROCm > DirectML > CPU）
        if has_cuda:
            return _gpu("cudaexecutionprovider", "cuda")
        if has_rocm:
            return _gpu("rocmexecutionprovider", "rocm")
        # Windows 下 AMD/NVIDIA 通常走 DirectML
        if has_dml:
            return _gpu("dmlexecutionprovider", "dml")
        return _cpu()

    def _load_vad_model(self):
        """加载 FunASR 轻量级 VAD 模型（约 100MB，比完整 ASR 模型小得多）"""
        try:
            from funasr_onnx.vad_bin import Fsmn_vad
            vad_model_id = "iic/speech_fsmn_vad_zh-cn-16k-common-onnx"

            self._vad_device_info = self._detect_onnx_vad_device()
            sys.stderr.write(f"[SF Worker] Host: {platform.system()} {platform.release()} ({platform.machine()})\n")
            sys.stderr.write(f"[SF Worker] SF_VAD_DEVICE={SF_VAD_DEVICE}, SF_VAD_DEVICE_ID={SF_VAD_DEVICE_ID}\n")
            sys.stderr.write(f"[SF Worker] ONNX Runtime providers: {self._vad_device_info.get('providers')}\n")
            sys.stderr.write(
                f"[SF Worker] Loading VAD model: {vad_model_id} "
                f"(device={self._vad_device_info.get('device')}, device_id={self._vad_device_info.get('device_id')}, "
                f"provider={self._vad_device_info.get('provider')})...\n"
            )
            sys.stderr.flush()

            # funasr_onnx：device_id=-1 表示 CPU；>=0 尝试使用 GPU（由安装的 onnxruntime provider 决定）
            self.vad_model = Fsmn_vad(
                model_dir=vad_model_id,
                quantize=True,
                device_id=int(self._vad_device_info.get("device_id", -1)),
            )
            sys.stderr.write("[SF Worker] VAD model loaded successfully!\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[SF Worker] VAD loading failed: {e}, fallback to RMS\n")
            sys.stderr.flush()
            self.vad_model = None

    def _is_speech(self, chunk_f32: np.ndarray) -> bool:
        """VAD 检测：优先用 FunASR 模型，回退到简单 RMS"""
        if chunk_f32.size == 0:
            return False
        
        if self.vad_model:
            try:
                # FunASR VAD 实际上接受 float32 格式（范围在 -32768 到 32768）
                # 输入的 chunk_f32 已经是正确格式了，直接传入
                segments = self.vad_model(chunk_f32)
                return len(segments) > 0
            except Exception as e:
                sys.stderr.write(f"[SF Worker] VAD error: {e}, using RMS fallback\n")
                sys.stderr.flush()
        
        # RMS 回退方案
        rms = float(np.sqrt(np.mean(chunk_f32 ** 2)))
        threshold = 300 / 32768.0
        return rms >= threshold

    def _get_state(self, session_id: str) -> SessionState:
        if session_id not in self.sessions:
            self.sessions[session_id] = SessionState()
        return self.sessions[session_id]

    def reset_session(self, session_id: str):
        self.sessions.pop(session_id, None)
        sys.stderr.write(f"[SF Worker] Session reset: {session_id}\n")
        sys.stderr.flush()

    def handle_force_commit(self, data: dict):
        session_id = data.get("session_id")
        if not session_id:
            return
        state = self.sessions.get(session_id)
        if not state or not state.audio_buffer:
            return
        self._commit_segment(state, data.get("request_id", "default"), session_id, "force_commit")

    def handle_streaming_chunk(self, data: dict):
        session_id = data.get("session_id") or data.get("request_id") or "default"
        request_id = data.get("request_id", "default")
        audio_b64 = data.get("audio_data")
        timestamp_ms = int(data.get("timestamp", int(time.time() * 1000)))
        is_final = bool(data.get("is_final", False))

        if not audio_b64:
            return

        state = self._get_state(session_id)
        if state.start_time_ms == 0:
            state.start_time_ms = timestamp_ms

        chunk = decode_audio_chunk(audio_b64)
        if chunk.size == 0:
            return

        # VAD 检测
        has_voice = self._is_speech(chunk)

        if has_voice:
            state.is_speaking = True
            state.silence_counter = 0
            state.audio_buffer.append(chunk)
        else:
            if state.is_speaking:
                state.silence_counter += 1
                # 保留少量尾部静音
                if state.silence_counter <= 2:
                    state.audio_buffer.append(chunk)

        # 检查是否应该提交
        buffered_samples = sum(c.size for c in state.audio_buffer)
        buffered_sec = buffered_samples / float(SAMPLE_RATE)
        
        should_commit = state.is_speaking and (
            state.silence_counter >= SILENCE_THRESHOLD_CHUNKS or
            buffered_sec >= MAX_BUFFER_SEC or
            is_final
        )

        if should_commit and state.audio_buffer:
            trigger = "final" if is_final else ("max_buffer" if buffered_sec >= MAX_BUFFER_SEC else "silence")
            self._commit_segment(state, request_id, session_id, trigger)

    def handle_batch_file(self, data: dict):
        request_id = data.get("request_id", "unknown")
        audio_path = data.get("audio_path")
        
        if not audio_path or not os.path.exists(audio_path):
            send_ipc_message({"request_id": request_id, "status": "error", "error": f"File not found: {audio_path}"})
            return

        try:
            with wave.open(audio_path, "rb") as wf:
                if wf.getsampwidth() != 2:
                    raise ValueError("Only 16-bit PCM supported")
                ch = wf.getnchannels()
                sr = wf.getframerate()
                raw = wf.readframes(wf.getnframes())
            
            audio = np.frombuffer(raw, dtype=np.int16)
            if ch > 1:
                audio = audio.reshape(-1, ch)[:, 0]
            audio_f32 = audio.astype(np.float32)
            
            # 批量文件使用单请求即可
            self._parallel_transcribe_and_send(audio_f32, sr, request_id, "batch_file", None, None)
        except Exception as exc:
            send_ipc_message({
                "request_id": request_id,
                "status": "error",
                "error": str(exc),
                "traceback": traceback.format_exc()
            })

    def _commit_segment(self, state: SessionState, request_id: str, session_id: str, trigger: str):
        """提交音频段"""
        merged = np.concatenate(state.audio_buffer)
        sr = SAMPLE_RATE
        state.reset()
        state.segment_seq += 1
        seg_seq = state.segment_seq
        
        duration_sec = len(merged) / float(sr)
        sys.stderr.write(f"[SF Worker] 📤 Committing segment #{seg_seq} ({duration_sec:.1f}s, trigger={trigger})\n")
        sys.stderr.flush()
        
        # 并行冗余请求
        self._parallel_transcribe_and_send(merged, sr, request_id, trigger, session_id, seg_seq)

    def _parallel_transcribe_and_send(
        self,
        audio_f32: np.ndarray,
        sample_rate: int,
        request_id: str,
        trigger: str,
        session_id: Optional[str],
        seg_seq: Optional[int],
    ):
        """并行发送多个冗余请求，取最快返回的结果"""
        import requests
        
        t0 = time.time()
        wav_bytes = pcm_to_wav_bytes(audio_f32, sample_rate)
        
        def single_request(replica_id: int):
            """单个 API 请求"""
            try:
                files = {"file": ("chunk.wav", wav_bytes, "audio/wav")}
                data = {"model": MODEL_NAME}
                headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}
                
                sys.stderr.write(f"[SF Worker]   - Request #{replica_id} started\n")
                sys.stderr.flush()
                
                resp = requests.post(
                    API_URL,
                    headers=headers,
                    data=data,
                    files=files,
                    timeout=(3, REQUEST_TIMEOUT),
                )
                resp.raise_for_status()
                
                j = resp.json()
                text = (j.get("text") or "").strip()
                latency = time.time() - t0
                
                sys.stderr.write(f"[SF Worker]   ✓ Request #{replica_id} returned in {latency:.2f}s: \"{text[:30]}...\"\n")
                sys.stderr.flush()
                
                return {"text": text, "replica_id": replica_id, "latency": latency}
            except Exception as exc:
                sys.stderr.write(f"[SF Worker]   ✗ Request #{replica_id} failed: {exc}\n")
                sys.stderr.flush()
                raise

        # 并行发送 N 个请求
        futures = []
        for i in range(PARALLEL_REQUESTS):
            future = self.executor.submit(single_request, i)
            futures.append(future)
        
        # 等待第一个完成的请求（Race）
        result = None
        try:
            done, pending = concurrent.futures.wait(
                futures,
                timeout=REQUEST_TIMEOUT + 5,
                return_when=concurrent.futures.FIRST_COMPLETED
            )
            
            # 取第一个成功的结果
            for future in done:
                try:
                    result = future.result()
                    break
                except Exception:
                    continue
            
            # 取消其他未完成的请求
            for future in pending:
                future.cancel()
                
        except Exception as exc:
            sys.stderr.write(f"[SF Worker] Parallel request failed: {exc}\n")
            sys.stderr.flush()

        # 如果所有请求都失败
        if result is None:
            send_ipc_message({
                "request_id": request_id,
                "session_id": session_id or request_id,
                "status": "error",
                "error": "All parallel requests failed",
                "trigger": trigger,
                "engine": "siliconflow",
            })
            return

        # 处理成功的结果
        text = result["text"]
        latency_ms = int(result["latency"] * 1000)
        now_ms = int(time.time() * 1000)

        # batch_file：直接返回
        if session_id is None:
            send_ipc_message({
                "request_id": request_id,
                "session_id": request_id,
                "type": "sentence_complete",
                "text": text,
                "timestamp": now_ms,
                "is_final": True,
                "status": "success",
                "language": "zh",
                "trigger": trigger,
                "latency_ms": latency_ms,
                "engine": "siliconflow",
                "replica_id": result["replica_id"],
            })
            return

        # streaming：每段独立返回（不再累积）
        # 这样避免了重复保存问题，由前端/Node.js端决定如何处理多段文本
        if not text:
            return

        send_ipc_message({
            "request_id": request_id,
            "session_id": session_id,
            "type": "sentence_complete",
            "text": text,  # 直接返回本段文本，不累积
            "timestamp": now_ms,
            "is_final": True,
            "status": "success",
            "language": "zh",
            "trigger": trigger,
            "latency_ms": latency_ms,
            "engine": "siliconflow",
            "segment_seq": seg_seq,
            "replica_id": result["replica_id"],
        })


def main():
    try:
        worker = SiliconFlowWorker()
        send_ipc_message({"status": "ready"})
        sys.stderr.write("[SF Worker] READY - Parallel Redundant Mode Enabled\n")
        sys.stderr.flush()

        while True:
            line = sys.stdin.readline()
            if not line:
                break
            
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            req_type = data.get("type")
            if req_type == "reset_session":
                worker.reset_session(data.get("session_id", ""))
            elif req_type == "force_commit":
                worker.handle_force_commit(data)
            elif req_type == "streaming_chunk":
                worker.handle_streaming_chunk(data)
            elif req_type == "batch_file" or "audio_path" in data:
                worker.handle_batch_file(data)
            else:
                send_ipc_message({
                    "request_id": data.get("request_id", "unknown"),
                    "status": "error",
                    "error": f"Unknown request type: {req_type}"
                })
                
    except Exception as exc:
        sys.stderr.write(f"[SF Worker] Fatal: {exc}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        send_ipc_message({"status": "fatal", "error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()

