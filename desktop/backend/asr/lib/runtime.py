import base64
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np


def smart_concat(history: str, new_text: str) -> str:
    """
    智能拼接流式文本：处理增量、全量、重叠等情况。
    """
    if not new_text:
        return history
    if not history:
        return new_text

    if new_text.startswith(history):
        return new_text
    if history.endswith(new_text):
        return history

    overlap_len = min(len(history), len(new_text))
    for i in range(overlap_len, 0, -1):
        if history.endswith(new_text[:i]):
            return history + new_text[i:]

    return history + new_text


def smart_split_sentences(text: str, min_sentence_chars: int = 2) -> List[str]:
    """
    智能分句：基于标点符号将长文本切分成自然的句子。
    """
    if not text or len(text) < min_sentence_chars:
        return [text] if text else []

    sentence_endings = "。！？!?."
    sentences: List[str] = []
    current_sentence = ""

    for char in text:
        current_sentence += char
        if char in sentence_endings:
            trimmed = current_sentence.strip()
            if trimmed and len(trimmed) >= min_sentence_chars:
                sentences.append(trimmed)
            elif trimmed and sentences:
                sentences[-1] += trimmed
            elif trimmed:
                sentences.append(trimmed)
            current_sentence = ""

    remaining = current_sentence.strip()
    if remaining:
        if len(remaining) < min_sentence_chars and sentences:
            sentences[-1] += remaining
        else:
            sentences.append(remaining)

    return sentences if sentences else [text]


def decode_audio_chunk(audio_b64: str) -> np.ndarray:
    """Base64 音频转 float32 numpy array（范围 -1~1）。"""
    audio_bytes = base64.b64decode(audio_b64)
    audio_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
    return audio_int16.astype(np.float32)


@dataclass
class SessionState:
    """
    FunASR 2-Pass 会话状态
    """

    full_sentence_buffer: List[np.ndarray] = field(default_factory=list)
    online_cache: Dict = field(default_factory=dict)
    silence_counter: int = 0
    is_speaking: bool = False
    streaming_text: str = ""
    last_sent_text: str = ""
    start_time: float = 0.0

    def reset(self):
        self.full_sentence_buffer.clear()
        self.online_cache.clear()
        self.silence_counter = 0
        self.is_speaking = False
        self.streaming_text = ""
        self.last_sent_text = ""
        self.start_time = 0.0
