import ASRManager from './asr-manager.js';

/**
 * ASRRuntimeManager - 统一管理 ASR 生命周期与就绪状态
 */
export class ASRRuntimeManager {
  constructor({ getDb } = {}) {
    this.getDb = getDb;
    this.emitASREvent = null;
    this.asrManager = null;
    this.preloading = false;
    this.preloaded = false;
    this.serverCrashListeners = new Set();
  }

  setDbProvider(getDb) {
    this.getDb = getDb;
  }

  setEventEmitter(emitASREvent) {
    this.emitASREvent = emitASREvent;
    if (this.asrManager && this.emitASREvent) {
      this.asrManager.setEventEmitter(this.emitASREvent);
    }
  }

  addServerCrashListener(listener) {
    if (listener) {
      this.serverCrashListeners.add(listener);
    }
  }

  removeServerCrashListener(listener) {
    this.serverCrashListeners.delete(listener);
  }

  _handleServerCrash(exitCode) {
    console.error(`[ASR] 服务器崩溃 (code: ${exitCode})，重置预加载状态`);
    this.preloaded = false;
    this.preloading = false;

    for (const listener of this.serverCrashListeners) {
      try {
        listener(exitCode);
      } catch (error) {
        console.error('[ASR] Server crash listener failed:', error);
      }
    }
  }

  _bindASRManager(manager) {
    if (this.emitASREvent) {
      manager.setEventEmitter(this.emitASREvent);
    }
    manager.setServerCrashCallback((exitCode) => this._handleServerCrash(exitCode));
  }

  getOrCreateASRManager() {
    if (!this.asrManager) {
      const db = this.getDb ? this.getDb() : null;
      if (!db) {
        throw new Error('ASRRuntimeManager requires database to initialize ASRManager');
      }
      this.asrManager = new ASRManager(db);
      this._bindASRManager(this.asrManager);
    }
    return this.asrManager;
  }

  async preload() {
    if (this.preloading || this.preloaded) {
      return;
    }

    try {
      this.preloading = true;
      console.log('[ASR] 开始预加载ASR模型...');

      const asrManager = this.getOrCreateASRManager();
      await asrManager.initialize(null);

      this.preloaded = true;
      console.log('[ASR] ASR模型预加载完成');
    } catch (error) {
      console.error('[ASR] 预加载ASR模型失败:', error);
      this.preloaded = false;
    } finally {
      this.preloading = false;
    }
  }

  async reload() {
    console.log('[ASR] 重新加载 ASR 模型');
    this.preloading = true;

    if (this.asrManager) {
      try {
        await this.asrManager.stop();
      } catch (error) {
        console.warn('[ASR] 停止现有 ASR 任务失败:', error);
      }
      try {
        this.asrManager.destroy();
      } catch (error) {
        console.warn('[ASR] 销毁 ASR 管理器失败:', error);
      }
      this.asrManager = null;
    }

    try {
      const asrManager = this.getOrCreateASRManager();
      await asrManager.initialize(null);
      this.preloaded = true;
    } catch (error) {
      console.error('[ASR] 重新加载并初始化 ASR 模型失败:', error);
      this.preloaded = false;
      throw error;
    } finally {
      this.preloading = false;
    }
  }

  checkReady() {
    const isDownloading = this.asrManager?.whisperService?.isDownloading === true;

    if (isDownloading) {
      return {
        ready: false,
        message: '正在下载语音模型，首次下载可能较慢，请耐心等待...',
        downloading: true
      };
    }

    if (this.preloading) {
      return {
        ready: false,
        message: 'ASR模型正在预加载（请稍等，非报错）',
        preloading: true
      };
    }

    if (this.preloaded && this.asrManager && this.asrManager.isInitialized) {
      return {
        ready: true,
        message: 'ASR模型已就绪',
        preloaded: true
      };
    }

    if (this.asrManager && !this.asrManager.isInitialized) {
      return {
        ready: false,
        message: 'ASR模型正在初始化...',
        initializing: true
      };
    }

    if (!this.asrManager) {
      return {
        ready: false,
        message: 'ASR模型未加载，请稍候...',
        notStarted: true
      };
    }

    return {
      ready: false,
      message: 'ASR模型状态未知'
    };
  }

  getPreloadState() {
    return {
      preloading: this.preloading,
      preloaded: this.preloaded
    };
  }

  setPreloadState(preloading, preloaded) {
    this.preloading = preloading;
    this.preloaded = preloaded;
  }

  cleanup() {
    if (this.asrManager) {
      try {
        this.asrManager.destroy();
      } catch (error) {
        console.error('Error destroying ASR manager:', error);
      }
    }
  }
}
