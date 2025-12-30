#!/usr/bin/env python3
"""
FunASR 2-Pass Worker: 基于 funasr_onnx 的流式/离线混合语音识别

参照 RealtimeMicPipeline demo 设计：
- Pass 1 (流式): ParaformerOnline 快速出字，用于实时显示
- Pass 2 (离线): ParaformerOffline + 标点模型，用于最终修正

分句策略：
- VAD 检测语音边界
- 静音累积达到阈值触发 Pass 2 修正
- 支持强制提交 (force_commit)
"""

import json
import os
import platform
import sys
import time
import traceback
import base64
import copy
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

# ==============================================================================
# OS 级别的文件描述符重定向
# ==============================================================================
ipc_fd = os.dup(sys.stdout.fileno())
ipc_channel = os.fdopen(ipc_fd, "w", buffering=1, encoding="utf-8")
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
sys.stdout = sys.stderr


def send_ipc_message(data):
    """发送 JSON 消息到 Node.js"""
    try:
        json_str = json.dumps(data, ensure_ascii=False)
        ipc_channel.write(json_str + "\n")
        ipc_channel.flush()
    except Exception as exc:
        sys.stderr.write(f"[IPC Error] Failed to send: {exc}\n")
        sys.stderr.flush()


# ==============================================================================
# 环境变量配置
# ==============================================================================
os.environ.setdefault("TQDM_DISABLE", "1")

# 【并发修复】Worker ID 用于日志区分，每个音频源有独立的 Worker 进程
WORKER_ID = os.environ.get("FUNASR_WORKER_ID", "default")

MODELSCOPE_CACHE = os.environ.get("MODELSCOPE_CACHE") or os.environ.get("ASR_CACHE_DIR")
if MODELSCOPE_CACHE:
    os.environ.setdefault("MODELSCOPE_CACHE", MODELSCOPE_CACHE)
    os.environ.setdefault("MODELSCOPE_CACHE_HOME", MODELSCOPE_CACHE)

