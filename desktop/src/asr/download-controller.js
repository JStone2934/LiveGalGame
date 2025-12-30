import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { directorySize, getModelScopeRepoPath, safeReaddir } from './cache-resolver.js';

/**
 * 下载流程控制器
 * 负责启动/跟踪 FunASR 模型下载，并向 UI 广播事件
 */
export class DownloadController {
  constructor(options) {
    this.cacheDir = options.cacheDir;
    this.msCacheBase = options.msCacheBase;
    this.msCacheHub = options.msCacheHub;
    this.systemHfCache = options.systemHfCache;
    this.systemMsCache = options.systemMsCache;
    this.cacheDirs = options.cacheDirs || [];
    this.hfHome = options.hfHome;
    this.pythonPath = options.pythonPath;
    this.broadcast = options.broadcast;
    this.getModelStatus = options.getModelStatus;
    this.getModelPreset = options.getModelPreset;
    this.downloadScriptPath = options.downloadScriptPath;
    this.activeDownloads = new Map();
  }

  isDownloading(modelId) {
    return this.activeDownloads.has(modelId);
  }

  startDownload(modelId, source = 'huggingface', allowFallback = true) {
    if (this.activeDownloads.has(modelId)) {
      return { status: 'running' };
    }
    const preset = this.getModelPreset(modelId);
    if (!preset) {
      throw new Error(`Unknown ASR model: ${modelId}`);
    }

    if (preset.engine === 'siliconflow' || preset.isRemote) {
      const status = this.getModelStatus(modelId);
      this.broadcast('asr-model-download-complete', {
        modelId,
        repoId: preset.repoId,
        status,
      });
      return { status: 'completed' };
    }

    if (preset.engine === 'funasr' && preset.onnxModels) {
      const status = this.getModelStatus(modelId);
      if (status.isDownloaded) {
        this.broadcast('asr-model-download-complete', {
          modelId,
          repoId: preset.repoId,
          status,
        });
        return { status: 'completed' };
      }
    }

    const pythonExecutable = this.pythonPath;
    if (!pythonExecutable) {
      throw new Error('Python executable not found');
    }

    const repoId = preset.modelScopeRepoId || preset.repoId;
    const scriptPath = this.downloadScriptPath;
    const args = [
      scriptPath,
      '--model-id',
      preset.id,
      '--cache-dir',
      this.msCacheBase || this.msCacheHub,
      '--source',
      source,
    ];

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
      repoId,
      source,
      child,
      totalBytes: preset.sizeBytes || null,
      snapshotPath: null,
      timer: null,
      lastBytes: 0,
      lastTimestamp: Date.now(),
    };
    this.activeDownloads.set(modelId, downloadCtx);
    this.broadcast('asr-model-download-started', { modelId, repoId, source });

    let stdoutBuffer = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      lines.forEach((line) => {
        this.handleScriptMessage(downloadCtx, line);
      });
    });

    child.stderr.on('data', (chunk) => {
      const message = chunk.toString();
      this.broadcast('asr-model-download-log', { modelId, repoId, message });
    });

    const finalize = (code, signal) => {
      if (downloadCtx.timer) {
        clearInterval(downloadCtx.timer);
      }
      this.activeDownloads.delete(modelId);
      const status = this.getModelStatus(modelId);
      if (code === 0) {
        this.broadcast('asr-model-download-complete', {
          modelId,
          repoId,
          status,
        });
      } else {
        this.broadcast('asr-model-download-error', {
          modelId,
          repoId,
          code,
          signal,
        });
      }
    };

    child.on('close', (code, signal) => finalize(code, signal));
    child.on('error', (error) => {
      this.broadcast('asr-model-download-error', {
        modelId,
        repoId,
        message: error.message,
      });
    });

    return { status: 'running' };
  }

  handleScriptMessage(ctx, message) {
    let payload = null;
    try {
      payload = JSON.parse(message);
    } catch {
      this.broadcast('asr-model-download-log', {
        modelId: ctx.modelId,
        repoId: ctx.repoId,
        message,
      });
      return;
    }

    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.event === 'started') {
      if (payload.snapshotRelativePath) {
        ctx.snapshotPath = path.isAbsolute(payload.snapshotRelativePath)
          ? payload.snapshotRelativePath
          : path.join(this.cacheDir, payload.snapshotRelativePath);

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
}
