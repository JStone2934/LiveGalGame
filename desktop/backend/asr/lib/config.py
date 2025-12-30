import os
import sys
from dataclasses import dataclass
from typing import Optional

from .device import env_device_config


@dataclass
class ASRRuntimeConfig:
    worker_id: str
    offline_mode: bool
    sample_rate: int
    chunk_ms: int
    silence_threshold_chunks: int
    silence_buffer_keep: int
    min_sentence_chars: int
    asr_device: str
    asr_device_id: int
    modelscope_cache: Optional[str]
    asr_cache_dir: Optional[str]
    asr_model: str



def _get_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except Exception:
        return default


def _get_bool(name: str) -> bool:
    return os.environ.get(name, "").lower() in ("1", "true", "yes")


def load_runtime_config() -> ASRRuntimeConfig:
    asr_device, asr_device_id = env_device_config()
    return ASRRuntimeConfig(
        worker_id=os.environ.get("FUNASR_WORKER_ID", "default"),
        offline_mode=_get_bool("MODELSCOPE_OFFLINE"),
        sample_rate=_get_int("ASR_SAMPLE_RATE", 16000),
        chunk_ms=_get_int("ASR_CHUNK_MS", 200),
        silence_threshold_chunks=_get_int("ASR_SILENCE_CHUNKS", 3),
        silence_buffer_keep=_get_int("ASR_SILENCE_BUFFER_KEEP", 2),
        min_sentence_chars=_get_int("MIN_SENTENCE_CHARS", 2),
        asr_device=asr_device,
        asr_device_id=asr_device_id,
        modelscope_cache=os.environ.get("MODELSCOPE_CACHE") or os.environ.get("MODELSCOPE_CACHE_HOME"),
        asr_cache_dir=os.environ.get("ASR_CACHE_DIR"),
        asr_model=os.environ.get("ASR_MODEL", "funasr-paraformer"),
    )


def log_runtime_config(config: ASRRuntimeConfig, stream=sys.stderr) -> None:
    try:
        stream.write(
            "[FunASR Worker] Effective config: "
            + str({
                "worker_id": config.worker_id,
                "offline_mode": config.offline_mode,
                "sample_rate": config.sample_rate,
                "chunk_ms": config.chunk_ms,
                "silence_threshold_chunks": config.silence_threshold_chunks,
                "silence_buffer_keep": config.silence_buffer_keep,
                "min_sentence_chars": config.min_sentence_chars,
                "asr_device": config.asr_device,
                "asr_device_id": config.asr_device_id,
                "modelscope_cache": config.modelscope_cache or "",
                "asr_cache_dir": config.asr_cache_dir or "",
                "asr_model": config.asr_model,
            })
            + "\n"
        )
        stream.flush()
    except Exception:
        pass