# 离线模式：如果设置了 MODELSCOPE_OFFLINE=1，则跳过网络请求，直接使用本地缓存
OFFLINE_MODE = os.environ.get("MODELSCOPE_OFFLINE", "").lower() in ("1", "true", "yes")
if OFFLINE_MODE:
    sys.stderr.write("[FunASR Worker] Offline mode enabled: using local cache only\n")
    sys.stderr.flush()
    # 设置 modelscope 离线模式相关环境变量
    os.environ["MODELSCOPE_OFFLINE"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    # 尝试配置 modelscope 库的离线模式
    try:
        from modelscope.hub.snapshot_download import snapshot_download
        from modelscope.hub.file_download import model_file_download
        # Monkey-patch: 让 modelscope 跳过版本检查
        import modelscope.hub.api as ms_api
        if hasattr(ms_api, 'HubApi'):
            _original_get_model_files = getattr(ms_api.HubApi, 'get_model_files', None)
            if _original_get_model_files:
                def _patched_get_model_files(self, model_id, revision=None, *args, **kwargs):
                    # 离线模式下直接返回空，让库使用本地缓存
                    return []
                ms_api.HubApi.get_model_files = _patched_get_model_files
    except Exception as e:
        sys.stderr.write(f"[FunASR Worker] Warning: Could not configure modelscope offline mode: {e}\n")
        sys.stderr.flush()

# ==============================================================================
# FunASR 配置
# ==============================================================================
SAMPLE_RATE = int(os.environ.get("ASR_SAMPLE_RATE", "16000"))
CHUNK_MS = int(os.environ.get("ASR_CHUNK_MS", "200"))  # 每次读取的音频块时长 (毫秒)
CHUNK_SAMPLES = int(SAMPLE_RATE * CHUNK_MS / 1000)

# 静音检测配置
SILENCE_THRESHOLD_CHUNKS = int(os.environ.get("ASR_SILENCE_CHUNKS", "3"))  # 连续静音块数触发句尾
SILENCE_BUFFER_KEEP = 2  # 保留多少个静音块让音频更自然

# 分句配置
SENTENCE_END_PUNCTUATION = set("。！？!?.；;")
MIN_SENTENCE_CHARS = int(os.environ.get("MIN_SENTENCE_CHARS", "2"))

# 推理设备选择（影响本地 FunASR ONNX 模型：VAD/Online/Offline/Punc）
# - auto: 自动选择（优先 CUDA，其次 ROCm，其次 DirectML，最后 CPU）
# - cpu/cuda/rocm/dml: 强制指定
ASR_DEVICE = os.environ.get("ASR_DEVICE", "auto").strip().lower()
ASR_DEVICE_ID = int(os.environ.get("ASR_DEVICE_ID", "0"))


@dataclass
class GPUConfig:
    """
    兼容历史测试脚本的 GPU 配置对象。

    - device_type: cpu/cuda/rocm/dml
    - provider_name: onnxruntime provider 名称（如 DmlExecutionProvider）
    - available: 是否启用 GPU
    - device_id: GPU 设备 id（CPU 时为 -1）
    - providers: 可用 providers 列表（调试用）
    """

    device_type: str = "cpu"
    provider_name: str = "CPUExecutionProvider"
    available: bool = False
    device_id: int = -1
    providers: List[str] = field(default_factory=list)


def detect_onnx_device() -> dict:
    """
    检测 onnxruntime 可用 provider，并选择推理设备。

    说明：
    - funasr_onnx 的模型构造函数一般通过 device_id 控制：-1 为 CPU；>=0 尝试使用 GPU。
    - 实际走哪种 GPU 取决于安装的 onnxruntime 版本提供的 provider：
      * CUDAExecutionProvider (onnxruntime-gpu) -> NVIDIA
      * ROCMExecutionProvider (onnxruntime-rocm) -> AMD/ROCm
      * DmlExecutionProvider (onnxruntime-directml) -> Windows 上 AMD/NVIDIA/Intel
    """
    forced = ASR_DEVICE
    device_id = ASR_DEVICE_ID

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
    if has_dml:
        return _gpu("dmlexecutionprovider", "dml")
    return _cpu()


def detect_gpu() -> GPUConfig:
    """
    兼容接口：返回 GPUConfig，供 test_funasr_gpu.py 等脚本调用。
    """
    info = detect_onnx_device()
    device = str(info.get("device", "cpu"))
    device_id = int(info.get("device_id", -1))
    provider = str(info.get("provider", "CPUExecutionProvider"))
    providers = list(info.get("providers") or [])
    available = device_id >= 0 and provider != "CPUExecutionProvider"
    return GPUConfig(
        device_type=device,
        provider_name=provider,
        available=available,
        device_id=device_id,
        providers=providers,
    )


def smart_concat(history: str, new_text: str) -> str:
    """
    智能拼接流式文本：处理增量、全量、重叠等情况。
    """
    if not new_text:
        return history
    if not history:
        return new_text
    
    # 1. 检查 new_text 是否完全包含 history (说明 new_text 是全量更新)
    if new_text.startswith(history):
        return new_text
        
    # 2. 检查 history 是否完全包含 new_text (说明 new_text 是旧的全量或者是重复输出)
    if history.endswith(new_text):
        return history
        
    # 3. 检查重叠 (history后缀 与 new_text前缀)
    overlap_len = min(len(history), len(new_text))
    for i in range(overlap_len, 0, -1):
        if history.endswith(new_text[:i]):
            return history + new_text[i:]
            
    # 4. 无重叠，直接拼接
    return history + new_text


def decode_audio_chunk(audio_b64: str) -> np.ndarray:
    """Base64 音频转 float32 numpy array（范围 -1~1）。"""
    audio_bytes = base64.b64decode(audio_b64)
    audio_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
    return audio_int16.astype(np.float32)  # funasr_onnx 接受 float32，不除以 32768


def _clone_online_model_with_isolated_frontend(asr_online_template):
    """
    关键：funasr_onnx 的 ParaformerOnline 内部包含 WavFrontendOnline，
    其内部有 reserve_waveforms/input_cache/lfr_splice_cache 等流式缓存。
    如果多个 session 共享同一个 ParaformerOnline 实例，这些缓存会串线，导致并发时某一路“识别不到”。

    这里做一个“轻量 clone”：
    - 共享 ORT encoder/decoder session（模型权重不重复加载，内存更省）
    - 但为每个 session 创建独立的 WavFrontendOnline（缓存隔离）
    """
    try:
        # 注意：不要在模块 import 阶段引入 funasr_onnx，避免某些打包/路径场景下提前失败
        from funasr_onnx.utils.frontend import WavFrontendOnline  # type: ignore
    except Exception as e:
        # 兜底：无法导入时直接返回模板（会退化为共享缓存；但至少不中断服务）
        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] WARN: cannot import WavFrontendOnline: {e}\n")
        sys.stderr.flush()
        return asr_online_template

    # shallow copy：复用 converter/tokenizer/pe/ort sessions 等重对象
    model = copy.copy(asr_online_template)

    try:
        tpl_frontend = getattr(asr_online_template, "frontend", None)
        tpl_opts = getattr(tpl_frontend, "opts", None)
        frame_opts = getattr(tpl_opts, "frame_opts", None)
        mel_opts = getattr(tpl_opts, "mel_opts", None)

        model.frontend = WavFrontendOnline(
            cmvn_file=getattr(tpl_frontend, "cmvn_file", None),
            fs=int(getattr(frame_opts, "samp_freq", 16000)),
            window=str(getattr(frame_opts, "window_type", "hamming")),
            n_mels=int(getattr(mel_opts, "num_bins", 80)),
            frame_length=float(getattr(frame_opts, "frame_length_ms", 25.0)),
            frame_shift=float(getattr(frame_opts, "frame_shift_ms", 10.0)),
            lfr_m=int(getattr(tpl_frontend, "lfr_m", 1)),
            lfr_n=int(getattr(tpl_frontend, "lfr_n", 1)),
            dither=float(getattr(frame_opts, "dither", 1.0)),
        )
    except Exception as e:
        # 兜底：如果构造失败，至少尝试“复制+清空缓存”
        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] WARN: isolate frontend failed, fallback copy+reset: {e}\n")
        sys.stderr.flush()
        try:
            model.frontend = copy.copy(getattr(asr_online_template, "frontend", None))
            if hasattr(model.frontend, "cache_reset"):
                model.frontend.cache_reset()
        except Exception:
            # 最差情况：继续复用模板 frontend（可能仍存在串线）
            model.frontend = getattr(asr_online_template, "frontend", None)

    return model


def smart_split_sentences(text: str) -> List[str]:
    """
    智能分句：基于标点符号将长文本切分成自然的句子。
    
    策略：
    1. 优先按句末标点（。！？!?.）分割
    2. 如果分隔后的句子太短，考虑合并
    3. 如果没有句末标点，返回原文
    """
    if not text or len(text) < MIN_SENTENCE_CHARS:
        return [text] if text else []
    
    # 定义句末标点
    sentence_endings = "。！？!?."
    
    sentences = []
    current_sentence = ""
    
    for char in text:
        current_sentence += char
        if char in sentence_endings:
            trimmed = current_sentence.strip()
            if trimmed and len(trimmed) >= MIN_SENTENCE_CHARS:
                sentences.append(trimmed)
            elif trimmed and sentences:
                # 太短的句子合并到上一句
                sentences[-1] += trimmed
            elif trimmed:
                sentences.append(trimmed)
            current_sentence = ""
    
    # 处理剩余的文本
    remaining = current_sentence.strip()
    if remaining:
        if len(remaining) < MIN_SENTENCE_CHARS and sentences:
            # 太短就合并到上一句
            sentences[-1] += remaining
        else:
            sentences.append(remaining)
    
    return sentences if sentences else [text]



