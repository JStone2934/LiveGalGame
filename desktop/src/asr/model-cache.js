import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import * as logger from '../utils/logger.js';
import { getAsrModelPreset } from '../shared/asr-models.js';

export function safeDirSize(targetPath) {
  try {
    const stat = fs.statSync(targetPath, { throwIfNoEntry: false });
    if (!stat) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    const stack = [targetPath];
    while (stack.length) {
      const dir = stack.pop();
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile()) {
          try {
            total += fs.statSync(full).size;
          } catch {
            // ignore stat errors
          }
        } else if (entry.isDirectory()) {
          stack.push(full);
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export function getRepoPathsForModel(preset, cacheDir) {
  const paths = [];
  if (!preset || !cacheDir) return paths;

  if (preset.repoId) {
    const repoSafe = `models--${preset.repoId.replace(/\//g, '--')}`;
    paths.push(path.join(cacheDir, repoSafe));
  }
  if (preset.modelScopeRepoId) {
    paths.push(path.join(cacheDir, 'models', preset.modelScopeRepoId));
    paths.push(path.join(cacheDir, preset.modelScopeRepoId));
    paths.push(path.join(os.homedir(), '.cache', 'modelscope', 'hub', 'models', preset.modelScopeRepoId));
    paths.push(path.join(os.homedir(), '.cache', 'modelscope', 'hub', preset.modelScopeRepoId));
  }

  if (preset.onnxModels) {
    const modelDirs = Array.from(new Set(Object.values(preset.onnxModels).filter(Boolean)));
    modelDirs.forEach((modelDir) => {
      paths.push(path.join(cacheDir, modelDir));
      paths.push(path.join(cacheDir, 'models', modelDir));
    });
  }
  return paths;
}

export function cleanModelScopeLocks(cacheDir, maxAgeMs = 10 * 60 * 1000) {
  if (!cacheDir) return;
  const lockDir = path.join(cacheDir, '.lock');
  try {
    const entries = fs.readdirSync(lockDir, { withFileTypes: true });
    const now = Date.now();
    entries.forEach((entry) => {
      if (!entry.isFile()) return;
      const full = path.join(lockDir, entry.name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < now - maxAgeMs) {
          fs.unlinkSync(full);
          logger.log(`[ASR] Removed stale ModelScope lock: ${entry.name}`);
        }
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore if lock dir missing
  }
}

function getModelCacheCandidates() {
  const homeDir = os.homedir();
  const userDataDir = app.getPath('userData');
  const msEnv = process.env.MODELSCOPE_CACHE || process.env.MODELSCOPE_CACHE_HOME;
  const msBase = msEnv && path.basename(msEnv).toLowerCase() === 'hub' ? path.dirname(msEnv) : msEnv;
  const msHub = msBase ? path.join(msBase, 'hub') : (msEnv && path.basename(msEnv).toLowerCase() === 'hub' ? msEnv : null);
  const appMsBase = path.join(userDataDir, 'asr-cache', 'modelscope');
  const appMsHub = path.join(appMsBase, 'hub');

  return [
    msHub,
    msBase,
    process.env.ASR_CACHE_DIR,
    process.env.HF_HOME ? path.join(process.env.HF_HOME, 'hub') : null,
    appMsHub,  // model-manager.js 默认下载位置（ModelScope hub）
    appMsBase, // model-manager.js 默认下载位置（ModelScope base）
    path.join(userDataDir, 'hf-home', 'hub'),
    path.join(userDataDir, 'ms-cache'),
    homeDir ? path.join(homeDir, '.cache', 'huggingface', 'hub') : null,
    homeDir ? path.join(homeDir, '.cache', 'modelscope', 'hub') : null,
  ].filter(Boolean);
}

export function resolveModelCache(modelName) {
  const preset = getAsrModelPreset(modelName);
  const repoId = preset?.repoId || (typeof modelName === 'string' && modelName.includes('/') ? modelName : null);
  const repoSafe = repoId ? `models--${repoId.replace(/\//g, '--')}` : null;
  const msRepoId = preset?.modelScopeRepoId;
  const candidates = getModelCacheCandidates();

  for (const candidate of candidates) {
    try {
      if (repoSafe && fs.existsSync(path.join(candidate, repoSafe))) {
        return { cacheDir: candidate, found: true };
      }
      if (msRepoId && fs.existsSync(path.join(candidate, 'models', msRepoId))) {
        return { cacheDir: candidate, found: true };
      }
    } catch {
      // ignore and continue
    }
  }

  if (msRepoId) {
    const msDefault = path.join(os.homedir(), '.cache', 'modelscope', 'hub');
    if (fs.existsSync(path.join(msDefault, 'models', msRepoId))) {
      return { cacheDir: msDefault, found: true };
    }
  }

  return { cacheDir: candidates[0] || path.join(app.getPath('userData'), 'hf-home', 'hub'), found: false };
}

/**
 * 在给定的 cacheDir 下查找 modelscope 模型目录
 * modelscope 库的缓存结构是: MODELSCOPE_CACHE/hub/models/<org>/<model>
 * 但历史上也可能存在其他变体，所以我们检查多个可能的路径
 */
function findModelInCache(cacheDir, modelDir) {
  if (!cacheDir || !modelDir) return null;

  // 可能的路径变体（按优先级排序）
  const candidates = [
    path.join(cacheDir, 'hub', 'models', modelDir),  // 标准 modelscope 路径
    path.join(cacheDir, 'models', modelDir),          // 简化路径
    path.join(cacheDir, 'hub', modelDir),             // hub 下直接放
    path.join(cacheDir, modelDir),                    // 根目录下
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

export function resolveFunasrModelScopeCache(preset) {
  if (!preset?.onnxModels) {
    return null;
  }
  const modelDirs = Array.from(new Set(Object.values(preset.onnxModels).filter(Boolean)));

  // 系统默认 modelscope 缓存目录（注意：这里是 base，不是 hub）
  const systemMsCacheBase = path.join(os.homedir(), '.cache', 'modelscope');

  // 检查系统缓存
  try {
    let systemHit = false;
    let systemBytes = 0;
    let foundPath = null;
    for (const dir of modelDirs) {
      const found = findModelInCache(systemMsCacheBase, dir);
      if (found) {
        systemHit = true;
        systemBytes += safeDirSize(found);
        if (!foundPath) foundPath = found;
      }
    }
    if (systemHit && systemBytes > 0) {
      logger.log(`[ASR] Found models in system cache: ${foundPath}`);
      return { cacheDir: systemMsCacheBase, found: true, foundPath };
    }
  } catch {
    // ignore and continue
  }

  const candidates = getModelCacheCandidates();
  let best = null;
  let bestBytes = -1;
  let bestFoundPath = null;

  for (const candidate of candidates) {
    if (candidate === systemMsCacheBase) continue;

    try {
      let hit = false;
      let bytes = 0;
      let firstFoundPath = null;

      for (const dir of modelDirs) {
        const found = findModelInCache(candidate, dir);
        if (found) {
          hit = true;
          bytes += safeDirSize(found);
          if (!firstFoundPath) firstFoundPath = found;
        }
      }

      if (hit && bytes > bestBytes) {
        best = { cacheDir: candidate, found: true };
        bestBytes = bytes;
        bestFoundPath = firstFoundPath;
      }
    } catch {
      // ignore and continue
    }
  }

  if (best) {
    logger.log(`[ASR] Found models in app cache: ${bestFoundPath}`);
    return { ...best, foundPath: bestFoundPath };
  }

  return { cacheDir: systemMsCacheBase, found: false };
}
