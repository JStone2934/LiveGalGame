import json
import sys


# Capture original stdout for IPC before any redirection.
_ipc_channel = sys.stdout


def set_ipc_channel(channel):
    """Override IPC output channel (e.g., original stdout before redirection)."""
    global _ipc_channel
    _ipc_channel = channel


def send_ipc_message(data):
    """发送 JSON 消息到 Node.js"""
    try:
        channel = _ipc_channel or sys.stdout
        channel.write(json.dumps(data, ensure_ascii=False) + "\n")
        channel.flush()
    except Exception as exc:
        sys.stderr.write(f"[IPC Error] Failed to send: {exc}\n")
        sys.stderr.flush()
