import os
from dataclasses import dataclass, field
from typing import List


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


def detect_onnx_device(asr_device: str = "auto", asr_device_id: int = 0) -> dict:
    """
    检测 onnxruntime 可用 provider，并选择推理设备。

    说明：
    - funasr_onnx 的模型构造函数一般通过 device_id 控制：-1 为 CPU；>=0 尝试使用 GPU。
    - 实际走哪种 GPU 取决于安装的 onnxruntime 版本提供的 provider：
      * CUDAExecutionProvider (onnxruntime-gpu) -> NVIDIA
      * ROCMExecutionProvider (onnxruntime-rocm) -> AMD/ROCm
      * DmlExecutionProvider (onnxruntime-directml) -> Windows 上 AMD/NVIDIA/Intel
    """
    forced = (asr_device or "auto").strip().lower()
    device_id = asr_device_id

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


def detect_gpu(asr_device: str = "auto", asr_device_id: int = 0) -> GPUConfig:
    """
    兼容接口：返回 GPUConfig，供 test 脚本调用。
    """
    info = detect_onnx_device(asr_device, asr_device_id)
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


def env_device_config():
    """
    读取环境变量，返回 (ASR_DEVICE, ASR_DEVICE_ID)。
    """
    asr_device = os.environ.get("ASR_DEVICE", "auto").strip().lower()
    asr_device_id = int(os.environ.get("ASR_DEVICE_ID", "0"))
    return asr_device, asr_device_id
