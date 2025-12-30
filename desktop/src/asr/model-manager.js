import { app, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';
import { ASR_MODEL_PRESETS, getAsrModelPreset } from '../shared/asr-models.js';
import { normalizeModelScopeCache, safeReaddir, directorySize, getModelScopeRepoPath, findModelInCache } from './cache-resolver.js';
import { detectPythonPath } from './python-env.js';
import { DownloadController } from './download-controller.js';

const DOWNLOAD_FUNASR_SCRIPT = path.join(app.getAppPath(), 'scripts', 'download_funasr_model.py');

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

    this.pythonPath = detectPythonPath();
    this.downloadController = new DownloadController({
      cacheDir: this.cacheDir,
      msCacheBase: this.msCacheBase,
      msCacheHub: this.msCacheHub,
      systemHfCache: this.systemHfCache,
      systemMsCache: this.systemMsCache,
      cacheDirs: this.cacheDirs,
      hfHome: this.hfHome,
      pythonPath: this.pythonPath,
      broadcast: this.broadcast.bind(this),
      getModelStatus: this.getModelStatus.bind(this),
      getModelPreset: getAsrModelPreset,
      downloadScriptPath: DOWNLOAD_FUNASR_SCRIPT,
    });
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
        const modelPath = findModelInCache(cacheBase, modelDir);
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
      activeDownload: this.downloadController?.isDownloading(modelId) || false,
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
      activeDownload: this.downloadController?.isDownloading(modelId) || false,
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
    return this.downloadController.startDownload(modelId, source, allowFallback);
  }

  cancelDownload(modelId) {
    return this.downloadController.cancelDownload(modelId);
  }

  shutdown() {
    this.downloadController.shutdown();
  }

  broadcast(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((window) => {
      window.webContents.send(channel, payload);
    });
  }
}