@dataclass
class SessionState:
    """
    FunASR 2-Pass 会话状态
    """
    # 音频缓冲区 (给 Pass 2 用)
    full_sentence_buffer: List[np.ndarray] = field(default_factory=list)
    
    # Pass 1 流式模型的上下文缓存
    online_cache: Dict = field(default_factory=dict)
    
    # 静音检测
    silence_counter: int = 0
    is_speaking: bool = False
    
    # 累积的流式文本
    streaming_text: str = ""
    last_sent_text: str = ""
    
    # 时间戳
    start_time: float = 0.0
    
    def reset(self):
        """重置会话状态"""
        self.full_sentence_buffer.clear()
        self.online_cache.clear()
        self.silence_counter = 0
        self.is_speaking = False
        self.streaming_text = ""
        self.last_sent_text = ""
        self.start_time = 0.0


def resolve_local_model_path(model_id: str, require_offline_mode: bool = True) -> Optional[str]:
    """
    解析本地模型路径。
    检查 MODELSCOPE_CACHE 和默认缓存目录下是否存在模型。

    Args:
        model_id: 模型 ID，如 "damo/speech_fsmn_vad_zh-cn-16k-common-onnx"
        require_offline_mode: 是否要求离线模式才返回结果（默认 True 保持兼容）
    """
    if require_offline_mode and not OFFLINE_MODE:
        return None

    import os.path

    # 获取所有可能的缓存目录
    ms_cache = os.environ.get("MODELSCOPE_CACHE")
    asr_cache = os.environ.get("ASR_CACHE_DIR")
    home_cache = os.path.join(os.path.expanduser("~"), ".cache", "modelscope")

    cache_bases = []
    for c in [ms_cache, asr_cache, home_cache]:
        if c:
            cache_bases.append(c)
            # 如果路径以 hub 结尾，也检查父目录
            if os.path.basename(c).lower() == "hub":
                cache_bases.append(os.path.dirname(c))

    # 去重
    cache_bases = list(dict.fromkeys(cache_bases))

    for cache_dir in cache_bases:
        if not cache_dir:
            continue

        # 多种可能的路径结构（按优先级排序）
        candidates = [
            # 标准 modelscope 结构
            os.path.join(cache_dir, "hub", "models", model_id),
            # 简化结构（下载脚本可能创建的）
            os.path.join(cache_dir, model_id),
            os.path.join(cache_dir, "models", model_id),
            os.path.join(cache_dir, "hub", model_id),
            # 嵌套的 modelscope 目录
            os.path.join(cache_dir, "modelscope", "hub", "models", model_id),
            os.path.join(cache_dir, "modelscope", "models", model_id),
            os.path.join(cache_dir, "modelscope", model_id),
        ]

        for candidate in candidates:
            if os.path.isdir(candidate):
                # 检查是否有模型文件
                try:
                    files = os.listdir(candidate)
                    if any(f.endswith(('.onnx', '.bin', '.json', '.yaml')) for f in files):
                        sys.stderr.write(f"[FunASR Worker] Found local model: {candidate}\n")
                        sys.stderr.flush()
                        return candidate
                except Exception:
                    continue

    return None


