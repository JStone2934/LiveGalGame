import { ipcMain, systemPreferences } from 'electron';
import DatabaseManager from '../../db/database.js';
import ASRModelManager from '../../asr/model-manager.js';
import { ASRRuntimeManager } from '../../asr/asr-runtime-manager.js';
import LLMSuggestionService from './llm-suggestion-service.js';
import ReviewService from './review-service.js';
import MemoryService from './memory-service.js';
import TelemetryService from './telemetry-service.js';
import { registerWindowHandlers } from './ipc-handlers/window-handlers.js';
import { registerDatabaseHandlers } from './ipc-handlers/database-handlers.js';
import { registerLLMHandlers } from './ipc-handlers/llm-handlers.js';
import { registerSuggestionHandlers } from './ipc-handlers/suggestion-handlers.js';
import { registerReviewHandlers } from './ipc-handlers/review-handlers.js';
import { registerMemoryHandlers } from './ipc-handlers/memory-handlers.js';
import { registerTelemetryHandlers } from './ipc-handlers/telemetry-handlers.js';
import { registerASRModelHandlers } from './ipc-handlers/asr-model-handlers.js';
import { registerASRAudioHandlers } from './ipc-handlers/asr-audio-handlers.js';
import { registerMediaHandlers } from './ipc-handlers/media-handlers.js';
import { registerAppConfigHandlers } from './ipc-handlers/app-config-handlers.js';

/**
 * IPC 处理器管理器 - 负责注册所有 IPC 通信处理器
 */
export class IPCManager {
  constructor(windowManager) {
    this.windowManager = windowManager;
    this.db = null;
    this.modelManager = null;
    this.llmSuggestionService = null;
    this.reviewService = null;
    this.memoryService = null;
    this.telemetryService = null;
    this.asrRuntime = new ASRRuntimeManager({
      getDb: () => this.db
    });
  }

  /**
   * 设置 ASR 事件发射器
   */
  setASREventEmitter(emitASREvent) {
    this.emitASREvent = emitASREvent;
    this.asrRuntime.setEventEmitter(emitASREvent);
  }

  /**
   * 设置服务器崩溃回调
   */
  setASRServerCrashCallback(callback) {
    if (callback) {
      this.asrRuntime.addServerCrashListener(callback);
    }
  }

  /**
   * 获取 ASR 运行时管理器
   */
  getASRRuntime() {
    return this.asrRuntime;
  }

  /**
   * 初始化数据库管理器
   */
  initDatabase() {
    if (!this.db) {
      this.db = new DatabaseManager();
    }
  }

  /**
   * 初始化模型管理器
   */
  initModelManager() {
    if (!this.modelManager) {
      this.modelManager = new ASRModelManager();
    }
  }

  /**
   * 初始化 LLM 建议服务
   */
  initLLMSuggestionService() {
    if (!this.llmSuggestionService) {
      this.llmSuggestionService = new LLMSuggestionService(() => this.db);
    }
  }

  /**
   * 初始化 Memory Service（结构化画像/事件侧车）
   */
  initMemoryService() {
    if (!this.memoryService) {
      this.memoryService = new MemoryService();
    }
  }

  /**
   * 初始化 Telemetry Service（本地训练信号 JSONL）
   */
  initTelemetryService() {
    if (!this.telemetryService) {
      this.telemetryService = new TelemetryService();
    }
  }
  /**
   * 初始化 Review Service
   */
  initReviewService() {
    if (!this.reviewService) {
      this.reviewService = new ReviewService(() => this.db);
    }
  }

  /**
   * 注册所有 IPC 处理器
   */
  registerHandlers() {
    console.log('[IPCHandlers] Registering IPC handlers...');

    this.initDatabase();
    this.initModelManager();
    this.initLLMSuggestionService();
    this.initReviewService();
    this.initMemoryService();
    this.initTelemetryService();
    this.setupWindowHandlers();
    this.setupAppConfigHandlers();
    this.setupDatabaseHandlers();
    this.setupLLMHandlers();
    this.setupSuggestionHandlers();
    this.setupReviewHandlers();
    this.setupMemoryHandlers();
    this.setupTelemetryHandlers();
    this.setupASRModelHandlers();
    this.setupASRAudioHandlers();
    this.setupMediaHandlers();

    console.log('[IPCHandlers] All IPC handlers registered successfully');
  }

