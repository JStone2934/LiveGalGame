import fs from 'fs';
import path from 'path';
import { applyAsrCacheEnv } from '../asr/asr-cache-env.js';

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

/**
 * 手动加载 .env 文件（Electron 主进程不会自动加载）
 */
export function loadDotEnv({ baseDir, logger = console } = {}) {
  const root = baseDir || process.cwd();
  const possiblePaths = [
    path.resolve(root, '.env'),
    path.resolve(root, 'desktop', '.env'),
    path.resolve(root, 'desktop', 'src', '.env')
  ];

  for (const envPath of possiblePaths) {
    if (!fs.existsSync(envPath)) continue;

    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex <= 0) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      logger.log(`[ENV] Loaded .env from: ${envPath}`);
      return true;
    } catch (err) {
      logger.warn(`[ENV] Failed to load ${envPath}:`, err.message);
    }
  }

  logger.warn('[ENV] No .env file found');
  return false;
}

export function snapshotAppEnv({ maskSecrets = true } = {}) {
  const siliconflowKey = process.env.SILICONFLOW_API_KEY || '';
  return {
    ASR_CACHE_BASE: process.env.ASR_CACHE_BASE || '',
    HF_HOME: process.env.HF_HOME || '',
    ASR_CACHE_DIR: process.env.ASR_CACHE_DIR || '',
    MODELSCOPE_CACHE: process.env.MODELSCOPE_CACHE || process.env.MODELSCOPE_CACHE_HOME || '',
    SILICONFLOW_API_KEY: maskSecrets ? maskSecret(siliconflowKey) : siliconflowKey,
  };
}

export function logAppEnv(logger = console) {
  const env = snapshotAppEnv();
  logger.log('[ENV] Effective config:', env);
  return env;
}

export function initAppEnv({ userDataDir, getAsrCacheBaseSetting, getSiliconflowApiKeySetting, logger = console } = {}) {
  const persistedBase = process.env.ASR_CACHE_BASE ? null : getAsrCacheBaseSetting?.();
  const cachePaths = applyAsrCacheEnv({
    userDataDir,
    asrCacheBase: process.env.ASR_CACHE_BASE || persistedBase
  });

  if (!process.env.SILICONFLOW_API_KEY) {
    const persistedKey = getSiliconflowApiKeySetting?.();
    if (persistedKey) {
      process.env.SILICONFLOW_API_KEY = persistedKey;
    }
  }

  const env = logAppEnv(logger);
  return { cachePaths, env };
}
