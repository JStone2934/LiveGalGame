

/**
 * ASR 预加载器 - 负责在应用启动时预加载 ASR 模型
 */
export class ASRPreloader {
  constructor(asrRuntimeManager) {
    this.asrRuntime = asrRuntimeManager;
    // 不再维护独立的 asrManager 实例，而是使用统一的运行时管理器
  }

  /**
   * 设置事件发射器
   */
  setASREventEmitter(emitASREvent) {
    this.emitASREvent = emitASREvent;
    if (this.asrRuntime) {
      this.asrRuntime.setEventEmitter(emitASREvent);
    }
  }

  /**
   * 设置服务器崩溃回调
   */
  setServerCrashCallback(callback) {
    this.serverCrashCallback = callback;
    if (this.asrRuntime && callback) {
      this.asrRuntime.addServerCrashListener(callback);
    }
  }

  /**
   * 预加载 ASR 模型（应用启动时进行）
   */
  async preload() {
    const state = this.asrRuntime.getPreloadState();

    if (state.preloading || state.preloaded) {
      return;
    }

    try {
      await this.asrRuntime.preload();
    } catch (error) {
      console.error('[ASR] 预加载ASR模型失败:', error);
      this.asrRuntime.setPreloadState(false, false);
      // 预加载失败不影响应用启动，后续使用时再加载
    }
  }

  /**
   * 重新加载 ASR 模型
   */
  async reload() {
    console.log('[ASR] 重新加载 ASR 模型');

    // 使用 IPCManager 清理现有实例
    await this.asrRuntime.reload();

    // 重新预加载
    await this.preload();
    console.log('[ASR] ASR 模型重新加载完成');
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 资源清理主要由 IPCManager 负责，这里不需要做额外操作
    console.log('ASR预加载器已清理');
  }
}
