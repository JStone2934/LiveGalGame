import { app, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { ASR_MODEL_PRESETS, getAsrModelPreset } from '../shared/asr-models.js';

const DOWNLOAD_FUNASR_SCRIPT = path.join(app.getAppPath(), 'scripts', 'download_funasr_model.py');

function normalizeModelScopeCache(cachePath) {
  if (!cachePath) {
    return { base: null, hub: null };
  }
  const normalized = path.resolve(cachePath);
  // ModelScope 的默认目录结构通常是: <MODELSCOPE_CACHE>/hub/...
  // 但历史上我们也可能把 env 直接设成了 ".../hub"。这里做兼容归一化。
  if (path.basename(normalized).toLowerCase() === 'hub') {
    return { base: path.dirname(normalized), hub: normalized };
  }
  return { base: normalized, hub: path.join(normalized, 'hub') };
}

function safeReaddir(targetPath) {
  try {
    return fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function directorySize(targetPath) {
  let total = 0;
  const stack = [targetPath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (stat.isFile()) {
          total += stat.size;
        }
      } catch {
        // Ignore files or links that disappear mid-scan
      }
    }
  }
  return total;
}

function getModelScopeRepoPath(cacheDir, repoId) {
  if (!repoId || !cacheDir) {
    return null;
  }
  const repoSegments = repoId.split(/[\\/]/).filter(Boolean);
  if (repoSegments.length === 0) {
    return null;
  }
  const baseCandidates = [
    cacheDir,
    path.join(cacheDir, 'models'),
    path.join(cacheDir, 'hub'),
    path.join(cacheDir, 'hub', 'models'),
    path.join(cacheDir, 'modelscope'),
    path.join(cacheDir, 'modelscope', 'hub'),
    path.join(cacheDir, 'modelscope', 'hub', 'models'),
  ];
  const uniqueBases = [...new Set(baseCandidates)];
  for (const basePath of uniqueBases) {
    try {
      if (!fs.existsSync(basePath)) {
        continue;
      }
    } catch {
      continue;
    }
    const candidate = path.join(basePath, ...repoSegments);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export default class ASRModelManager extends EventEmitter {
  constructor() {
    super();
    // 应用级缓存根目录（可通过环境变量覆盖）
    this.appCacheBase = process.env.ASR_CACHE_BASE || path.join(app.getPath('userData'), 'asr-cache');
    this.hfHome = process.env.HF_HOME || path.join(this.appCacheBase, 'hf-home');
    const msEnv = process.env.MODELSCOPE_CACHE || process.env.MODELSCOPE_CACHE_HOME;
    const msNormalized = normalizeModelScopeCache(msEnv || path.join(this.appCacheBase, 'modelscope'));
    this.msCacheBase = msNormalized.base;
    this.msCacheHub = msNormalized.hub;

    // Primary cache directory (共享给 HF 默认 hub)
    this.cacheDir = process.env.ASR_CACHE_DIR || path.join(this.hfHome, 'hub');
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.mkdirSync(this.hfHome, { recursive: true });
      if (this.msCacheBase) {
        fs.mkdirSync(this.msCacheBase, { recursive: true });
      }
      if (this.msCacheHub) {
        fs.mkdirSync(this.msCacheHub, { recursive: true });
      }
    } catch {
      // ignore mkdir errors
    }

    // Also check system default HuggingFace cache (preexisting downloads)
    this.systemHfCache = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
    // And system default ModelScope cache
    this.systemMsCache = path.join(os.homedir(), '.cache', 'modelscope', 'hub');

    // List of cache directories to check (in priority order)
    this.cacheDirs = [
      this.cacheDir,           // App-configured cache
      this.msCacheHub,         // App ModelScope hub
      this.msCacheBase,        // App ModelScope base (兼容某些工具只写到 base)
      this.systemHfCache,      // System default HF cache
      this.systemMsCache       // System default ModelScope cache
    ].filter(dir => {
      try {
        return fs.existsSync(dir);
      } catch {
        return false;
      }
    });

    this.pythonPath = this.detectPythonPath();
    this.activeDownloads = new Map(); // modelId -> download context
  }

  detectPythonPath() {
    const envPython = process.env.ASR_PYTHON_PATH;
    if (envPython && fs.existsSync(envPython)) {
      return envPython;
    }
    const resourcesPath = process.resourcesPath;
    const projectRoot = app.isPackaged
      ? path.join(resourcesPath || app.getAppPath(), '..')
      : app.getAppPath();

    // 优先使用打包内置的 python-env（extraResources）
    const bundledPython = process.platform === 'win32'
      ? path.join(resourcesPath || '', 'python-env', 'Scripts', 'python.exe')
      : path.join(resourcesPath || '', 'python-env', 'bin', 'python3');

    // 开发/调试：使用仓库下的 python-env/.venv
    const repoPythonEnv = process.platform === 'win32'
      ? path.join(projectRoot, 'python-env', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'python-env', 'bin', 'python3');

    const candidates = [
      bundledPython,
      repoPythonEnv,
      path.join(projectRoot, '.venv', 'bin', 'python'),
      path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
      'python3',
      'python',
    ];
    for (const candidate of candidates) {
      try {
        if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return 'python3';
  }

  getModelPresets() {
    return ASR_MODEL_PRESETS;
  }

  findSnapshotDir(preset) {
    // Try all cache directories
    console.log(`[ASR ModelManager] Searching for model ${preset.id} in dirs:`, this.cacheDirs);
    for (const cacheDir of this.cacheDirs) {
      const repoSafe = `models--${preset.repoId.replace('/', '--')}`;
      const repoRoot = path.join(cacheDir, repoSafe);
      console.log(`[ASR ModelManager] Checking HF path: ${repoRoot}`);

      if (!fs.existsSync(repoRoot)) {
        console.log(`[ASR ModelManager] Path does not exist: ${repoRoot}`);
        // 如果没在 HF 目录里找到，尝试 ModelScope 直接目录
        if (preset.modelScopeRepoId) {
          const msPath = getModelScopeRepoPath(cacheDir, preset.modelScopeRepoId);
          if (msPath) {
            console.log(`[ASR ModelManager] Found ModelScope path: ${msPath}`);
            return msPath;
          }
        }
        continue;
      }

      const refsDir = path.join(repoRoot, 'refs');
      let snapshotSha = null;
      const preferredRefs = ['main', 'default', 'refs/head/main'];
      for (const refName of preferredRefs) {
        const refPath = path.join(refsDir, refName);
        if (fs.existsSync(refPath)) {
          try {
            snapshotSha = fs.readFileSync(refPath, 'utf-8').trim();
            if (snapshotSha) {
              console.log(`[ASR ModelManager] Found SHA from ref ${refName}: ${snapshotSha}`);
              break;
            }
          } catch {
            // ignore
          }
        }
      }

      const snapshotsDir = path.join(repoRoot, 'snapshots');
      if (!snapshotSha) {
        console.log(`[ASR ModelManager] No SHA from refs, checking snapshots dir: ${snapshotsDir}`);
        try {
          if (fs.existsSync(snapshotsDir)) {
            const snapshots = safeReaddir(snapshotsDir).filter((entry) => entry.isDirectory());
            snapshots.sort((a, b) => {
              try {
                const aStat = fs.statSync(path.join(snapshotsDir, a.name));
                const bStat = fs.statSync(path.join(snapshotsDir, b.name));
                return bStat.mtimeMs - aStat.mtimeMs;
              } catch {
                return 0;
              }
            });
            snapshotSha = snapshots.length > 0 ? snapshots[0].name : null;
            console.log(`[ASR ModelManager] Found latest snapshot from dir listing: ${snapshotSha}`);
          }
        } catch (e) {
          console.error(`[ASR ModelManager] Error listing snapshots: ${e.message}`);
        }
      }

      if (!snapshotSha) {
        continue;
      }

      const snapshotPath = path.join(snapshotsDir, snapshotSha);
      if (fs.existsSync(snapshotPath)) {
        console.log(`[ASR ModelManager] Found valid snapshot path: ${snapshotPath}`);
        return snapshotPath;
      } else {
        console.log(`[ASR ModelManager] Snapshot path does not exist: ${snapshotPath}`);
      }
    }
    return null;
  }

  /**
   * 在给定的 cacheDir 下查找 modelscope 模型目录
   * modelscope 库的缓存结构是: MODELSCOPE_CACHE/hub/models/<org>/<model>
   * 但历史上也可能存在其他变体
   */
  findModelInCache(cacheDir, modelDir) {
    if (!cacheDir || !modelDir) return null;

    // 可能的路径变体（按优先级排序）
    const candidates = [
      path.join(cacheDir, 'hub', 'models', modelDir),  // 标准 modelscope 路径
      path.join(cacheDir, 'models', modelDir),          // 简化路径
      path.join(cacheDir, 'hub', modelDir),             // hub 下直接放
      path.join(cacheDir, modelDir),                    // 根目录下
    ];

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          return p;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  /**
   * FunASR ONNX 各模型的关键文件列表
   * 使用数组表示"或"关系：只要任一文件存在即可
   * 只有所有必需文件组都满足，模型才算下载完整
   */
  static FUNASR_CRITICAL_FILES = {
    // VAD 模型：需要配置文件 + 模型文件
    vad: [
      ['vad.yaml', 'config.yaml'],           // 配置文件（任一存在）
      ['vad.onnx', 'model_quant.onnx'],      // 模型文件（任一存在）
    ],
    // Online ASR 模型
    online: [
      ['config.yaml'],
      ['model.onnx', 'model_quant.onnx', 'decoder_quant.onnx'],
      ['am.mvn'],
    ],
    // Offline ASR 模型
    offline: [
      ['config.yaml'],
      ['model.onnx', 'model_quant.onnx'],
      ['am.mvn'],
    ],
    // 标点模型
    punc: [
      ['config.yaml'],
      ['punc.onnx', 'model_quant.onnx'],
    ],
  };

  /**
   * 判断文件是否存在且非空
   */
  fileExistsNonEmpty(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  /**
   * 检查 FunASR 模型目录中的关键文件是否存在
   * @param {string} modelPath - 模型目录路径
   * @param {string} modelType - 模型类型 (vad, online, offline, punc)
   * @returns {{ isComplete: boolean, missingFiles: string[] }}
   */
  checkFunASRCriticalFiles(modelPath, modelType) {
    const fileGroups = ASRModelManager.FUNASR_CRITICAL_FILES[modelType] || [];
    const missingGroups = [];

    for (const fileGroup of fileGroups) {
      // 检查文件组中是否至少有一个文件存在
      const hasAny = fileGroup.some((fileName) => {
        const filePath = path.join(modelPath, fileName);
        return this.fileExistsNonEmpty(filePath);
      });

      if (!hasAny) {
        // 记录缺失的文件组（取第一个作为代表）
        missingGroups.push(fileGroup[0]);
      }
    }

    // 额外的配置完整性检查（防止字段缺失导致加载时报错）
    const configPath = path.join(modelPath, 'config.yaml');
    let configContent = '';
    if (this.fileExistsNonEmpty(configPath)) {
      try {
        configContent = fs.readFileSync(configPath, 'utf-8');
      } catch {
        configContent = '';
      }
    }

    if (modelType === 'vad') {
      // funasr_onnx 需要 vad_post_conf，且会优先读取 vad.yaml
      const vadYamlPath = path.join(modelPath, 'vad.yaml');
      const vadYamlContent = this.fileExistsNonEmpty(vadYamlPath)
        ? (() => {
            try {
              return fs.readFileSync(vadYamlPath, 'utf-8');
            } catch {
              return '';
            }
          })()
        : '';

      // 若 config.yaml 或 vad.yaml 任一缺少 vad_post_conf，都标记缺失
      const hasVadPostConfInConfig = configContent && configContent.includes('vad_post_conf');
      const hasVadPostConfInVadYaml = vadYamlContent && vadYamlContent.includes('vad_post_conf');
      if (!hasVadPostConfInConfig || !hasVadPostConfInVadYaml) {
        missingGroups.push('vad_post_conf');
      }
    }

    if (['online', 'offline', 'punc'].includes(modelType)) {
      const tokensPath = path.join(modelPath, 'tokens.json');
      const hasTokensFile = this.fileExistsNonEmpty(tokensPath);
      const hasTokenListInConfig = configContent && configContent.includes('token_list');
      if (!hasTokensFile && !hasTokenListInConfig) {
        missingGroups.push('token_list');
      }
    }

    return {
      isComplete: missingGroups.length === 0,
      missingFiles: missingGroups,
    };
  }

  /**
   * 获取 FunASR ONNX 模型的状态
   * 这些模型由 funasr_onnx 库自己管理下载，缓存在 MODELSCOPE_CACHE/hub/models/ 目录
   */
  getFunASROnnxModelStatus(modelId, preset) {
    const onnxModels = preset.onnxModels || {};
    const modelEntries = Object.entries(onnxModels); // [[modelType, modelDir], ...]

    // funasr_onnx 使用的缓存目录（base 目录，不是 hub）
    // modelscope 实际下载位置是 MODELSCOPE_CACHE/hub/models/iic/...
    const funasrCacheBases = [
      // 系统默认
      path.join(os.homedir(), '.cache', 'modelscope'),
      // 应用配置的缓存目录
      this.msCacheBase,
      this.msCacheHub ? path.dirname(this.msCacheHub) : null,
      // 兼容旧版本
      this.systemMsCache ? path.dirname(this.systemMsCache) : null,
    ].filter(Boolean);

    // 去重
    const uniqueBases = [...new Set(funasrCacheBases)];

    let totalDownloadedBytes = 0;
    let modelsFound = 0;
    let modelsComplete = 0;
    let latestUpdatedAt = null;
    let foundPaths = [];
    let incompleteModels = []; // 记录不完整的模型信息

    for (const [modelType, modelDir] of modelEntries) {
      if (!modelDir) continue;

      // modelDir 格式: "iic/speech_fsmn_vad_zh-cn-16k-common-onnx"
      for (const cacheBase of uniqueBases) {
        const modelPath = this.findModelInCache(cacheBase, modelDir);
        if (modelPath) {
          try {
            const size = directorySize(modelPath);
            totalDownloadedBytes += size;
            modelsFound++;
            foundPaths.push(modelPath);

            // 检查关键文件是否完整
            const { isComplete, missingFiles } = this.checkFunASRCriticalFiles(modelPath, modelType);
            if (isComplete) {
              modelsComplete++;
            } else {
              incompleteModels.push({
                type: modelType,
                path: modelPath,
                missingFiles,
              });
              console.warn(`[ASR ModelManager] Model ${modelType} at ${modelPath} is incomplete, missing: ${missingFiles.join(', ')}`);
            }

            try {
              const stat = fs.statSync(modelPath);
              if (!latestUpdatedAt || stat.mtimeMs > latestUpdatedAt) {
                latestUpdatedAt = stat.mtimeMs;
              }
            } catch {
              // ignore
            }
            break; // Found this model, move to next
          } catch {
            // ignore
          }
        }
      }
    }

    const totalModels = modelEntries.length;
    // 只有所有模型都找到且关键文件完整，才算真正下载完成
    const isDownloaded = modelsFound >= totalModels && modelsComplete >= totalModels;

    // 如果所有模型都找到了，使用第一个找到的路径作为快照路径
    const snapshotPath = foundPaths.length > 0 ? path.dirname(foundPaths[0]) : null;

    console.log(`[ASR ModelManager] FunASR ONNX Status for ${modelId}:`, {
      modelsFound,
      modelsComplete,
      totalModels,
      isDownloaded,
      totalDownloadedBytes,
      foundPaths: foundPaths.slice(0, 2), // 只打印前两个以便调试
      searchedBases: uniqueBases.slice(0, 3),
      incompleteModels: incompleteModels.length > 0 ? incompleteModels : undefined,
    });

    return {
      modelId,
      repoId: preset.repoId,
      modelScopeRepoId: preset.modelScopeRepoId,
      sizeBytes: preset.sizeBytes || 0,
      downloadedBytes: totalDownloadedBytes,
      isDownloaded,
      snapshotPath,
      updatedAt: latestUpdatedAt,
      activeDownload: this.activeDownloads.has(modelId),
      source: 'funasr_onnx',
      // FunASR 特有信息
      onnxModelsFound: modelsFound,
      onnxModelsComplete: modelsComplete,
      onnxModelsTotal: totalModels,
      // 添加更多调试信息，方便用户查看
      foundPaths,
      incompleteModels: incompleteModels.length > 0 ? incompleteModels : undefined,
    };
  }

  getModelStatus(modelId) {
    const preset = getAsrModelPreset(modelId);
    if (!preset) {
      return null;
    }

    // 云端模型：无需下载，本地恒定可用（但依赖网络与 API）
    if (preset.engine === 'siliconflow' || preset.isRemote) {
      return {
        modelId,
        repoId: preset.repoId || null,
        modelScopeRepoId: preset.modelScopeRepoId || null,
        sizeBytes: 0,
        downloadedBytes: 0,
        isDownloaded: true,
        snapshotPath: null,
        updatedAt: Date.now(),
        activeDownload: false,
        source: 'remote'
      };
    }

    // FunASR ONNX 模型特殊处理
    // 这些模型由 funasr_onnx 库自己管理下载，缓存在 ~/.cache/modelscope/hub/iic/ 目录
    if (preset.engine === 'funasr' && preset.onnxModels) {
      return this.getFunASROnnxModelStatus(modelId, preset);
    }

    // Check HuggingFace cache
    const hfSnapshotPath = this.findSnapshotDir(preset);
    let hfDownloadedBytes = 0;
    let hfUpdatedAt = null;
    if (hfSnapshotPath) {
      hfDownloadedBytes = directorySize(hfSnapshotPath);
      try {
        const stat = fs.statSync(hfSnapshotPath);
        hfUpdatedAt = stat.mtimeMs;
      } catch {
        hfUpdatedAt = null;
      }
    }

    // Check ModelScope cache
    // ModelScope structure: cacheDir / repoId (e.g. iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx)
    // or sometimes cacheDir / repoId / .mv / ...
    // Simple check: cacheDir / repoId
    let msSnapshotPath = null;
    let msDownloadedBytes = 0;
    let msUpdatedAt = null;

    if (preset.modelScopeRepoId) {
      // Try all cache directories for ModelScope models
      for (const cacheDir of this.cacheDirs) {
        const msRepoPath = getModelScopeRepoPath(cacheDir, preset.modelScopeRepoId);
        if (!msRepoPath) {
          continue;
        }
        msSnapshotPath = msRepoPath;
        msDownloadedBytes = directorySize(msSnapshotPath);
        try {
          const stat = fs.statSync(msSnapshotPath);
          msUpdatedAt = stat.mtimeMs;
        } catch {
          msUpdatedAt = null;
        }
        break; // Found it, stop searching
      }
    }

    // Determine which one to use (prefer the one that is "more" downloaded or exists)
    const snapshotPath = hfSnapshotPath || msSnapshotPath;
    const downloadedBytes = Math.max(hfDownloadedBytes, msDownloadedBytes);
    const updatedAt = hfUpdatedAt || msUpdatedAt;
    const source = hfSnapshotPath ? 'huggingface' : (msSnapshotPath ? 'modelscope' : null);

    const targetSize = preset.sizeBytes || 0;

    // Relaxed check: if we have > 10MB and (model.bin or config.json exists), consider it downloaded
    // or if size is > 90% of target
    const hasCriticalFiles = snapshotPath && ([
      'config.json',
      'configuration.json',
      'config.yaml',
      'model.bin',
      'model.pt'
    ].some((fileName) => {
      try {
        return fs.existsSync(path.join(snapshotPath, fileName));
      } catch {
        return false;
      }
    }));

    const isDownloaded = (targetSize > 0 && downloadedBytes >= targetSize * 0.9) ||
      (hasCriticalFiles && downloadedBytes > 10 * 1024 * 1024);

    if (modelId === 'medium' || modelId === 'small') {
      console.log(`[ASR ModelManager] Status for ${modelId}:`, {
        hfSnapshotPath,
        msSnapshotPath,
        downloadedBytes,
        targetSize,
        hasCriticalFiles,
        isDownloaded,
        source
      });
    }

    return {
      modelId,
      repoId: preset.repoId,
      modelScopeRepoId: preset.modelScopeRepoId,
      sizeBytes: targetSize,
      downloadedBytes,
      isDownloaded,
      snapshotPath,
      updatedAt,
      activeDownload: this.activeDownloads.has(modelId),
      source
    };
  }

  getAllModelStatuses() {
    try {
      return ASR_MODEL_PRESETS.map((preset) => this.getModelStatus(preset.id));
    } catch (error) {
      console.error('[ASR ModelManager] Error getting all model statuses:', error);
      return [];
    }
  }

  startDownload(modelId, source = 'huggingface', allowFallback = true) {
    if (this.activeDownloads.has(modelId)) {
      return { status: 'running' };
    }
    const preset = getAsrModelPreset(modelId);
    if (!preset) {
      throw new Error(`Unknown ASR model: ${modelId}`);
    }

    // 云端模型不需要下载
    if (preset.engine === 'siliconflow' || preset.isRemote) {
      const status = this.getModelStatus(modelId);
      this.broadcast('asr-model-download-complete', {
        modelId,
        repoId: preset.repoId,
        status
      });
      return { status: 'completed' };
    }

    // FunASR ONNX 模型由 funasr-onnx 库自己管理下载
    // 我们可以调用辅助脚本来触发这个下载过程
    if (preset.engine === 'funasr' && preset.onnxModels) {
      const status = this.getFunASROnnxModelStatus(modelId, preset);
      if (status.isDownloaded) {
        console.log(`[ASR ModelManager] FunASR ONNX model ${modelId} is already downloaded`);
        this.broadcast('asr-model-download-complete', {
          modelId,
          repoId: preset.repoId,
          status,
        });
        return { status: 'completed' };
      }
      
      // 未下载，继续执行，使用 download_funasr_model.py
      console.log(`[ASR ModelManager] FunASR ONNX model ${modelId} will be downloaded via script`);
      // 不返回 'auto-download'，而是继续执行后续的 spawn 逻辑，但要替换 script 和 args
    }

    const pythonExecutable = this.pythonPath;
    if (!pythonExecutable) {
      throw new Error('Python executable not found');
    }

    const repoId = preset.modelScopeRepoId || preset.repoId;

    const scriptPath = DOWNLOAD_FUNASR_SCRIPT;
    const args = [
      scriptPath,
      '--model-id',
      preset.id,
      '--cache-dir',
      this.msCacheBase || this.msCacheHub, // FunASR 默认用 ModelScope 缓存
      '--source',
      source // 传递用户选择的下载源 (huggingface / modelscope)
    ];

    console.log(`[ASR ModelManager] Starting download: modelId=${modelId}, source=${source}, repoId=${repoId}`);
    console.log(`[ASR ModelManager] Python path: ${pythonExecutable}`);
    console.log(`[ASR ModelManager] Download script: ${scriptPath}`);
    console.log(`[ASR ModelManager] Spawn command: ${pythonExecutable} ${args.join(' ')}`);

    const hfHomeEnv = this.hfHome || process.env.HF_HOME;
    const msCacheEnv = this.msCacheBase || process.env.MODELSCOPE_CACHE;
    const env = {
      ...process.env,
      ASR_CACHE_DIR: this.cacheDir,
      HF_HOME: hfHomeEnv,
      MODELSCOPE_CACHE: msCacheEnv,
      MODELSCOPE_CACHE_HOME: msCacheEnv,
      PYTHONIOENCODING: 'utf-8',
    };
    const child = spawn(pythonExecutable, args, { env });
    const downloadCtx = {
      modelId,
      repoId: repoId,
      source,
      child,
      totalBytes: preset.sizeBytes || null,
      snapshotPath: null,
      timer: null,
      lastBytes: 0,
      lastTimestamp: Date.now(),
    };
    this.activeDownloads.set(modelId, downloadCtx);
    this.broadcast('asr-model-download-started', {
      modelId,
      repoId: repoId,
      source
    });

    console.log(`[ASR ModelManager] Download started for ${modelId}`);

    let stdoutBuffer = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      lines.forEach((line) => {
        console.log(`[ASR ModelManager][${modelId}][stdout] ${line}`);
        this.handleScriptMessage(downloadCtx, line);
      });
    });
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString();
      console.error(`[ASR ModelManager][${modelId}][stderr] ${message}`);
      this.broadcast('asr-model-download-log', {
        modelId,
        repoId: repoId,
        message,
      });
    });
    const finalize = (code, signal) => {
      console.log(`[ASR ModelManager] Download process exited: modelId=${modelId}, code=${code}, signal=${signal}`);
      if (downloadCtx.timer) {
        clearInterval(downloadCtx.timer);
      }
      this.activeDownloads.delete(modelId);
      const status = this.getModelStatus(modelId);
      if (code === 0) {
        console.log(`[ASR ModelManager] Download completed successfully: ${modelId}`);
        this.broadcast('asr-model-download-complete', {
          modelId,
          repoId: repoId,
          status,
        });
      } else {
        console.error(`[ASR ModelManager] Download failed: modelId=${modelId}, code=${code}, source=${source}`);
        this.broadcast('asr-model-download-error', {
          modelId,
          repoId: repoId,
          code,
          signal,
        });
      }
    };
    child.on('close', (code, signal) => finalize(code, signal));
    child.on('error', (error) => {
      console.error(`[ASR ModelManager] Download process error: ${error.message}`);
      this.broadcast('asr-model-download-error', {
        modelId,
        repoId: repoId,
        message: error.message,
      });
      finalize(1, null);
    });
    return { status: 'started' };
  }

  handleScriptMessage(ctx, line) {
    if (!line.trim()) return;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      this.broadcast('asr-model-download-log', {
        modelId: ctx.modelId,
        repoId: ctx.repoId,
        message: line,
      });
      return;
    }
    if (payload.event === 'manifest') {
      if (payload.totalBytes) {
        ctx.totalBytes = payload.totalBytes;
      }
      if (payload.message) {
        this.broadcast('asr-model-download-log', {
          modelId: ctx.modelId,
          repoId: ctx.repoId,
          message: payload.message,
        });
      }
      if (payload.snapshotRelativePath) {
        ctx.snapshotPath = path.isAbsolute(payload.snapshotRelativePath)
          ? payload.snapshotRelativePath
          : path.join(this.cacheDir, payload.snapshotRelativePath);

        // ModelScope 下载的落盘路径可能与 cacheDir 结构不同，尝试解析实际目录
        if (payload.source === 'modelscope') {
          const resolvedMsPath =
            getModelScopeRepoPath(this.cacheDir, ctx.repoId) ||
            getModelScopeRepoPath(this.msCacheHub, ctx.repoId) ||
            getModelScopeRepoPath(this.systemMsCache, ctx.repoId) ||
            getModelScopeRepoPath(this.systemHfCache, ctx.repoId);
          if (resolvedMsPath) {
            ctx.snapshotPath = resolvedMsPath;
          }
        }
      }
      // 记录 downloads 目录的现有子目录，后续用于估算部分下载进度（HF 临时文件）
      ctx.downloadsDir = path.join(this.cacheDir, 'downloads');
      try {
        const baselineEntries = safeReaddir(ctx.downloadsDir).filter((entry) => entry.isDirectory());
        ctx.downloadsBaseDirs = new Set(baselineEntries.map((entry) => entry.name));
      } catch {
        ctx.downloadsBaseDirs = null;
      }
      if (!ctx.timer) {
        ctx.timer = setInterval(() => this.emitProgress(ctx), 1000);
      }
    } else if (payload.event === 'completed') {
      if (payload.localDir) {
        ctx.snapshotPath = payload.localDir;
      }
      this.emitProgress(ctx, true);
    } else if (payload.event === 'warning') {
      // 仅记录警告，避免在 HuggingFace 失败但可回退时直接报错
      this.broadcast('asr-model-download-log', {
        modelId: ctx.modelId,
        repoId: ctx.repoId,
        message: payload.message || 'download warning',
        traceback: payload.traceback,
      });
    } else if (payload.event === 'error') {
      this.broadcast('asr-model-download-error', {
        modelId: ctx.modelId,
        repoId: ctx.repoId,
        message: payload.message,
      });
    } else if (payload.event === 'cancelled') {
      this.broadcast('asr-model-download-cancelled', {
        modelId: ctx.modelId,
        repoId: ctx.repoId,
      });
    }
  }

  emitProgress(ctx, force = false) {
    // 若 snapshot 路径尚未确认，但 modelscope 目录已创建，尝试动态解析
    if ((!ctx.snapshotPath || !fs.existsSync(ctx.snapshotPath)) && ctx.source === 'modelscope') {
      const resolvedMsPath =
        getModelScopeRepoPath(this.cacheDir, ctx.repoId) ||
        getModelScopeRepoPath(this.msCacheHub, ctx.repoId) ||
        getModelScopeRepoPath(this.systemMsCache, ctx.repoId) ||
        getModelScopeRepoPath(this.systemHfCache, ctx.repoId);
      if (resolvedMsPath) {
        ctx.snapshotPath = resolvedMsPath;
      }
    }

    if (!ctx.snapshotPath && !ctx.downloadsDir) {
      return;
    }

    const snapshotBytes = ctx.snapshotPath ? directorySize(ctx.snapshotPath) : 0;
    // HF 下载时，临时文件位于 cacheDir/downloads/<uuid>，用于显示部分下载进度
    const tempBytes = this.computeDownloadTempBytes(ctx);
    const downloadedBytes = Math.max(snapshotBytes, tempBytes);
    const totalBytes = ctx.totalBytes || downloadedBytes;
    const now = Date.now();
    const elapsedMs = now - (ctx.lastTimestamp || now);
    const deltaBytes = downloadedBytes - (ctx.lastBytes || 0);
    const bytesPerSecond = elapsedMs > 0 ? (deltaBytes / (elapsedMs / 1000)) : 0;
    ctx.lastBytes = downloadedBytes;
    ctx.lastTimestamp = now;
    this.broadcast('asr-model-download-progress', {
      modelId: ctx.modelId,
      repoId: ctx.repoId,
      downloadedBytes,
      totalBytes,
      bytesPerSecond,
    });
    if (force && ctx.timer) {
      clearInterval(ctx.timer);
      ctx.timer = null;
    }
  }

  computeDownloadTempBytes(ctx) {
    if (!ctx.downloadsDir) {
      return 0;
    }
    let total = 0;
    const baseline = ctx.downloadsBaseDirs || new Set();
    let entries = [];
    try {
      entries = safeReaddir(ctx.downloadsDir).filter((entry) => entry.isDirectory());
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (baseline.has(entry.name)) {
        continue;
      }
      const dirPath = path.join(ctx.downloadsDir, entry.name);
      total += directorySize(dirPath);
    }
    return total;
  }

  cancelDownload(modelId) {
    const ctx = this.activeDownloads.get(modelId);
    if (!ctx) {
      return { status: 'idle' };
    }
    if (ctx.child) {
      ctx.child.kill('SIGINT');
    }
    if (ctx.timer) {
      clearInterval(ctx.timer);
    }
    this.activeDownloads.delete(modelId);
    this.broadcast('asr-model-download-cancelled', {
      modelId,
      repoId: ctx.repoId,
    });
    return { status: 'cancelled' };
  }

  shutdown() {
    this.activeDownloads.forEach((ctx, modelId) => {
      if (ctx.child) {
        try {
          ctx.child.kill('SIGINT');
        } catch {
          // ignore
        }
      }
      if (ctx.timer) {
        clearInterval(ctx.timer);
      }
      this.broadcast('asr-model-download-cancelled', {
        modelId,
        repoId: ctx.repoId,
      });
    });
    this.activeDownloads.clear();
  }

  broadcast(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((window) => {
      window.webContents.send(channel, payload);
    });
  }
}
