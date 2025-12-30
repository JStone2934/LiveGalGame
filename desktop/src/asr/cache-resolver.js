import fs from 'fs';
import path from 'path';

// ModelScope 默认 cache 结构兼容处理
export function normalizeModelScopeCache(cachePath) {
  if (!cachePath) {
    return { base: null, hub: null };
  }
  const normalized = path.resolve(cachePath);
  if (path.basename(normalized).toLowerCase() === 'hub') {
    return { base: path.dirname(normalized), hub: normalized };
  }
  return { base: normalized, hub: path.join(normalized, 'hub') };
}

export function safeReaddir(targetPath) {
  try {
    return fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function directorySize(targetPath) {
  let total = 0;
  const stack = [targetPath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (stat.isFile()) {
          total += stat.size;
        }
      } catch {
        // Ignore files or links that disappear mid-scan
      }
    }
  }
  return total;
}

export function getModelScopeRepoPath(cacheDir, repoId) {
  if (!repoId || !cacheDir) {
    return null;
  }
  const repoSegments = repoId.split(/[\\/]/).filter(Boolean);
  if (repoSegments.length === 0) {
    return null;
  }
  const baseCandidates = [
    cacheDir,
    path.join(cacheDir, 'models'),
    path.join(cacheDir, 'hub'),
    path.join(cacheDir, 'hub', 'models'),
    path.join(cacheDir, 'modelscope'),
    path.join(cacheDir, 'modelscope', 'hub'),
    path.join(cacheDir, 'modelscope', 'hub', 'models'),
  ];
  const uniqueBases = [...new Set(baseCandidates)];
  for (const basePath of uniqueBases) {
    try {
      if (!fs.existsSync(basePath)) {
        continue;
      }
    } catch {
      continue;
    }
    const candidate = path.join(basePath, ...repoSegments);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function findModelInCache(cacheDir, modelDir) {
  if (!cacheDir || !modelDir) return null;

  const candidates = [
    path.join(cacheDir, 'hub', 'models', modelDir),
    path.join(cacheDir, 'models', modelDir),
    path.join(cacheDir, 'hub', modelDir),
    path.join(cacheDir, modelDir),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch {
      // ignore
    }
  }
  return null;
}
