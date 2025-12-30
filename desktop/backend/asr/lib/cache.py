import os
import sys
from typing import Optional


def resolve_local_model_path(model_id: str, require_offline_mode: bool = True, offline_mode: bool = False) -> Optional[str]:
    """
    解析本地模型路径。检查 MODELSCOPE_CACHE、ASR_CACHE_DIR 和默认 ~/.cache/modelscope。
    require_offline_mode=True 时仅在离线模式下返回结果（与旧逻辑兼容）。
    """
    if require_offline_mode and not offline_mode:
        return None

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

    cache_bases = list(dict.fromkeys(cache_bases))

    # ModelScope 同一个模型在不同版本可能落在 damo/ 或 iic/ 命名空间
    # 这里做一次别名尝试，避免缓存存在却因前缀不同找不到
    alt_ids = [model_id]
    if "/" in model_id:
        ns, rest = model_id.split("/", 1)
        if ns == "damo":
            alt_ids.append(f"iic/{rest}")
        elif ns == "iic":
            alt_ids.append(f"damo/{rest}")

    for cache_dir in cache_bases:
        if not cache_dir:
            continue

        for mid in alt_ids:
            candidates = [
                os.path.join(cache_dir, "hub", "models", mid),
                os.path.join(cache_dir, mid),
                os.path.join(cache_dir, "models", mid),
                os.path.join(cache_dir, "hub", mid),
                os.path.join(cache_dir, "modelscope", "hub", "models", mid),
                os.path.join(cache_dir, "modelscope", "models", mid),
                os.path.join(cache_dir, "modelscope", mid),
            ]

            for candidate in candidates:
                if os.path.isdir(candidate):
                    try:
                        files = os.listdir(candidate)
                        if any(f.endswith(('.onnx', '.bin', '.json', '.yaml')) for f in files):
                            sys.stderr.write(f"[FunASR Worker] Found local model: {candidate}\n")
                            sys.stderr.flush()
                            return candidate
                    except Exception:
                        continue

    return None


def ensure_vad_compatibility(model_dir: str):
    """
    修复 funasr_onnx VAD 模型的兼容性问题：
    - config.yaml -> vad.yaml
    - am.mvn -> vad.mvn
    - 缺少 vad_post_conf 时，从 model_conf 复制（同时写入 config.yaml 与 vad.yaml）
    """
    if not model_dir or not os.path.exists(model_dir):
        return

    import shutil
    import yaml

    vad_yaml = os.path.join(model_dir, "vad.yaml")
    config_yaml = os.path.join(model_dir, "config.yaml")

    if not os.path.exists(vad_yaml) and os.path.exists(config_yaml):
        try:
            sys.stderr.write(f"[FunASR Worker] Compatibility fix: copying config.yaml to vad.yaml...\n")
            shutil.copy2(config_yaml, vad_yaml)
        except Exception as e:
            sys.stderr.write(f"[FunASR Worker] Warning: failed to copy vad.yaml: {e}\n")

    vad_mvn = os.path.join(model_dir, "vad.mvn")
    am_mvn = os.path.join(model_dir, "am.mvn")

    if not os.path.exists(vad_mvn) and os.path.exists(am_mvn):
        try:
            sys.stderr.write(f"[FunASR Worker] Compatibility fix: copying am.mvn to vad.mvn...\n")
            shutil.copy2(am_mvn, vad_mvn)
        except Exception as e:
            sys.stderr.write(f"[FunASR Worker] Warning: failed to copy vad.mvn: {e}\n")

    config = None
    if os.path.exists(config_yaml):
        try:
            with open(config_yaml, "r", encoding="utf-8") as f:
                config = yaml.safe_load(f)

            if config and "model_conf" in config and "vad_post_conf" not in config:
                config["vad_post_conf"] = config["model_conf"].copy()
                with open(config_yaml, "w", encoding="utf-8") as f:
                    yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
                sys.stderr.write(f"[FunASR Worker] Compatibility fix: added vad_post_conf to config.yaml\n")
                sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[FunASR Worker] Warning: failed to fix vad_post_conf in config.yaml: {e}\n")

    # funasr_onnx 某些版本读取 vad.yaml，此文件也需要包含 vad_post_conf
    if os.path.exists(vad_yaml):
        try:
            with open(vad_yaml, "r", encoding="utf-8") as f:
                vad_conf = yaml.safe_load(f) or {}
            if isinstance(vad_conf, dict) and "vad_post_conf" not in vad_conf:
                source_conf = None
                if config and "vad_post_conf" in config:
                    source_conf = config["vad_post_conf"]
                elif config and "model_conf" in config:
                    source_conf = config["model_conf"]
                if source_conf:
                    vad_conf["vad_post_conf"] = source_conf.copy()
                    with open(vad_yaml, "w", encoding="utf-8") as f:
                        yaml.dump(vad_conf, f, default_flow_style=False, allow_unicode=True)
                    sys.stderr.write(f"[FunASR Worker] Compatibility fix: added vad_post_conf to vad.yaml\n")
                    sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[FunASR Worker] Warning: failed to fix vad_post_conf in vad.yaml: {e}\n")


def ensure_asr_compatibility(model_dir: str):
    """
    修复 ASR/Punc 模型配置文件兼容性问题：
    - token_list: 从 tokens.json 补入 config.yaml
    - punc_list: 如存在 model_conf.punc_list 则提到顶层
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

        if "token_list" not in config and os.path.exists(tokens_json):
            with open(tokens_json, "r", encoding="utf-8") as f:
                tokens = json_module.load(f)
            if isinstance(tokens, list):
                config["token_list"] = tokens
                modified = True
                sys.stderr.write(f"[FunASR Worker] Compatibility fix: added token_list ({len(tokens)} tokens)\n")

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


def ensure_punc_yaml(model_dir: str):
    """
    某些版本的 funasr_onnx 标点模型会读取 punc.yaml；若缺失则从 config.yaml 复制兜底。
    """
    if not model_dir or not os.path.exists(model_dir):
        return
    config_yaml = os.path.join(model_dir, "config.yaml")
    punc_yaml = os.path.join(model_dir, "punc.yaml")
    if os.path.exists(config_yaml) and not os.path.exists(punc_yaml):
        try:
            import shutil
            shutil.copy2(config_yaml, punc_yaml)
            sys.stderr.write(f"[FunASR Worker] Compatibility fix: copying config.yaml to punc.yaml...\n")
        except Exception as e:
            sys.stderr.write(f"[FunASR Worker] Warning: failed to copy punc.yaml: {e}\n")


def try_fix_local_model_dir(model_id: str, model_type: str, offline_mode: bool = False):
    """
    尝试查找本地模型目录并做一次兼容性修复，即使当前不是离线模式。
    """
    path = resolve_local_model_path(model_id, require_offline_mode=False, offline_mode=offline_mode)
    if not path:
        return
    if model_type == "vad":
        ensure_vad_compatibility(path)
    elif model_type == "punc":
        ensure_asr_compatibility(path)
        ensure_punc_yaml(path)
    else:
        ensure_asr_compatibility(path)