def load_funasr_onnx_models(gpu_config: Optional[GPUConfig] = None):
    """
    加载 funasr_onnx 模型 (VAD + 流式ASR + 离线ASR + 标点)
    
    支持的环境变量:
    - ASR_MODEL: 模型 ID (默认 funasr-paraformer)
        * funasr-paraformer: INT8 量化版，包体约 0.76GB（online/offline/punc/vad）
        注意: ModelScope ONNX 仓库只提供量化版 (model_quant.onnx)，无非量化版可用
    - MODELSCOPE_OFFLINE: 离线模式，跳过网络请求直接使用本地缓存
    """
    try:
        from funasr_onnx.vad_bin import Fsmn_vad
        from funasr_onnx.paraformer_online_bin import Paraformer as ParaformerOnline
        from funasr_onnx.paraformer_bin import Paraformer as ParaformerOffline
        from funasr_onnx.punc_bin import CT_Transformer
    except ImportError as e:
        sys.stderr.write(f"[FunASR Worker] Import error: {e}\n")
        sys.stderr.write("[FunASR Worker] Please install: pip install funasr_onnx\n")
        sys.stderr.flush()
        raise

    # 读取模型配置
    model_id = os.environ.get("ASR_MODEL", "funasr-paraformer")

    device_info = detect_onnx_device()
    if gpu_config is not None:
        # 兼容：允许外部显式传入 device_id（例如 test_funasr_gpu.py）
        try:
            device_info = {
                "device": getattr(gpu_config, "device_type", "cpu"),
                "device_id": int(getattr(gpu_config, "device_id", -1)),
                "provider": getattr(gpu_config, "provider_name", "CPUExecutionProvider"),
                "providers": list(getattr(gpu_config, "providers", []) or []),
            }
        except Exception:
            device_info = detect_onnx_device()
    
    # 注意: ModelScope 上的 FunASR ONNX 模型仓库 (如 damo/speech_fsmn_vad_zh-cn-16k-common-onnx)
    # 只提供了量化版 model_quant.onnx，不提供非量化版 model.onnx。
    # 如果 quantize=False，funasr_onnx 会尝试从 PyTorch 模型导出 ONNX，
    # 但这需要完整的 funasr 库（不是 funasr_onnx）。
    # 因此，对于这些预编译的 ONNX 模型，必须强制使用量化版。
    quantize_env = os.environ.get("ASR_QUANTIZE", "").lower()
    if quantize_env in ("false", "0", "no"):
        # 用户显式禁用量化 - 发出警告但仍强制使用量化（因为没有非量化版可用）
        sys.stderr.write(
            "[FunASR Worker] Warning: ASR_QUANTIZE=false requested, but ModelScope ONNX models only provide quantized versions.\n"
            "[FunASR Worker] Forcing quantize=True to avoid export failure.\n"
        )
        sys.stderr.flush()
        use_quantize = True
    else:
        # 默认或显式启用量化：使用量化版（这是唯一可用的版本）
        use_quantize = True
    
    sys.stderr.write(f"[FunASR Worker] Model ID: {model_id}\n")
    sys.stderr.write(f"[FunASR Worker] Use Quantize: {use_quantize} (ONNX repo only provides quantized models)\n")
    sys.stderr.write(f"[FunASR Worker] Offline mode: {OFFLINE_MODE}\n")
    sys.stderr.write(f"[FunASR Worker] Host: {platform.system()} {platform.release()} ({platform.machine()})\n")
    sys.stderr.write(f"[FunASR Worker] ASR_DEVICE={ASR_DEVICE}, ASR_DEVICE_ID={ASR_DEVICE_ID}\n")
    sys.stderr.write(f"[FunASR Worker] ONNX Runtime providers: {device_info.get('providers')}\n")
    sys.stderr.write(
        "[FunASR Worker] Inference device selection: "
        f"device={device_info.get('device')}, device_id={device_info.get('device_id')}, provider={device_info.get('provider')}\n"
    )
    sys.stderr.write(f"[FunASR Worker] Preset size hint: ~0.76GB INT8 (quantized ONNX models from ModelScope)\n")
    if OFFLINE_MODE:
        sys.stderr.write("[FunASR Worker] Loading ONNX models from local cache (offline mode)...\n")
    else:
        sys.stderr.write("[FunASR Worker] Loading ONNX models (first run will download)...\n")
    sys.stderr.flush()

    # ONNX 模型配置
    # 可以通过环境变量覆盖默认模型
    vad_model_id = os.environ.get(
        "FUNASR_VAD_MODEL", 
        "damo/speech_fsmn_vad_zh-cn-16k-common-onnx"
    )
    online_model_id = os.environ.get(
        "FUNASR_ONLINE_MODEL",
        "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx"
    )
    offline_model_id = os.environ.get(
        "FUNASR_OFFLINE_MODEL",
        "damo/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-onnx"
    )
    punc_model_id = os.environ.get(
        "FUNASR_PUNC_MODEL",
        "damo/punc_ct-transformer_zh-cn-common-vocab272727-onnx"
    )

    def _normalize_model_id(value: str, label: str) -> str:
        """
        兼容历史/外部配置：有些环境可能会把 FUNASR_* 变量设置为本地缓存目录路径，
        但 funasr_onnx 内部会将该值传给 funasr.AutoModel(model=...)。
        AutoModel 需要 registry 模型 ID（如 "damo/xxx"），而不是 "C:\\...\\damo\\xxx"。
        """
        if not value:
            return value

        # 已经是 registry 形式
        if "/" in value and not (":" in value or value.startswith("\\") or value.startswith("/")):
            return value

        # 如果是本地路径（win/mac/linux），尝试从路径中提取 "org/model"
        try:
            norm = os.path.normpath(value)
            parts = [p for p in norm.split(os.sep) if p]
            # 常见结构: .../hub/models/damo/<model>  或 .../hub/damo/<model>
            if "models" in parts:
                idx = parts.index("models")
                if idx + 2 < len(parts):
                    org = parts[idx + 1]
                    model = parts[idx + 2]
                    inferred = f"{org}/{model}"
                    sys.stderr.write(f"[FunASR Worker] Normalized {label} from local path to model id: {inferred}\n")
                    sys.stderr.flush()
                    return inferred
            # 兜底：直接在路径中找 "damo/<model>"
            if "damo" in parts:
                idx = parts.index("damo")
                if idx + 1 < len(parts):
                    inferred = f"damo/{parts[idx + 1]}"
                    sys.stderr.write(f"[FunASR Worker] Normalized {label} from local path to model id: {inferred}\n")
                    sys.stderr.flush()
                    return inferred
        except Exception:
            pass

        # 无法识别时原样返回（让后续报错更明确）
        return value

    def _ensure_vad_compatibility(model_dir: str):
        """
        修复 funasr_onnx VAD 模型的兼容性问题。
        funasr_onnx 的 VAD 类硬编码了文件名 "vad.yaml" 和 "vad.onnx" (或 vad.mvn)，
        但 ModelScope 下载的模型文件通常是 "config.yaml" 和 "model_quant.onnx"。

        此函数检查并自动创建缺失文件的副本（使用复制而非软链，以兼容 Windows）。
        同时修复配置文件中缺少 vad_post_conf 的问题。
        """
        if not model_dir or not os.path.exists(model_dir):
            return

        import shutil

        # 1. 处理 config 文件: config.yaml -> vad.yaml
        vad_yaml = os.path.join(model_dir, "vad.yaml")
        config_yaml = os.path.join(model_dir, "config.yaml")

        if not os.path.exists(vad_yaml) and os.path.exists(config_yaml):
            try:
                sys.stderr.write(f"[FunASR Worker] Compatibility fix: copying config.yaml to vad.yaml...\n")
                shutil.copy2(config_yaml, vad_yaml)
            except Exception as e:
                sys.stderr.write(f"[FunASR Worker] Warning: failed to copy vad.yaml: {e}\n")

        # 2. 处理 mvn 文件: am.mvn -> vad.mvn
        vad_mvn = os.path.join(model_dir, "vad.mvn")
        am_mvn = os.path.join(model_dir, "am.mvn")

        if not os.path.exists(vad_mvn) and os.path.exists(am_mvn):
            try:
                sys.stderr.write(f"[FunASR Worker] Compatibility fix: copying am.mvn to vad.mvn...\n")
                shutil.copy2(am_mvn, vad_mvn)
            except Exception as e:
                sys.stderr.write(f"[FunASR Worker] Warning: failed to copy vad.mvn: {e}\n")

        # 3. 修复配置文件中缺少 vad_post_conf 的问题
        # funasr_onnx 的 Fsmn_vad 类需要 config["vad_post_conf"]，
        # 但 ModelScope 下载的模型使用的是 config["model_conf"]
        if os.path.exists(config_yaml):
            try:
                import yaml
                with open(config_yaml, "r", encoding="utf-8") as f:
                    config = yaml.safe_load(f)

                if config and "model_conf" in config and "vad_post_conf" not in config:
                    config["vad_post_conf"] = config["model_conf"].copy()
                    with open(config_yaml, "w", encoding="utf-8") as f:
                        yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
                    sys.stderr.write(f"[FunASR Worker] Compatibility fix: added vad_post_conf to config.yaml\n")
                    sys.stderr.flush()
            except ImportError:
                sys.stderr.write(f"[FunASR Worker] Warning: yaml library not available, cannot fix vad_post_conf\n")
            except Exception as e:
                sys.stderr.write(f"[FunASR Worker] Warning: failed to fix vad_post_conf: {e}\n")

        # 4. 处理模型文件: model_quant.onnx -> vad.onnx
        # 注意：funasr_onnx 内部逻辑：
        # if quantize: load model_quant.onnx
        # else: load model.onnx (若无则尝试导出)
        #
        # 但有些版本的 VAD 类可能硬编码 vad.onnx？
        # 看了源码，VAD 类其实也是遵循 model.onnx / model_quant.onnx 的。
        # 只有 config 和 mvn 是硬编码 vad.* 的。
        #
        # 为了保险起见，如果 vad.onnx 真的被引用了（某些旧版），我们也做个副本。
        # 但根据刚读到的源码：model_file = os.path.join(model_dir, 'model.onnx')
        # 所以只要有 model_quant.onnx 且启用了 quantize=True，应该就没问题。
        #
        # 这里暂时只处理 yaml 和 mvn。

    def _ensure_asr_compatibility(model_dir: str):
        """
        修复 ASR/Punc 模型配置文件兼容性问题。
        funasr_onnx 需要 config.yaml 中有 token_list 字段，
        但 ModelScope 下载的模型使用独立的 tokens.json 文件。
        对于标点模型，还需要把 model_conf.punc_list 复制到顶层。
        """
        if not model_dir or not os.path.exists(model_dir):
            return

        config_yaml = os.path.join(model_dir, "config.yaml")
        tokens_json = os.path.join(model_dir, "tokens.json")

        if not os.path.exists(config_yaml):
            return

        try:
            import yaml
            import json as json_module

            with open(config_yaml, "r", encoding="utf-8") as f:
                config = yaml.safe_load(f)

            if not config:
                return

            modified = False

            # 1. 添加 token_list（从 tokens.json 读取）
            if "token_list" not in config and os.path.exists(tokens_json):
                with open(tokens_json, "r", encoding="utf-8") as f:
                    tokens = json_module.load(f)
                if isinstance(tokens, list):
                    config["token_list"] = tokens
                    modified = True
                    sys.stderr.write(f"[FunASR Worker] Compatibility fix: added token_list ({len(tokens)} tokens)\n")

            # 2. 标点模型：复制 model_conf.punc_list 到顶层
            if "punc_list" not in config and "model_conf" in config:
                model_conf = config.get("model_conf", {})
                if isinstance(model_conf, dict) and "punc_list" in model_conf:
                    config["punc_list"] = model_conf["punc_list"].copy()
                    modified = True
                    sys.stderr.write(f"[FunASR Worker] Compatibility fix: added top-level punc_list\n")

            if modified:
                with open(config_yaml, "w", encoding="utf-8") as f:
                    yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
                sys.stderr.write(f"[FunASR Worker] Config file updated: {config_yaml}\n")
                sys.stderr.flush()

        except ImportError:
            sys.stderr.write(f"[FunASR Worker] Warning: yaml/json library not available for config fix\n")
        except Exception as e:
            sys.stderr.write(f"[FunASR Worker] Warning: failed to fix ASR config: {e}\n")

    vad_model_id = _normalize_model_id(vad_model_id, "VAD")
    online_model_id = _normalize_model_id(online_model_id, "Streaming ASR (Pass 1)")
    offline_model_id = _normalize_model_id(offline_model_id, "Offline ASR (Pass 2)")
    punc_model_id = _normalize_model_id(punc_model_id, "Punctuation")

    def _find_local_model(model_id: str, label: str, model_type: str = "asr") -> Optional[str]:
        """
        查找本地缓存的模型路径。
        无论是否离线模式，都会尝试查找。如果找到本地缓存，后续加载时直接使用本地路径。

        Args:
            model_id: 模型 ID
            label: 模型标签（用于日志）
            model_type: 模型类型 - "vad", "asr", "punc"
        """
        # 总是尝试查找本地缓存（不再限制只在离线模式）
        found = resolve_local_model_path(model_id, require_offline_mode=False)

        if found:
            # 根据模型类型应用不同的兼容性修复
            if model_type == "vad":
                _ensure_vad_compatibility(found)
            else:
                # ASR 和 Punc 模型都需要 token_list 和可能的 punc_list
                _ensure_asr_compatibility(found)

        if OFFLINE_MODE and not found:
            raise RuntimeError(
                f"Offline mode enabled (MODELSCOPE_OFFLINE=1) but required {label} model is not cached: {model_id}. "
                f"Please download the model first, or disable offline mode."
            )
        return found

    # 查找本地缓存（无论是否离线模式都会尝试）
    # 如果找到本地路径，后续加载时直接使用本地路径，避免联网查询
    vad_local_path = _find_local_model(vad_model_id, "VAD", model_type="vad")
    online_local_path = _find_local_model(online_model_id, "Streaming ASR (Pass 1)", model_type="asr")
    offline_local_path = _find_local_model(offline_model_id, "Offline ASR (Pass 2)", model_type="asr")
    punc_local_path = _find_local_model(punc_model_id, "Punctuation", model_type="punc")

    # 1. VAD 模型: 检测语音活动
    # 如果找到本地路径，直接使用；否则使用 model_id 让 funasr_onnx 自己下载/查找
    vad_model_path = vad_local_path or vad_model_id
    sys.stderr.write(
        f"[FunASR Worker] Loading VAD model: {vad_model_id}"
        + (f" (using local: {vad_local_path})" if vad_local_path else " (will download if needed)")
        + "...\n"
    )
    sys.stderr.flush()
    vad_model = Fsmn_vad(
        model_dir=vad_model_path,
        quantize=use_quantize,
        device_id=int(device_info.get("device_id", -1)),
    )

    # 2. Pass 1 流式模型: 快速出字
    online_model_path = online_local_path or online_model_id
    sys.stderr.write(
        f"[FunASR Worker] Loading streaming ASR model (Pass 1): {online_model_id}"
        + (f" (using local: {online_local_path})" if online_local_path else " (will download if needed)")
        + "...\n"
    )
    sys.stderr.flush()
    asr_online_model = ParaformerOnline(
        model_dir=online_model_path,
        batch_size=1,
        device_id=int(device_info.get("device_id", -1)),
        quantize=use_quantize,
        intra_op_num_threads=4
    )

    # 3. Pass 2 非流式模型: 高精度识别
    offline_model_path = offline_local_path or offline_model_id
    sys.stderr.write(
        f"[FunASR Worker] Loading offline ASR model (Pass 2): {offline_model_id}"
        + (f" (using local: {offline_local_path})" if offline_local_path else " (will download if needed)")
        + "...\n"
    )
    sys.stderr.flush()
    asr_offline_model = ParaformerOffline(
        model_dir=offline_model_path,
        batch_size=1,
        device_id=int(device_info.get("device_id", -1)),
        quantize=use_quantize,
        intra_op_num_threads=4
    )

    # 4. 标点模型: 给 Pass 2 结果加标点
    punc_model_path = punc_local_path or punc_model_id
    sys.stderr.write(
        f"[FunASR Worker] Loading punctuation model: {punc_model_id}"
        + (f" (using local: {punc_local_path})" if punc_local_path else " (will download if needed)")
        + "...\n"
    )
    sys.stderr.flush()
    punc_model = CT_Transformer(
        model_dir=punc_model_path,
        quantize=use_quantize,
        device_id=int(device_info.get("device_id", -1)),
        intra_op_num_threads=2
    )

    sys.stderr.write("[FunASR Worker] All models loaded successfully!\n")
    sys.stderr.write(f"[FunASR Worker] Configuration: model={model_id}, quantize={use_quantize}\n")
    sys.stderr.flush()

    return vad_model, asr_online_model, asr_offline_model, punc_model