  /**
   * 设置复盘相关 IPC 处理器
   */
  setupReviewHandlers() {
    registerReviewHandlers({
      reviewService: this.reviewService
    });
  }

  /**
   * 设置窗口相关 IPC 处理器
   */
  setupWindowHandlers() {
    registerWindowHandlers({
      windowManager: this.windowManager,
      checkASRReady: () => this.checkASRReady()
    });
  }

  /**
   * 设置应用级配置相关 IPC 处理器（如模型缓存目录）
   */
  setupAppConfigHandlers() {
    registerAppConfigHandlers({
      onAsrCacheChanged: async () => {
        // 1) 让 ModelManager 重新读取环境变量（下载落盘位置）
        this.modelManager = new ASRModelManager();
        // 2) 重载 ASR 后端，保证其读取到新的缓存目录
        try {
          await this.reloadASRModel();
        } catch (error) {
          console.warn('[ASR] Reload after cache change failed:', error);
        }
      }
    });
  }

  /**
   * 设置数据库相关 IPC 处理器
   */
  setupDatabaseHandlers() {
    registerDatabaseHandlers({ db: this.db });
  }

  /**
   * 设置 LLM 配置相关 IPC 处理器
   */
  setupLLMHandlers() {
    registerLLMHandlers({ db: this.db });
  }

  /**
   * 设置 LLM 建议相关 IPC 处理器
   */
  setupSuggestionHandlers() {
    registerSuggestionHandlers({
      db: this.db,
      llmSuggestionService: this.llmSuggestionService,
      ensureSuggestionService: () => this.initLLMSuggestionService()
    });
  }

  /**
   * 设置 Memory Service 相关 IPC 处理器
   */
  setupMemoryHandlers() {
    this.initMemoryService();
    registerMemoryHandlers({ memoryService: this.memoryService });
  }

  /**
   * 设置 Telemetry 相关 IPC 处理器
   */
  setupTelemetryHandlers() {
    this.initTelemetryService();
    registerTelemetryHandlers({ telemetryService: this.telemetryService });
  }

  /**
   * 设置 ASR 模型管理相关 IPC 处理器
   */
  setupASRModelHandlers() {
    registerASRModelHandlers({
      getModelManager: () => {
        if (!this.modelManager) {
          this.modelManager = new ASRModelManager();
        }
        return this.modelManager;
      }
    });
  }

  /**
   * 设置 ASR 音频处理相关 IPC 处理器
   */
  setupASRAudioHandlers() {
    registerASRAudioHandlers({
      getOrCreateASRManager: () => this.getOrCreateASRManager(),
      emitASREvent: (eventName, payload) => {
        if (this.emitASREvent) {
          this.emitASREvent(eventName, payload);
        }
      },
      checkASRReady: () => this.checkASRReady(),
      reloadASRModel: () => this.reloadASRModel(),
      db: this.db,
      getASRPreloadState: () => this.getASRPreloadState(),
      setASRPreloadState: (preloading, preloaded) => this.setASRPreloadState(preloading, preloaded)
    });
  }

  /**
   * 设置媒体权限相关 IPC 处理器
   */
  setupMediaHandlers() {
    registerMediaHandlers();
  }

  /**
   * 获取或创建 ASR 管理器
   */
  getOrCreateASRManager() {
    this.initDatabase();
    return this.asrRuntime.getOrCreateASRManager();
  }

  /**
   * 检查 ASR 模型是否就绪
   */
  async checkASRReady() {
    return this.asrRuntime.checkReady();
  }

  /**
   * 重新加载 ASR 模型
   */
  async reloadASRModel() {
    await this.asrRuntime.reload();
  }

  /**
   * 获取 ASR 预加载状态
   */
  getASRPreloadState() {
    return this.asrRuntime.getPreloadState();
  }

  /**
   * 设置 ASR 预加载状态
   */
  setASRPreloadState(preloading, preloaded) {
    this.asrRuntime.setPreloadState(preloading, preloaded);
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.asrRuntime.cleanup();
  }
}
