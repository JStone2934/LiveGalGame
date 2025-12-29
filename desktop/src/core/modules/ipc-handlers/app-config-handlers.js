import { ipcMain, app } from 'electron';
import electron from 'electron';
import path from 'path';
import fs from 'fs';
import {
  getAsrCacheBaseSetting,
  setAsrCacheBaseSetting,
  clearAsrCacheBaseSetting,
  getSiliconflowApiKeySetting,
  setSiliconflowApiKeySetting,
  clearSiliconflowApiKeySetting,
} from '../../app-settings.js';
import { applyAsrCacheEnv, computeAsrCachePaths } from '../../../asr/asr-cache-env.js';

function safeHandle(channel, handler) {
  try {
    if (typeof ipcMain.removeHandler === 'function') {
      ipcMain.removeHandler(channel);
    }
  } catch {
    // ignore
  }
  ipcMain.handle(channel, handler);
}

function normalizeDirInput(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return path.resolve(str);
}

function isExistingDirectory(dirPath) {
  try {
    const stat = fs.statSync(dirPath, { throwIfNoEntry: false });
    return !!stat && stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 注册应用级配置（如模型缓存目录）相关 IPC 处理器
 * @param {object} deps
 * @param {Function} deps.onAsrCacheChanged - async () => void
 */
export function registerAppConfigHandlers({ onAsrCacheChanged }) {
  safeHandle('app-get-model-cache-paths', () => {
    const userDataDir = app.getPath('userData');
    const persistedBase = getAsrCacheBaseSetting();
    const envBase = process.env.ASR_CACHE_BASE || null;
    const effectiveBase = envBase || persistedBase || null;
    const computed = computeAsrCachePaths({ userDataDir, asrCacheBase: effectiveBase });

    return {
      ok: true,
      persistedAsrCacheBase: persistedBase,
      env: {
        ASR_CACHE_BASE: process.env.ASR_CACHE_BASE || '',
        HF_HOME: process.env.HF_HOME || '',
        ASR_CACHE_DIR: process.env.ASR_CACHE_DIR || '',
        MODELSCOPE_CACHE: process.env.MODELSCOPE_CACHE || '',
        MODELSCOPE_CACHE_HOME: process.env.MODELSCOPE_CACHE_HOME || '',
      },
      computed,
      defaults: {
        userDataAsrCacheBase: path.join(userDataDir, 'asr-cache'),
      },
    };
  });

  safeHandle('app-select-directory', async (_event, options = {}) => {
    const parent = electron.BrowserWindow.getFocusedWindow() || null;
    const result = await electron.dialog.showOpenDialog(parent, {
      title: options?.title || '选择目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled) {
      return { canceled: true, path: null };
    }
    const selected = result.filePaths?.[0] ? path.resolve(result.filePaths[0]) : null;
    return { canceled: false, path: selected };
  });

  safeHandle('app-set-asr-cache-base', async (_event, newBaseRaw) => {
    const userDataDir = app.getPath('userData');
    const newBase = normalizeDirInput(newBaseRaw);

    if (!newBase) {
      clearAsrCacheBaseSetting();
      // 强制回落到默认 userData/asr-cache
      const computed = applyAsrCacheEnv({ userDataDir, asrCacheBase: null, force: true });
      if (typeof onAsrCacheChanged === 'function') {
        await onAsrCacheChanged();
      }
      return { ok: true, cleared: true, computed };
    }

    // 目录不存在则尝试创建（跨平台）
    try {
      fs.mkdirSync(newBase, { recursive: true });
    } catch (error) {
      return { ok: false, message: `无法创建目录: ${error?.message || String(error)}` };
    }

    if (!isExistingDirectory(newBase)) {
      return { ok: false, message: '选择的路径不是可用的目录' };
    }

    setAsrCacheBaseSetting(newBase);
    const computed = applyAsrCacheEnv({ userDataDir, asrCacheBase: newBase, force: true });

    if (typeof onAsrCacheChanged === 'function') {
      await onAsrCacheChanged();
    }

    return { ok: true, cleared: false, computed };
  });

  safeHandle('app-get-siliconflow-api-key', () => {
    const persistedKey = getSiliconflowApiKeySetting();
    const envKey = process.env.SILICONFLOW_API_KEY || null;
    const effectiveKey = envKey || persistedKey || '';
    return { ok: true, apiKey: effectiveKey, hasKey: !!effectiveKey };
  });

  safeHandle('app-set-siliconflow-api-key', async (_event, apiKeyRaw) => {
    const trimmed = apiKeyRaw === null || apiKeyRaw === undefined ? '' : String(apiKeyRaw).trim();
    if (!trimmed) {
      clearSiliconflowApiKeySetting();
      delete process.env.SILICONFLOW_API_KEY;
      return { ok: true, cleared: true };
    }

    setSiliconflowApiKeySetting(trimmed);
    process.env.SILICONFLOW_API_KEY = trimmed;
    return { ok: true, cleared: false };
  });

  console.log('App config IPC handlers registered');
}
