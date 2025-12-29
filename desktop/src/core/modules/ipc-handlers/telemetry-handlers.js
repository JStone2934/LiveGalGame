import { ipcMain } from 'electron';

/**
 * 注册训练信号本地埋点写入 IPC 处理器
 */
export function registerTelemetryHandlers({ telemetryService }) {
  if (!telemetryService) {
    console.warn('[TelemetryHandlers] telemetryService not provided, skip registration');
    return;
  }

  ipcMain.handle('telemetry-track', async (_event, payload = {}) => {
    try {
      return await telemetryService.appendEvent(payload);
    } catch (error) {
      console.error('[TelemetryHandlers] track failed', error);
      throw error;
    }
  });

  console.log('[TelemetryHandlers] Telemetry handlers registered');
}
