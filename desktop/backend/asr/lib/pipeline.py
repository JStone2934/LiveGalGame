import os
import sys
import platform
from typing import Optional

from .device import detect_onnx_device, GPUConfig
from .cache import (
    resolve_local_model_path,
    ensure_vad_compatibility,
    ensure_asr_compatibility,
    ensure_punc_yaml,
)


def load_funasr_onnx_models(
    worker_id: str,
    asr_device: str,
    asr_device_id: int,
    offline_mode: bool,
    gpu_config: Optional[GPUConfig] = None,
):
    """
    加载 funasr_onnx 模型 (VAD + 流式ASR + 离线ASR + 标点)

    支持的环境变量:
    - ASR_MODEL: 模型 ID (默认 funasr-paraformer)
    - FUNASR_*_MODEL: 各子模型的覆盖
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

    model_id = os.environ.get("ASR_MODEL", "funasr-paraformer")

    device_info = detect_onnx_device(asr_device, asr_device_id)
    if gpu_config is not None:
        try:
            device_info = {
                "device": getattr(gpu_config, "device_type", "cpu"),
                "device_id": int(getattr(gpu_config, "device_id", -1)),
                "provider": getattr(gpu_config, "provider_name", "CPUExecutionProvider"),
                "providers": list(getattr(gpu_config, "providers", []) or []),
            }
        except Exception:
            device_info = detect_onnx_device(asr_device, asr_device_id)

    quantize_env = os.environ.get("ASR_QUANTIZE", "").lower()
    if quantize_env in ("false", "0", "no"):
        sys.stderr.write(
            "[FunASR Worker] Warning: ASR_QUANTIZE=false requested, but ModelScope ONNX models only provide quantized versions.\n"
            "[FunASR Worker] Forcing quantize=True to avoid export failure.\n"
        )
        sys.stderr.flush()
        use_quantize = True
    else:
        use_quantize = True

    sys.stderr.write(f"[FunASR Worker] Model ID: {model_id}\n")
    sys.stderr.write(f"[FunASR Worker] Use Quantize: {use_quantize} (ONNX repo only provides quantized models)\n")
    sys.stderr.write(f"[FunASR Worker] Offline mode: {offline_mode}\n")
    sys.stderr.write(f"[FunASR Worker] Host: {platform.system()} {platform.release()} ({platform.machine()})\n")
    sys.stderr.write(f"[FunASR Worker] ASR_DEVICE={asr_device}, ASR_DEVICE_ID={asr_device_id}\n")
    sys.stderr.write(f"[FunASR Worker] ONNX Runtime providers: {device_info.get('providers')}\n")
    sys.stderr.write(
        "[FunASR Worker] Inference device selection: "
        f"device={device_info.get('device')}, device_id={device_info.get('device_id')}, provider={device_info.get('provider')}\n"
    )
    sys.stderr.flush()

    # 子模型 ID（可通过环境变量覆盖）
    vad_model_id = os.environ.get("FUNASR_VAD_MODEL", "damo/speech_fsmn_vad_zh-cn-16k-common-onnx")
    online_model_id = os.environ.get(
        "FUNASR_ONLINE_MODEL", "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx"
    )
    offline_model_id = os.environ.get(
        "FUNASR_OFFLINE_MODEL", "damo/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-onnx"
    )
    punc_model_id = os.environ.get("FUNASR_PUNC_MODEL", "damo/punc_ct-transformer_zh-cn-common-vocab272727-onnx")

    def _normalize_model_id(value: str, label: str) -> str:
        if not value:
            return value
        if "/" in value and not (":" in value or value.startswith("\\") or value.startswith("/")):
            return value
        try:
            norm = os.path.normpath(value)
            parts = [p for p in norm.split(os.sep) if p]
            if "models" in parts:
                idx = parts.index("models")
                if idx + 2 < len(parts):
                    org = parts[idx + 1]
                    model = parts[idx + 2]
                    inferred = f"{org}/{model}"
                    sys.stderr.write(f"[FunASR Worker] Normalized {label} from local path to model id: {inferred}\n")
                    sys.stderr.flush()
                    return inferred
            if "damo" in parts:
                idx = parts.index("damo")
                if idx + 1 < len(parts):
                    inferred = f"damo/{parts[idx + 1]}"
                    sys.stderr.write(f"[FunASR Worker] Normalized {label} from local path to model id: {inferred}\n")
                    sys.stderr.flush()
                    return inferred
        except Exception:
            pass
        return value

    vad_model_id = _normalize_model_id(vad_model_id, "VAD")
    online_model_id = _normalize_model_id(online_model_id, "Streaming ASR (Pass 1)")
    offline_model_id = _normalize_model_id(offline_model_id, "Offline ASR (Pass 2)")
    punc_model_id = _normalize_model_id(punc_model_id, "Punctuation")

    def _find_local_model(model_id: str, label: str, model_type: str = "asr") -> Optional[str]:
        found = resolve_local_model_path(model_id, require_offline_mode=False, offline_mode=offline_mode)
        if found:
            if model_type == "vad":
                ensure_vad_compatibility(found)
            elif model_type == "punc":
                ensure_asr_compatibility(found)
                ensure_punc_yaml(found)
            else:
                ensure_asr_compatibility(found)
        if offline_mode and not found:
            raise RuntimeError(
                f"Offline mode enabled (MODELSCOPE_OFFLINE=1) but required {label} model is not cached: {model_id}. "
                f"Please download the model first, or disable offline mode."
            )
        return found

    vad_local_path = _find_local_model(vad_model_id, "VAD", model_type="vad")
    online_local_path = _find_local_model(online_model_id, "Streaming ASR (Pass 1)", model_type="asr")
    offline_local_path = _find_local_model(offline_model_id, "Offline ASR (Pass 2)", model_type="asr")
    punc_local_path = _find_local_model(punc_model_id, "Punctuation", model_type="punc")

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
    sys.stderr.flush()

    return vad_model, asr_online_model, asr_offline_model, punc_model, device_info
