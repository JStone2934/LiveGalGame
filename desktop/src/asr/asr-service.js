import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { spawn } from 'child_process';
import { setTimeout as delay } from 'node:timers/promises';
import killPort from 'kill-port';
import portfinder from 'portfinder';
import treeKill from 'tree-kill';
import WebSocket from 'ws';
import * as logger from '../utils/logger.js';
import { detectPythonPath } from './python-env.js';
import {
  safeDirSize,
  getRepoPathsForModel,
  resolveModelCache,
  resolveFunasrModelScopeCache,
  cleanModelScopeLocks
} from './model-cache.js';
import { float32ToInt16Buffer, ensureDir, createWavBuffer, defaultAudioStoragePath } from './audio-utils.js';
import FastAPISession from './fastapi-session.js';
import { getAsrModelPreset } from '../shared/asr-models.js';

const DEFAULT_HOST = '127.0.0.1';
const SERVER_READY_TEXT = 'Application startup complete';

class ASRService {
  constructor() {
    this.modelName = 'siliconflow-cloud';
    this.engine = 'funasr';
    this.pythonPath = detectPythonPath();
    this.isInitialized = false;
    this.lastProgressBytes = 0;
    this.lastProgressTimestamp = 0;
    this.modelPreset = null;
    this.modelCacheDir = null;
    this.modelCacheFound = false;
    this.modelCachePreDownloaded = false;
    this.shouldReportProgress = true;
    this.serverProcess = null;
    this.isDownloading = false;
    this.serverHost = DEFAULT_HOST;
    this.serverPort = null;
    this.serverReady = false;
    this.sessions = new Map();
    this.onSentenceComplete = null;
    this.onPartialResult = null;
    this.onServerCrash = null;
    this.progressEmitter = null;
    this.retainAudioFiles = false;
    this.audioStoragePath = defaultAudioStoragePath();
    ensureDir(this.audioStoragePath);
    this.isStopping = false; // 标记是否为预期的关闭，避免误报崩溃
    // 防止并发 initialize/startBackendServer 造成重复拉起多个后端进程（导致内存飙升）
    this._initializePromise = null;
    this._startPromise = null;
  }

  setServerCrashCallback(callback) {
    this.onServerCrash = callback;
  }

  setProgressEmitter(emitter) {
    this.progressEmitter = emitter;
  }

  emitDownloadProgress(payload = {}) {
    if (typeof this.progressEmitter !== 'function') return;
    this.progressEmitter({
      modelId: this.modelName,
      engine: this.engine,
      source: payload.source || 'preload',
      ...payload,
    });
  }

  async initialize(modelName = 'siliconflow-cloud', options = {}) {
    if (this._initializePromise) {
      return await this._initializePromise;
    }

    this._initializePromise = (async () => {
      this.modelName = modelName || this.modelName;
      const preset = getAsrModelPreset(modelName);
      this.modelPreset = preset;
      this.engine = preset?.engine || 'funasr';
      this.retainAudioFiles = options.retainAudioFiles || false;
      this.audioStoragePath = options.audioStoragePath || this.audioStoragePath;
      ensureDir(this.audioStoragePath);

      // 确保服务器在预加载时就启动（不要懒加载）
      if (!this.serverProcess) {
        await this.startBackendServer();
      } else if (!this.serverReady) {
        // 如果进程存在但还没准备好，等待健康检查
        await this.waitForHealth();
      }
      this.serverReady = true;
      this.isInitialized = true;
      return true;
    })().finally(() => {
      this._initializePromise = null;
    });

    return await this._initializePromise;
  }