def handle_streaming_chunk(
    vad_model,
    asr_online_model_template,
    asr_offline_model,
    punc_model,
    data: dict,
    sessions_cache: Dict[str, SessionState],
    online_models_cache: Dict[str, object],
):
    """
    处理流式音频块 - 2-Pass 架构
    
    Pass 1: 实时流式识别，快速返回 partial 结果
    Pass 2: 检测到句尾后，使用离线模型 + 标点进行高精度修正
    """
    request_id = data.get("request_id", "default")
    session_id = data.get("session_id", request_id)
    audio_data_b64 = data.get("audio_data")
    is_final = bool(data.get("is_final", False))
    timestamp_ms = data.get("timestamp", int(time.time() * 1000))

    if not audio_data_b64:
        send_ipc_message({"request_id": request_id, "error": "No audio_data provided"})
        return

    state = sessions_cache.setdefault(session_id, SessionState())
    audio_chunk = decode_audio_chunk(audio_data_b64)

    if audio_chunk.size == 0:
        return

    # 记录开始时间
    if not state.is_speaking and state.start_time == 0:
        state.start_time = time.time()

    # ==== VAD 检测 ====
    try:
        vad_segments = vad_model(audio_chunk)
        current_chunk_has_speech = len(vad_segments) > 0
    except Exception as e:
        sys.stderr.write(f"[FunASR Worker] VAD error: {e}\n")
        sys.stderr.flush()
        current_chunk_has_speech = True  # 出错时保守处理

    # ==== 状态管理 ====
    if current_chunk_has_speech:
        state.silence_counter = 0
        state.is_speaking = True
        state.full_sentence_buffer.append(audio_chunk)
    else:
        if state.is_speaking:
            state.silence_counter += 1
            # 保留一点静音段让音频更自然
            if state.silence_counter < SILENCE_BUFFER_KEEP:
                state.full_sentence_buffer.append(audio_chunk)

    # ==== Pass 1: 实时流式识别 ====
    if state.is_speaking:
        try:
            # 【关键修复】每个 session 使用独立的 online model（至少 frontend 缓存隔离）
            online_model = online_models_cache.get(session_id)
            if online_model is None:
                online_model = _clone_online_model_with_isolated_frontend(asr_online_model_template)
                online_models_cache[session_id] = online_model

            partial_res = online_model(
                audio_chunk,
                param_dict={"cache": state.online_cache, "is_final": False},
            )

            if partial_res:
                # 调试日志：查看实际返回的格式
                sys.stderr.write(f"[FunASR Worker][{WORKER_ID}][{session_id}] DEBUG partial_res type={type(partial_res).__name__}, value={str(partial_res)[:100]}\n")
                sys.stderr.flush()
                
                # funasr_onnx 返回格式可能是:
                # 1. [('text', ['chars'])] - 列表包含 tuple
                # 2. [{'preds': 'text'}] - 列表包含字典
                # 3. ('text', ['chars']) - 直接是 tuple
                text = ""
                
                # 先解包列表
                item = partial_res
                while isinstance(item, list) and len(item) > 0:
                    item = item[0]
                
                # 现在 item 应该是 tuple 或 dict 或 str
                if isinstance(item, dict):
                    preds_value = item.get("preds") or item.get("text") or ""
                    # 如果 preds 是 tuple，需要提取字符串
                    if isinstance(preds_value, tuple) and len(preds_value) > 0:
                        text = preds_value[0] if isinstance(preds_value[0], str) else str(preds_value[0])
                    elif isinstance(preds_value, str):
                        text = preds_value
                    else:
                        text = str(preds_value) if preds_value else ""
                elif isinstance(item, tuple) and len(item) > 0:
                    # Tuple 格式: ('text', ['chars']) - 取第一个元素
                    first_elem = item[0]
                    text = first_elem if isinstance(first_elem, str) else str(first_elem)
                elif isinstance(item, str):
                    text = item
                else:
                    text = str(item) if item else ""
                
                sys.stderr.write(f"[FunASR Worker][{WORKER_ID}][{session_id}] DEBUG extracted text=\"{text[:50]}...\"\n")
                sys.stderr.flush()
                
                if text:
                    # 使用智能拼接更新 streaming_text，解决流式输出不连续问题
                    new_streaming = smart_concat(state.streaming_text, text)
                    
                    if new_streaming != state.streaming_text:
                        state.streaming_text = new_streaming
                        send_ipc_message({
                            "request_id": request_id,
                            "session_id": session_id,
                            "type": "partial",
                            "text": state.streaming_text,
                            "full_text": state.streaming_text,
                            "timestamp": timestamp_ms,
                            "is_final": False,
                            "status": "success",
                            "language": "zh",
                            "worker_id": WORKER_ID,
                        })
                        state.last_sent_text = text
                        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}][{session_id}] 📝 PARTIAL: \"{state.streaming_text[-50:]}...\"\n")
                        sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[FunASR Worker] Pass 1 error: {e}\n")
            sys.stderr.flush()

    # ==== Pass 2: 检测到句尾，触发高精度修正 ====
    if state.is_speaking and state.silence_counter >= SILENCE_THRESHOLD_CHUNKS:
        _trigger_pass2(
            asr_offline_model,
            punc_model,
            state,
            request_id,
            session_id,
            timestamp_ms,
            trigger="silence",
            online_models_cache=online_models_cache,
        )

    # ==== 处理 is_final 标记 ====
    if is_final and state.full_sentence_buffer:
        _trigger_pass2(
            asr_offline_model,
            punc_model,
            state,
            request_id,
            session_id,
            timestamp_ms,
            trigger="final",
            online_models_cache=online_models_cache,
        )


