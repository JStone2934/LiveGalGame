#!/usr/bin/env python3
"""
下载 FunASR ONNX 模型（从 ModelScope）。
自动处理文件名兼容性问题。
"""
import os
import sys
import json
import argparse
import traceback

# ==============================================================================
# OS 级别的文件描述符重定向，防止库的日志污染 stdout
# ==============================================================================
try:
    ipc_fd = os.dup(sys.stdout.fileno())
    ipc_channel = os.fdopen(ipc_fd, "w", buffering=1, encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
except Exception:
    ipc_channel = sys.stdout

def emit(event, **payload):
    """发送 JSON 消息到 Node.js"""
    try:
        data = {"event": event}
        data.update(payload)
        ipc_channel.write(json.dumps(data, ensure_ascii=False) + "\n")
        ipc_channel.flush()
    except Exception as exc:
        sys.stderr.write(f"[IPC Error] Failed to send: {exc}\n")
        sys.stderr.flush()

# ==============================================================================
# 模型配置：ModelScope 仓库和文件名映射
# ==============================================================================
MODEL_CONFIG = {
    "vad": {
        "repo": "damo/speech_fsmn_vad_zh-cn-16k-common-onnx",
        # ModelScope 使用 config.yaml/am.mvn，funasr_onnx 期望 vad.yaml/vad.mvn
        "file_mappings": {"config.yaml": "vad.yaml", "am.mvn": "vad.mvn"},
    },
    "online": {
        "repo": "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx",
        "file_mappings": {"config.yaml": "asr.yaml", "am.mvn": "asr.mvn"},
    },
    "offline": {
        "repo": "damo/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-onnx",
        "file_mappings": {"config.yaml": "asr.yaml", "am.mvn": "asr.mvn"},
    },
    "punc": {
        "repo": "damo/punc_ct-transformer_zh-cn-common-vocab272727-onnx",
        "file_mappings": {"config.yaml": "punc.yaml"},
    },
}

def create_compat_symlinks(model_dir, file_mappings):
    """创建文件名兼容符号链接"""
    if not os.path.isdir(model_dir):
        return

    for src_name, dst_name in file_mappings.items():
        src_path = os.path.join(model_dir, src_name)
        dst_path = os.path.join(model_dir, dst_name)

        if os.path.exists(src_path) and not os.path.exists(dst_path):
            try:
                os.symlink(src_name, dst_path)
                sys.stderr.write(f"[FunASR] 创建兼容链接: {src_name} -> {dst_name}\n")
            except OSError:
                try:
                    import shutil
                    shutil.copy2(src_path, dst_path)
                    sys.stderr.write(f"[FunASR] 复制兼容文件: {src_name} -> {dst_name}\n")
                except Exception as e:
                    sys.stderr.write(f"[FunASR] 警告: 无法创建 {dst_name}: {e}\n")


def fix_vad_config_compatibility(model_dir):
    """
    修复 VAD 配置文件兼容性问题。
    funasr_onnx 的 Fsmn_vad 类需要 config.yaml 中有 vad_post_conf 字段，
    但 ModelScope 下载的模型使用的是 model_conf 字段。
    """
    config_path = os.path.join(model_dir, "config.yaml")
    if not os.path.exists(config_path):
        return

    try:
        import yaml
    except ImportError:
        sys.stderr.write("[FunASR] 警告: yaml 库未安装，无法修复 VAD 配置兼容性\n")
        return

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)

        if not config:
            return

        # 检查是否需要修复
        if "vad_post_conf" in config:
            return  # 已有 vad_post_conf，无需修复

        if "model_conf" not in config:
            return  # 没有 model_conf，无法修复

        # 复制 model_conf 为 vad_post_conf
        config["vad_post_conf"] = config["model_conf"].copy()

        # 写回配置文件
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(config, f, default_flow_style=False, allow_unicode=True)

        sys.stderr.write(f"[FunASR] 已修复 VAD 配置文件: 添加 vad_post_conf\n")
    except Exception as e:
        sys.stderr.write(f"[FunASR] 警告: 修复 VAD 配置失败: {e}\n")


def fix_asr_config_compatibility(model_dir):
    """
    修复 ASR/Punc 模型配置文件兼容性问题。
    funasr_onnx 需要 config.yaml 中有 token_list 字段，
    但 ModelScope 下载的模型使用独立的 tokens.json 文件。
    对于标点模型，还需要把 model_conf.punc_list 复制到顶层。
    """
    config_path = os.path.join(model_dir, "config.yaml")
    tokens_path = os.path.join(model_dir, "tokens.json")

    if not os.path.exists(config_path):
        return

    try:
        import yaml
    except ImportError:
        sys.stderr.write("[FunASR] 警告: yaml 库未安装，无法修复 ASR 配置兼容性\n")
        return

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)

        if not config:
            return

        modified = False

        # 1. 添加 token_list（从 tokens.json 读取）
        if "token_list" not in config and os.path.exists(tokens_path):
            with open(tokens_path, "r", encoding="utf-8") as f:
                tokens = json.load(f)
            if isinstance(tokens, list):
                config["token_list"] = tokens
                modified = True
                sys.stderr.write(f"[FunASR] 已添加 token_list ({len(tokens)} tokens)\n")

        # 2. 标点模型：复制 model_conf.punc_list 到顶层
        if "punc_list" not in config and "model_conf" in config:
            model_conf = config.get("model_conf", {})
            if "punc_list" in model_conf:
                config["punc_list"] = model_conf["punc_list"].copy()
                modified = True
                sys.stderr.write(f"[FunASR] 已添加顶层 punc_list\n")

        # 写回配置文件
        if modified:
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
            sys.stderr.write(f"[FunASR] 配置文件已更新\n")
    except Exception as e:
        sys.stderr.write(f"[FunASR] 警告: 修复 ASR 配置失败: {e}\n")

