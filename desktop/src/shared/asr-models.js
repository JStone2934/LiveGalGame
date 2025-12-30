export const ASR_MODEL_PRESETS = [
  // SiliconFlow 云端模型（默认）
  {
    id: 'siliconflow-cloud',
    label: 'SiliconFlow Cloud (推荐)',
    description: '远程 API 模式，无需本地下载模型，轻量级，但需要联网。',
    engine: 'siliconflow',
    sizeBytes: 0,
    recommendedSpec: '任意配置',
    speedHint: '网络延迟',
    language: 'zh',
    isDefault: true,
    isRemote: true,
  },
  // 百度实时 ASR (Demo)
  {
    id: 'baidu-cloud',
    label: 'Baidu Cloud (Demo)',
    description: '百度语音实时识别 API，低延迟，高精度，需联网。',
    engine: 'baidu',
    sizeBytes: 0,
    recommendedSpec: '任意配置',
    speedHint: '网络延迟',
    language: 'zh',
    isRemote: true,
  },
  // FunASR ONNX 模型
  // 2-Pass 架构: VAD + 流式ASR + 离线ASR + 标点
  // 注意: ModelScope ONNX 仓库只提供量化版 (model_quant.onnx)，无非量化版可用
  {
    id: 'funasr-paraformer',
    label: 'FunASR ParaFormer',
    description: 'FunASR 流式识别，本地离线运行，无需联网',
    engine: 'funasr',
    // ONNX 模型配置 (用于 2-Pass 架构)
    onnxModels: {
      vad: 'iic/speech_fsmn_vad_zh-cn-16k-common-onnx',
      online: 'iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx',
      offline: 'iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-onnx',
      punc: 'iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx',
    },
    // 用于缓存路径检测 (兼容 model-manager.js)
    repoId: 'iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online-onnx',
    // 本地统计（ModelScope 缓存）: online quant ~240MB + offline quant ~247MB + punc ~274MB + VAD ~1MB ≈ 760MB
    sizeBytes: 760 * 1024 * 1024, // 约 0.76GB（INT8 量化，含 VAD/流式/离线/标点）
    recommendedSpec: '≥4 核 CPU / ≥4GB 内存',
    speedHint: '实时 2x-3x',
    language: 'zh',
  },
];

export function getAsrModelPreset(modelId) {
  return ASR_MODEL_PRESETS.find((preset) => preset.id === modelId);
}