def _trigger_pass2(
    asr_offline_model,
    punc_model,
    state: SessionState,
    request_id: str,
    session_id: str,
    timestamp_ms: int,
    trigger: str,
    online_models_cache: Optional[Dict[str, object]] = None,
):
    """
    触发 Pass 2: 离线高精度识别 + 标点 + 智能分句
    
    改进：使用标点模型结果进行智能分句，将长文本拆分成多个自然句子分别发送。
    """
    if not state.full_sentence_buffer:
        return

    sys.stderr.write(f"[FunASR Worker][{WORKER_ID}][{session_id}] Triggering Pass 2 ({trigger})...\n")
    sys.stderr.flush()

    try:
        # 合并音频片段
        complete_audio = np.concatenate(state.full_sentence_buffer)
        audio_duration = len(complete_audio) / SAMPLE_RATE

        # A. 非流式高精度识别
        offline_res = asr_offline_model(complete_audio)
        raw_text = ""
        if offline_res:
            # 解析返回值（可能是 tuple 或 dict）
            item = offline_res[0] if isinstance(offline_res, list) else offline_res
            if isinstance(item, dict):
                raw_text = item.get("preds") or item.get("text") or ""
            elif isinstance(item, (tuple, list)) and len(item) > 0:
                raw_text = item[0] if isinstance(item[0], str) else str(item[0])
            elif isinstance(item, str):
                raw_text = item
            else:
                raw_text = str(item) if item else ""

        if raw_text and len(raw_text) >= MIN_SENTENCE_CHARS:
            # B. 标点预测
            try:
                punc_res = punc_model(raw_text)
                # 解析标点模型返回值
                if punc_res:
                    punc_item = punc_res[0] if isinstance(punc_res, list) else punc_res
                    if isinstance(punc_item, str):
                        punctuated_text = punc_item
                    elif isinstance(punc_item, (tuple, list)) and len(punc_item) > 0:
                        punctuated_text = punc_item[0] if isinstance(punc_item[0], str) else str(punc_item[0])
                    else:
                        punctuated_text = str(punc_item) if punc_item else raw_text
                else:
                    punctuated_text = raw_text
            except Exception as e:
                sys.stderr.write(f"[FunASR Worker] Punctuation error: {e}\n")
                sys.stderr.flush()
                punctuated_text = raw_text

            sys.stderr.write(f"[FunASR Worker]    Raw: \"{raw_text}\"\n")
            sys.stderr.write(f"[FunASR Worker]    With punc: \"{punctuated_text}\"\n")
            sys.stderr.flush()

            # C. 智能分句：将长文本拆分成多个自然句子
            sentences = smart_split_sentences(punctuated_text)
            
            # 计算每个句子的大致时间分布
            total_chars = sum(len(s) for s in sentences)
            current_time = state.start_time * 1000 if state.start_time else timestamp_ms - (audio_duration * 1000)
            
            for i, sentence in enumerate(sentences):
                # 估算这个句子的时间范围
                sentence_ratio = len(sentence) / max(total_chars, 1)
                sentence_duration = audio_duration * sentence_ratio
                sentence_end_time = current_time + (sentence_duration * 1000)
                
                is_last = (i == len(sentences) - 1)
                
                sys.stderr.write(f"[FunASR Worker][{WORKER_ID}][{session_id}] 🎯 SENTENCE [{i+1}/{len(sentences)}]: \"{sentence[:50]}...\"\n")
                sys.stderr.flush()

                send_ipc_message({
                    "request_id": request_id,
                    "session_id": session_id,
                    "type": "sentence_complete",
                    "text": sentence,
                    "raw_text": raw_text if i == 0 else "",  # 只在第一句附带原始文本
                    "timestamp": int(sentence_end_time),
                    "is_final": is_last,
                    "status": "success",
                    "language": "zh",
                    "audio_duration": sentence_duration,
                    "trigger": trigger,
                    "start_time": int(current_time),
                    "end_time": int(sentence_end_time),
                    "sentence_index": i,
                    "total_sentences": len(sentences),
                    "worker_id": WORKER_ID,
                })
                
                current_time = sentence_end_time

    except Exception as e:
        sys.stderr.write(f"[FunASR Worker] Pass 2 error: {e}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()

    # 重置状态，准备下一句
    state.reset()

    # 同步重置 Pass 1 的前端缓存（非常关键）
    # - state.reset() 只清掉了 state.online_cache（cif/decoder_fsmn 等）
    # - 但 funasr_onnx 的 WavFrontendOnline 还有 reserve_waveforms/input_cache/lfr_splice_cache 等内部缓存
    #   若不重置，会导致下一句/下一段仍然“吃到旧音频”，并在多 session 场景下更容易串线
    if online_models_cache is not None:
        try:
            online_model = online_models_cache.get(session_id)
            frontend = getattr(online_model, "frontend", None) if online_model is not None else None
            if frontend is not None and hasattr(frontend, "cache_reset"):
                frontend.cache_reset()
        except Exception:
            pass


def handle_force_commit(
    asr_offline_model,
    punc_model,
    data: dict,
    sessions_cache: Dict[str, SessionState],
    online_models_cache: Dict[str, object],
):
    """强制提交当前句子"""
    request_id = data.get("request_id", "default")
    session_id = data.get("session_id", request_id)
    timestamp_ms = int(time.time() * 1000)

    sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] force_commit received for session={session_id}\n")
    sys.stderr.flush()

    state = sessions_cache.get(session_id)
    if not state:
        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] No session state found for session={session_id}\n")
        sys.stderr.flush()
        return

    # 如果有缓冲的音频，触发 Pass 2
    if state.full_sentence_buffer:
        _trigger_pass2(
            asr_offline_model,
            punc_model,
            state,
            request_id,
            session_id,
            timestamp_ms,
            trigger="force_commit",
            online_models_cache=online_models_cache,
        )
    elif state.streaming_text and len(state.streaming_text) >= MIN_SENTENCE_CHARS:
        # 没有缓冲的音频，但有流式文本，直接提交流式文本
        send_ipc_message({
            "request_id": request_id,
            "session_id": session_id,
            "type": "sentence_complete",
            "text": state.streaming_text,
            "timestamp": timestamp_ms,
            "is_final": True,
            "status": "success",
            "trigger": "force_commit_text_only",
            "language": "zh",
            "audio_duration": 0,
            "worker_id": WORKER_ID,
        })
        state.reset()
        # 同样重置 online 前端缓存
        try:
            online_model = online_models_cache.get(session_id)
            frontend = getattr(online_model, "frontend", None) if online_model is not None else None
            if frontend is not None and hasattr(frontend, "cache_reset"):
                frontend.cache_reset()
        except Exception:
            pass
    else:
        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] force_commit: no content to commit\n")
        sys.stderr.flush()