def download_model(repo_id, cache_dir=None):
    """从 ModelScope 下载模型"""
    try:
        from modelscope.hub.snapshot_download import snapshot_download
    except ImportError:
        raise ImportError("modelscope 库未安装。请运行: pip install modelscope")
    
    sys.stderr.write(f"[FunASR] 从 ModelScope 下载: {repo_id}\n")
    return snapshot_download(repo_id, cache_dir=cache_dir)

def verify_model(model_type, model_dir, use_quantize=True):
    """验证模型是否可加载"""
    try:
        if model_type == "vad":
            from funasr_onnx.vad_bin import Fsmn_vad
            Fsmn_vad(model_dir=model_dir, quantize=use_quantize)
        elif model_type == "online":
            from funasr_onnx.paraformer_online_bin import Paraformer
            Paraformer(model_dir=model_dir, batch_size=1, quantize=use_quantize, intra_op_num_threads=1)
        elif model_type == "offline":
            from funasr_onnx.paraformer_bin import Paraformer
            Paraformer(model_dir=model_dir, batch_size=1, quantize=use_quantize, intra_op_num_threads=1)
        elif model_type == "punc":
            from funasr_onnx.punc_bin import CT_Transformer
            CT_Transformer(model_dir=model_dir, quantize=use_quantize, intra_op_num_threads=1)
        return True
    except Exception as e:
        sys.stderr.write(f"[FunASR] 模型验证失败 ({model_type}): {e}\n")
        return False

def main():
    parser = argparse.ArgumentParser(description="下载 FunASR ONNX 模型")
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--cache-dir", required=False)
    parser.add_argument("--source", default="modelscope", help="(已废弃，仅保留兼容)")
    args = parser.parse_args()

    # 设置缓存目录
    cache_base = None
    cache_hub = None
    if args.cache_dir:
        raw = os.path.abspath(args.cache_dir)
        if os.path.basename(raw).lower() == "hub":
            cache_base = os.path.dirname(raw)
            cache_hub = raw
        else:
            cache_base = raw
            cache_hub = os.path.join(raw, "hub")
    else:
        cache = os.environ.get("MODELSCOPE_CACHE") or os.environ.get("MODELSCOPE_CACHE_HOME")
        if cache:
            raw = os.path.abspath(cache)
            if os.path.basename(raw).lower() == "hub":
                cache_base = os.path.dirname(raw)
                cache_hub = raw
            else:
                cache_base = raw
                cache_hub = os.path.join(raw, "hub")

    if cache_base:
        os.environ["MODELSCOPE_CACHE"] = cache_base
        os.environ["MODELSCOPE_CACHE_HOME"] = cache_base
        os.makedirs(cache_base, exist_ok=True)
        os.makedirs(cache_hub, exist_ok=True) if cache_hub else None

    actual_model_dir = os.path.join(cache_hub or cache_base or os.path.expanduser("~/.cache/modelscope/hub"), "models")
    
    emit("manifest", modelId=args.model_id, message="准备从 ModelScope 下载 FunASR 模型", downloadPath=actual_model_dir)
    sys.stderr.write(f"[FunASR] 模型将下载到: {actual_model_dir}\n")

    try:
        import funasr_onnx
    except ImportError:
        emit("error", modelId=args.model_id, message="funasr_onnx 库未安装")
        sys.exit(1)

    model_types = ["vad", "online", "offline", "punc"]
    downloaded = {}
    
    try:
        for idx, model_type in enumerate(model_types, 1):
            config = MODEL_CONFIG[model_type]
            repo = config["repo"]
            
            emit("manifest", modelId=args.model_id, message=f"下载 {model_type.upper()} ({idx}/{len(model_types)}): {repo}")
            
            try:
                local_dir = download_model(repo, cache_dir=cache_base)
                create_compat_symlinks(local_dir, config.get("file_mappings", {}))

                # VAD 模型需要额外的配置文件兼容性修复
                if model_type == "vad":
                    fix_vad_config_compatibility(local_dir)
                # ASR 和 Punc 模型需要 token_list 兼容性修复
                elif model_type in ("online", "offline", "punc"):
                    fix_asr_config_compatibility(local_dir)

                if verify_model(model_type, local_dir):
                    sys.stderr.write(f"[FunASR] {model_type.upper()} ✓ {local_dir}\n")
                    downloaded[model_type] = local_dir
                else:
                    sys.stderr.write(f"[FunASR] {model_type.upper()} 验证失败\n")
            except Exception as e:
                sys.stderr.write(f"[FunASR] {model_type.upper()} 下载失败: {e}\n")
                emit("warning", modelId=args.model_id, message=f"{model_type.upper()} 下载失败: {e}")

        required = ["vad", "online", "offline"]
        missing = [m for m in required if m not in downloaded]
        
        if missing:
            emit("error", modelId=args.model_id, message=f"必需模型下载失败: {', '.join(missing)}")
            sys.exit(1)

        emit("completed", modelId=args.model_id, message="FunASR 模型下载完成", localDir=actual_model_dir)
        sys.stderr.write(f"[FunASR] 下载完成! 位置: {actual_model_dir}\n")
        
    except Exception as e:
        emit("error", modelId=args.model_id, message=str(e), traceback=traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    main()
