import { ipcMain } from 'electron';
import path from 'path';
import * as fs from 'node:fs/promises';

const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50MB (base64 会更大，限制避免主进程内存被打爆)
const ALLOWED_AUDIO_EXTS = new Set(['.wav', '.webm']);

function normalizeFilePathInput(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Null byte guard (avoid odd filesystem behavior)
  if (trimmed.includes('\0')) return null;
  return trimmed;
}

function resolvePathSafe(value) {
  const raw = normalizeFilePathInput(value);
  if (!raw) return null;
  return path.resolve(raw);
}

function isAllowedAudioPath(filePath) {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_AUDIO_EXTS.has(ext);
}

/**
 * 注册 ASR 音频处理相关 IPC 处理器
 * @param {object} deps
 * @param {Function} deps.getOrCreateASRManager
 * @param {Function} deps.emitASREvent
 * @param {Function} deps.checkASRReady
 * @param {Function} deps.reloadASRModel
 * @param {object} deps.db
 * @param {Function} deps.getASRPreloadState
 * @param {Function} deps.setASRPreloadState
 */
export function registerASRAudioHandlers({
  getOrCreateASRManager,
  emitASREvent,
  checkASRReady,
  reloadASRModel,
  db,
  getASRPreloadState,
  setASRPreloadState
}) {
  ipcMain.handle('asr-initialize', async (event, conversationId) => {
    try {
      const asrManager = getOrCreateASRManager();
      const { preloaded } = getASRPreloadState();
      if (preloaded && asrManager.isInitialized) {
        asrManager.currentConversationId = conversationId;
        if (!asrManager.isRunning) {
          await asrManager.start(conversationId);
        }
        return true;
      }
      return await asrManager.initialize(conversationId);
    } catch (error) {
      console.error('Error initializing ASR:', error);
      throw error;
    }
  });

  ipcMain.on('asr-audio-data', async (event, data) => {
    try {
      const asrManager = getOrCreateASRManager();

      if (!asrManager.isInitialized) {
        console.warn('[ASR] ASRManager not initialized (isInitialized=false), audio data ignored');
        return;
      }

      if (!asrManager.isRunning) {
        console.warn('[ASR] ASRManager not running, audio data ignored');
        return;
      }

      const result = await asrManager.processAudioData(data);
      if (result) {
        emitASREvent('asr-sentence-complete', result);
      }
    } catch (error) {
      console.error('Error processing audio data:', error);
      emitASREvent('asr-error', {
        sourceId: data.sourceId,
        error: error.message
      });
    }
  });

  // 【仅云端】渲染进程 VAD 静音断句触发：提交当前分段，生成多条消息
  ipcMain.on('asr-silence-commit', async (event, payload) => {
    try {
      const asrManager = getOrCreateASRManager();
      if (!asrManager?.isInitialized || !asrManager?.isRunning) {
        return;
      }
      const modelName = String(asrManager.modelName || '');
      // 二次保险：只对 cloud 模型生效，避免影响 FunASR
      if (!modelName.includes('cloud')) {
        return;
      }
      const sourceId = payload?.sourceId;
      if (!sourceId) return;
      await asrManager.triggerSilenceCommit(sourceId);
    } catch (error) {
      console.error('Error handling asr-silence-commit:', error);
    }
  });

  ipcMain.handle('asr-check-ready', async () => {
    return await checkASRReady();
  });

  ipcMain.handle('asr-start', async (event, conversationId) => {
    try {
      console.log(`[ASR] Starting ASR with conversationId: ${conversationId}`);
      const asrManager = getOrCreateASRManager();
      await asrManager.start(conversationId);
      console.log('[ASR] ASR started successfully');
      return { success: true };
    } catch (error) {
      console.error('[ASR] Error starting ASR:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-stop', async () => {
    try {
      const asrManager = getOrCreateASRManager();
      await asrManager.stop();
      return { success: true };
    } catch (error) {
      console.error('Error stopping ASR:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-get-configs', () => {
    try {
      return db.getASRConfigs();
    } catch (error) {
      console.error('Error getting ASR configs:', error);
      return [];
    }
  });

  ipcMain.handle('asr-create-config', (event, configData) => {
    try {
      return db.createASRConfig(configData);
    } catch (error) {
      console.error('Error creating ASR config:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-update-config', (event, id, updates) => {
    try {
      return db.updateASRConfig(id, updates);
    } catch (error) {
      console.error('Error updating ASR config:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-delete-config', (event, id) => {
    try {
      return db.deleteASRConfig(id);
    } catch (error) {
      console.error('Error deleting ASR config:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-reload-model', async () => {
    try {
      await reloadASRModel();
      return { success: true };
    } catch (error) {
      console.error('[ASR] Error reloading ASR model:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-set-default-config', (event, id) => {
    try {
      return db.setDefaultASRConfig(id);
    } catch (error) {
      console.error('Error setting default ASR config:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-get-audio-sources', () => {
    try {
      return db.getAudioSources();
    } catch (error) {
      console.error('Error getting audio sources:', error);
      return [];
    }
  });

  ipcMain.handle('asr-create-audio-source', (event, sourceData) => {
    try {
      return db.createAudioSource(sourceData);
    } catch (error) {
      console.error('Error creating audio source:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-update-audio-source', (event, id, updates) => {
    try {
      return db.updateAudioSource(id, updates);
    } catch (error) {
      console.error('Error updating audio source:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-get-speech-records', (event, conversationId) => {
    try {
      return db.getSpeechRecordsByConversation(conversationId);
    } catch (error) {
      console.error('Error getting speech records:', error);
      return [];
    }
  });

  ipcMain.handle('asr-convert-to-message', async (event, recordId, conversationId) => {
    try {
      const asrManager = getOrCreateASRManager();
      return await asrManager.convertRecordToMessage(recordId, conversationId);
    } catch (error) {
      console.error('Error converting record to message:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-cleanup-audio-files', async (event, retentionDays) => {
    try {
      const asrManager = getOrCreateASRManager();
      return asrManager.cleanupExpiredAudioFiles(retentionDays);
    } catch (error) {
      console.error('Error cleaning up audio files:', error);
      throw error;
    }
  });

  ipcMain.handle('asr-get-audio-data-url', async (event, filePath) => {
    try {
      const rawPath = normalizeFilePathInput(filePath);
      if (!rawPath) return null;

      // 关键安全点：仅允许读取「数据库里已有记录」的音频文件路径，避免渲染进程任意读本机文件。
      // UI 传入的 filePath 正常情况下就是 record.audio_file_path。
      const record =
        (typeof db.getSpeechRecordByAudioPath === 'function' ? db.getSpeechRecordByAudioPath(rawPath) : null)
        || (typeof db.getSpeechRecordByAudioPath === 'function' ? db.getSpeechRecordByAudioPath(path.resolve(rawPath)) : null);

      if (!record?.audio_file_path) {
        console.warn('[ASR] audio data url requested for unknown path (not in DB)');
        return null;
      }

      const resolvedRecordPath = resolvePathSafe(record.audio_file_path);
      const resolvedRequestPath = resolvePathSafe(rawPath);
      if (!resolvedRecordPath || !resolvedRequestPath) return null;

      // 防止 “传入一个不同路径但指向同一文件” 的绕过：尽可能用 realpath 做一致性校验
      const realRecordPath = await fs.realpath(resolvedRecordPath).catch(() => resolvedRecordPath);
      const realRequestPath = await fs.realpath(resolvedRequestPath).catch(() => resolvedRequestPath);
      if (realRecordPath !== realRequestPath) {
        console.warn('[ASR] audio data url path mismatch', { realRecordPath, realRequestPath });
        return null;
      }

      if (!isAllowedAudioPath(realRecordPath)) {
        console.warn('[ASR] audio data url rejected due to extension', realRecordPath);
        return null;
      }

      const stat = await fs.stat(realRecordPath).catch(() => null);
      if (!stat?.isFile?.()) return null;
      if (stat.size > MAX_AUDIO_BYTES) {
        console.warn('[ASR] audio data url rejected due to size', { size: stat.size, max: MAX_AUDIO_BYTES });
        return null;
      }

      const buffer = await fs.readFile(realRecordPath);
      const base64 = buffer.toString('base64');
      // Assume WAV for simplicity, or detect from extension
      const ext = realRecordPath.split('.').pop().toLowerCase();
      const mimeType = ext === 'webm' ? 'audio/webm' : 'audio/wav';
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      console.error('Error reading audio file:', error);
      return null;
    }
  });

  ipcMain.handle('asr-delete-audio-file', async (event, { recordId, filePath }) => {
    try {
      if (!recordId) {
        return { success: false, error: 'recordId is required' };
      }

      const record = db.getSpeechRecordById(recordId);
      if (!record) {
        return { success: false, error: `Speech record not found: ${recordId}` };
      }

      const expectedPath = record.audio_file_path || null;
      if (!expectedPath) {
        // 数据库里已经没有关联文件了：当作成功（幂等）
        db.deleteSpeechRecordAudio(recordId);
        return { success: true, skipped: true };
      }

      // 关键安全点：不信任渲染进程传入的 filePath，只允许删除与 recordId 绑定的那一个文件。
      if (filePath) {
        const expectedResolved = resolvePathSafe(expectedPath);
        const providedResolved = resolvePathSafe(filePath);
        if (expectedResolved && providedResolved && expectedResolved !== providedResolved) {
          return { success: false, error: 'filePath does not match recordId' };
        }
      }

      const resolved = resolvePathSafe(expectedPath);
      if (!resolved || !isAllowedAudioPath(resolved)) {
        return { success: false, error: 'Invalid audio file path' };
      }

      const realPath = await fs.realpath(resolved).catch(() => resolved);
      await fs.unlink(realPath).catch((err) => {
        if (err?.code === 'ENOENT') return;
        console.warn('Physical file already gone or could not be deleted:', err);
      });

      db.deleteSpeechRecordAudio(recordId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting audio file:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('ASR Audio IPC handlers registered');
}