def handle_batch_file(asr_offline_model, punc_model, data: dict):
    """处理批量文件识别"""
    request_id = data.get("request_id", "unknown")
    audio_path = data.get("audio_path")

    if not audio_path:
        send_ipc_message({"request_id": request_id, "error": "No audio_path provided"})
        return
    if not os.path.exists(audio_path):
        send_ipc_message({"request_id": request_id, "error": f"File not found: {audio_path}"})
        return

    try:
        # 读取音频文件
        import wave
        with wave.open(audio_path, 'rb') as wf:
            audio_data = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
            audio_float = audio_data.astype(np.float32)

        # 离线识别
        offline_res = asr_offline_model(audio_float)
        raw_text = ""
        if offline_res:
            # 解析返回值（可能是 tuple 或 dict）
            item = offline_res[0] if isinstance(offline_res, list) else offline_res
            if isinstance(item, dict):
                raw_text = item.get("preds") or item.get("text") or ""
            elif isinstance(item, (tuple, list)) and len(item) > 0:
                raw_text = item[0] if isinstance(item[0], str) else str(item[0])
            elif isinstance(item, str):
                raw_text = item
            else:
                raw_text = str(item) if item else ""

        # 标点
        if raw_text:
            try:
                punc_res = punc_model(raw_text)
                # 解析标点模型返回值
                if punc_res:
                    punc_item = punc_res[0] if isinstance(punc_res, list) else punc_res
                    if isinstance(punc_item, str):
                        final_text = punc_item
                    elif isinstance(punc_item, (tuple, list)) and len(punc_item) > 0:
                        final_text = punc_item[0] if isinstance(punc_item[0], str) else str(punc_item[0])
                    else:
                        final_text = str(punc_item) if punc_item else raw_text
                else:
                    final_text = raw_text
            except Exception:
                final_text = raw_text
        else:
            final_text = ""

        send_ipc_message({
            "request_id": request_id,
            "text": final_text,
            "raw_text": raw_text,
            "language": "zh",
            "status": "success",
        })

    except Exception as exc:
        send_ipc_message({
            "request_id": request_id,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        })