  async startBackendServer() {
    if (this._startPromise) {
      return await this._startPromise;
    }
    // 若已有进程，则不要重复拉起；只需等它 ready
    if (this.serverProcess) {
      if (!this.serverReady) {
        await this.waitForHealth();
      }
      return true;
    }

    this._startPromise = (async () => {
    // Pick a free port dynamically
    const port = await portfinder.getPortPromise({ port: Number(process.env.ASR_PORT) || 18000 });
    this.serverPort = port;
    this.isDownloading = false;

    try {
      await killPort(port);
    } catch {
      // ignore
    }

    const projectRoot = app.getAppPath();
    const binName = process.platform === 'win32' ? 'asr-backend.exe' : 'asr-backend';
    const packagedBin = path.join(process.resourcesPath, 'backend', 'asr-backend', binName);
    const backendEntry = app.isPackaged && fs.existsSync(packagedBin)
      ? packagedBin
      : path.join(projectRoot, 'backend', 'main.py');

    const useBinary = app.isPackaged && fs.existsSync(packagedBin);

    if (!fs.existsSync(backendEntry)) {
      throw new Error(`[ASR] Backend entry not found: ${backendEntry}`);
    }

    const { cacheDir, found } = resolveModelCache(this.modelName);
    this.modelCacheDir = cacheDir;
    this.modelCacheFound = found;

    // FunASR 模型：尝试自动复用已存在的 ModelScope 缓存，避免重复下载
    let msCacheEnv = process.env.MODELSCOPE_CACHE || path.join(app.getPath('userData'), 'ms-cache');
    if (this.engine === 'funasr' && this.modelPreset?.onnxModels) {
      const funasrMs = resolveFunasrModelScopeCache(this.modelPreset);
      if (funasrMs?.cacheDir) {
        logger.log(`[ASR] FunASR ModelScope cache resolved: ${funasrMs.cacheDir} (found=${funasrMs.found})`);
        msCacheEnv = funasrMs.cacheDir;
        if (funasrMs.found) {
          // 记录已存在缓存，便于后续进度判定
          this.modelCacheFound = true;
          logger.log(`[ASR] Using existing ModelScope cache at: ${msCacheEnv}`);
        }
      }
    }

    // 计算已有缓存，若已下载完成则不再上报进度
    const presetSize = this.modelPreset?.sizeBytes || null;
    const isRemote = this.modelPreset?.isRemote || false;
    
    const repoPathsSet = new Set(getRepoPathsForModel(this.modelPreset, cacheDir));
    // funasr 需要把 ModelScope onnx 目录也纳入探测
    if (this.engine === 'funasr' && this.modelPreset?.onnxModels && msCacheEnv) {
      getRepoPathsForModel(this.modelPreset, msCacheEnv).forEach((p) => repoPathsSet.add(p));
    }
    const repoPaths = Array.from(repoPathsSet);
    const initialDownloaded = repoPaths.length ? repoPaths.reduce((sum, p) => sum + safeDirSize(p), 0) : 0;
    
    let cachedEnough = false;
    if (isRemote) {
      cachedEnough = true;
    } else {
      cachedEnough = presetSize
        ? initialDownloaded >= presetSize * 0.9
        : initialDownloaded > 50 * 1024 * 1024; // 没有 size 时粗判>50MB
    }

    this.modelCachePreDownloaded = cachedEnough;
    this.shouldReportProgress = !cachedEnough;

    // Large 模型默认不使用量化，精度更高
    const isLargeModel = this.modelName.toLowerCase().includes('large');
    const useQuantize = this.modelPreset?.quantize !== false && !isLargeModel;

    // 如果检测到已有完整缓存，启用离线模式避免每次启动都联网检查版本
    // 对于远程模型，不需要离线模式
    const useOfflineMode = !isRemote && this.modelCacheFound && cachedEnough;
    
    const env = {
      ...process.env,
      ASR_ENGINE: this.engine,
      ASR_MODEL: this.modelName,
      ASR_HOST: this.serverHost,
      ASR_PORT: String(this.serverPort),
      ASR_QUANTIZE: useQuantize ? 'true' : 'false',
      HF_HOME: process.env.HF_HOME || path.join(app.getPath('userData'), 'hf-home'),
      ASR_CACHE_DIR: this.engine === 'funasr' ? msCacheEnv : cacheDir,
      MODELSCOPE_CACHE: msCacheEnv,
      MODELSCOPE_CACHE_HOME: msCacheEnv,
      // 启用离线模式：跳过 ModelScope 版本检查，直接使用本地缓存
      MODELSCOPE_OFFLINE: useOfflineMode ? '1' : '',
      HF_HUB_OFFLINE: useOfflineMode ? '1' : '',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      // API Key for Cloud Mode
      SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY || '',
      BAIDU_APP_ID: process.env.BAIDU_APP_ID || '',
      BAIDU_API_KEY: process.env.BAIDU_API_KEY || '',
      BAIDU_SECRET_KEY: process.env.BAIDU_SECRET_KEY || ''
    };
    
    if (useOfflineMode) {
      logger.log(`[ASR] Offline mode enabled: using local cache without version check`);
    }

    ensureDir(env.HF_HOME);
    ensureDir(cacheDir);
    ensureDir(env.MODELSCOPE_CACHE);
    cleanModelScopeLocks(env.MODELSCOPE_CACHE);

    if (useBinary) {
      logger.log(`[ASR] Spawning packaged backend: ${backendEntry}`);
      this.serverProcess = spawn(backendEntry, [], { env });
    } else {
      logger.log(`[ASR] Spawning FastAPI backend: ${this.pythonPath} ${backendEntry} (engine=${this.engine}, model=${this.modelName}, port=${this.serverPort})`);
      this.serverProcess = spawn(this.pythonPath, [backendEntry], { env });
    }

    logger.log(`[ASR] cache dir: ${cacheDir} (found=${found})`);

    this.serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      logger.log(`[ASR Backend][stdout] ${text.trim()}`);
      if (text.includes(SERVER_READY_TEXT) || text.includes('Uvicorn running')) {
        this.serverReady = true;
      }
    });

    this.serverProcess.stderr.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        logger.log(`[ASR Backend][stderr] ${line}`);

        // 简单关键字检测：只要出现 Downloading Model 视为正在下载
        if (!this.isDownloading && line.includes('Downloading Model')) {
          this.isDownloading = true;
        }
        // 下载完成/就绪的关键字，清除下载标记
        if (
          this.isDownloading &&
          (line.includes('All models loaded successfully')
            || line.includes('Worker is READY')
            || line.includes('Worker is READY!')
            || line.includes('Received READY signal'))
        ) {
          this.isDownloading = false;
        }
      }
    });

    this.serverProcess.on('close', (code, signal) => {
      const isExpectedStop = this.isStopping || code === 0;
      this.isDownloading = false;
      if (isExpectedStop) {
        logger.log(`[ASR Backend] exited normally (code=${code}, signal=${signal ?? 'none'})`);
      } else {
        logger.error(`[ASR Backend] exited with code ${code}, signal=${signal ?? 'none'}`);
        if (this.onServerCrash) {
          this.onServerCrash(code);
        }
      }
      this.serverProcess = null;
      this.serverReady = false;
      this.isStopping = false;
    });

    this.serverProcess.on('error', (error) => {
      logger.error('[ASR Backend] process error:', error);
      this.serverProcess = null;
      this.serverReady = false;
      this.isDownloading = false;
    });

    try {
      await this.waitForHealth();
      return true;
    } catch (err) {
      // 启动失败时务必清理子进程，避免后台残留导致内存飙升
      try {
        this.isStopping = true;
        if (this.serverProcess?.pid) {
          try {
            treeKill(this.serverProcess.pid);
          } catch {
            this.serverProcess.kill();
          }
        }
      } catch {
        // ignore
      } finally {
        this.serverProcess = null;
        this.serverReady = false;
        this.isStopping = false;
      }
      throw err;
    }
    })().finally(() => {
      this._startPromise = null;
    });

    return await this._startPromise;
  }

  async waitForHealth(timeoutMs = 180000) { // 默认 3 分钟，会在有下载进展时自动延长
    const start = Date.now();
    const maxTimeoutMs = Math.max(timeoutMs, 15 * 60 * 1000); // 最长 15 分钟
    let deadline = start + timeoutMs;
    let lastProgressSeenAt = start;
    const url = `http://${this.serverHost}:${this.serverPort}/health`;
    const totalSize = this.modelPreset?.sizeBytes || null;
    const repoPaths = getRepoPathsForModel(this.modelPreset, this.modelCacheDir);
    const calcDownloaded = () => {
      if (!repoPaths || repoPaths.length === 0) return 0;
      let downloaded = 0;
      for (const p of repoPaths) {
        downloaded += safeDirSize(p);
      }
      return downloaded;
    };

    // 预先发送一次进度，便于 UI 立即显示（仅首次下载时）
    if (this.shouldReportProgress && totalSize && repoPaths.length > 0) {
      const initialDownloaded = calcDownloaded();
      this.lastProgressBytes = initialDownloaded;
      this.lastProgressTimestamp = Date.now();
      this.emitDownloadProgress({
        status: 'start',
        downloadedBytes: initialDownloaded,
        totalBytes: totalSize,
        bytesPerSecond: 0,
        activeDownload: true,
      });
    }

    let lastReportAt = 0;
    let lastLogAt = 0;

    while (Date.now() < deadline) {
      try {
        // Node 20 has global fetch
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) {
          const finalDownloaded = calcDownloaded();
          if (this.shouldReportProgress) {
            this.emitDownloadProgress({
              status: 'complete',
              downloadedBytes: finalDownloaded,
              totalBytes: totalSize || finalDownloaded,
              bytesPerSecond: 0,
              activeDownload: false,
              isDownloaded: true,
            });
          }
          this.isDownloading = false;
          this.serverReady = true;
          return true;
        }
      } catch {
        // ignore
      }
      const waited = Date.now() - start;
      const now = Date.now();

      // 进度上报（每秒一次，避免频繁扫描目录）
      if (this.shouldReportProgress && now - lastReportAt >= 1000 && repoPaths.length > 0) {
        const downloaded = calcDownloaded();
        const deltaBytes = downloaded - this.lastProgressBytes;
        const deltaMs = now - this.lastProgressTimestamp || 1;
        const bytesPerSecond = deltaMs > 0 ? deltaBytes / (deltaMs / 1000) : 0;
        this.lastProgressBytes = downloaded;
        this.lastProgressTimestamp = now;
        lastReportAt = now;

        this.emitDownloadProgress({
          status: 'progress',
          downloadedBytes: downloaded,
          totalBytes: totalSize || downloaded,
          bytesPerSecond,
          activeDownload: true,
        });
        if (deltaBytes > 0) {
          lastProgressSeenAt = now;
          // 有进展则滚动延时，最多不超过 maxTimeoutMs
          const extended = Math.min(start + maxTimeoutMs, now + 120000); // 额外给 2 分钟窗口
          if (extended > deadline) {
            deadline = extended;
          }
        }

        // 日志保持原有节奏（约 5s 一次）
        if (now - lastLogAt >= 5000) {
          let progressText = '';
          if (totalSize) {
            const pct = Math.min(99, Math.max(0, Math.round((downloaded / totalSize) * 100)));
            progressText = ` (approx ${pct}% of model cached)`;
          }
          logger.log(`[ASR] Waiting for backend health... ${Math.round(waited / 1000)}s elapsed${progressText}`);
          lastLogAt = now;
        }
      }
      await delay(500);
    }
    if (this.shouldReportProgress) {
      this.emitDownloadProgress({
        status: 'error',
        downloadedBytes: this.lastProgressBytes,
        totalBytes: totalSize || this.lastProgressBytes,
        activeDownload: false,
        message: 'FastAPI backend health check timeout',
      });
    }
    throw new Error('FastAPI backend health check timeout');
  }

  getDownloadStatus() {
    return { downloading: this.isDownloading };
  }

  getSession(sourceId) {
    if (this.sessions.has(sourceId)) {
      return this.sessions.get(sourceId);
    }

    const wsUrl = `ws://${this.serverHost}:${this.serverPort}/ws/transcribe?session_id=${encodeURIComponent(sourceId)}`;
    const ws = new WebSocket(wsUrl);

    const session = new Promise((resolve, reject) => {
      ws.on('open', () => {
        const s = new FastAPISession(ws, sourceId, this.onSentenceComplete, this.onPartialResult);
        resolve(s);
      });
      ws.on('error', (err) => {
        this.sessions.delete(sourceId);
        reject(err);
      });
      ws.on('close', () => {
        this.sessions.delete(sourceId);
      });
    });

    this.sessions.set(sourceId, session);
    return session;
  }

  async addAudioChunk(audioData, timestamp, sourceId = 'default') {
    if (!this.isInitialized) {
      throw new Error('ASR service not initialized');
    }
    if (!audioData || audioData.length === 0) {
      return null;
    }
    if (!this.serverReady) {
      await this.waitForHealth();
    }

    const sessionPromise = this.getSession(sourceId);
    const session = await sessionPromise;
    const buffer = float32ToInt16Buffer(audioData);
    session.sendAudio(buffer);
    return null;
  }

  async sendResetCommand(sessionId) {
    const sessionPromise = this.sessions.get(sessionId);
    if (!sessionPromise) return;
    const session = await sessionPromise;
    session.reset();
  }

  async forceCommitSentence(sessionId) {
    const sessionPromise = this.sessions.get(sessionId);
    if (!sessionPromise) return false;
    const session = await sessionPromise;
    session.sendControl({ type: 'force_commit' });
    return true;
  }

  async commitSentence() {
    return null;
  }

  setSentenceCompleteCallback(callback) {
    this.onSentenceComplete = callback;
    this.sessions.forEach(async (sessionPromise) => {
      try {
        const session = await sessionPromise;
        session.setCallbacks(this.onSentenceComplete, this.onPartialResult);
      } catch {
        // ignore
      }
    });
  }

  setPartialResultCallback(callback) {
    this.onPartialResult = callback;
    this.sessions.forEach(async (sessionPromise) => {
      try {
        const session = await sessionPromise;
        session.setCallbacks(this.onSentenceComplete, this.onPartialResult);
      } catch {
        // ignore
      }
    });
  }

  async stop() {
    for (const sessionPromise of this.sessions.values()) {
      try {
        const session = await sessionPromise;
        session.close();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }

  async destroy() {
    await this.stop();
    if (this.serverProcess) {
      this.isStopping = true;
      try {
        treeKill(this.serverProcess.pid);
      } catch {
        this.serverProcess.kill();
      }
      this.serverProcess = null;
    }
    this.serverReady = false;
    this.isInitialized = false;
  }

  async saveAudioFile(audioData, recordId, conversationId, sourceId) {
    if (!this.retainAudioFiles) {
      return null;
    }

    const filename = `${recordId}_${sourceId}.wav`;
    const conversationDir = path.join(this.audioStoragePath, conversationId);
    ensureDir(conversationDir);

    const filepath = path.join(conversationDir, filename);
    const float32Array = audioData instanceof Float32Array ? audioData : new Float32Array(audioData);
    const wavBuffer = createWavBuffer(float32Array);
    fs.writeFileSync(filepath, wavBuffer);
    return filepath;
  }

  clearContext() {
    // handled server side
  }
}

export default ASRService;