def main():
    try:
        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] Starting FunASR 2-Pass Worker...\n")
        sys.stderr.flush()

        # 加载模型
        vad_model, asr_online_model_template, asr_offline_model, punc_model = load_funasr_onnx_models()

        sessions_cache: Dict[str, SessionState] = {}
        # 每个 session 一份独立的 online model（主要是隔离 WavFrontendOnline 内部缓存）
        # 但通过 _clone_online_model_with_isolated_frontend 共享 ORT session，避免重复加载权重
        online_models_cache: Dict[str, object] = {}
        send_ipc_message({"status": "ready", "worker_id": WORKER_ID})

        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] Ready! 2-Pass mode enabled. This worker is dedicated to one audio source.\n")
        sys.stderr.flush()

        while True:
            line = sys.stdin.readline()
            if not line:
                break

            try:
                data = json.loads(line)
            except json.JSONDecodeError as exc:
                send_ipc_message({"request_id": "unknown", "error": f"Invalid JSON: {exc}"})
                continue

            request_type = data.get("type")
            request_id = data.get("request_id", "default")
            session_id = data.get("session_id", request_id)

            if request_type == "reset_session":
                sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] Resetting session: {session_id}\n")
                sys.stderr.flush()
                sessions_cache.pop(session_id, None)
                online_models_cache.pop(session_id, None)
                continue

            if request_type == "force_commit":
                handle_force_commit(asr_offline_model, punc_model, data, sessions_cache, online_models_cache)
                continue

            if request_type == "streaming_chunk":
                handle_streaming_chunk(
                    vad_model,
                    asr_online_model_template,
                    asr_offline_model,
                    punc_model,
                    data,
                    sessions_cache,
                    online_models_cache,
                )
                continue

            if request_type == "batch_file" or "audio_path" in data:
                handle_batch_file(asr_offline_model, punc_model, data)
                continue

            send_ipc_message({
                "request_id": request_id,
                "error": f"Unknown request type: {request_type}",
            })

    except Exception as exc:
        sys.stderr.write(f"[FunASR Worker][{WORKER_ID}] Fatal error: {exc}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        send_ipc_message({"status": "fatal", "error": str(exc), "worker_id": WORKER_ID})
        sys.exit(1)


if __name__ == "__main__":
    main()
