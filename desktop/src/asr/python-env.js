import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * 统一的 Python 解释器探测逻辑
 * - 优先环境变量 ASR_PYTHON_PATH
 * - 其次打包产物中的 python-env
 * - 再退回仓库内的 python-env 或 .venv
 * - 最后回退系统 python3/python
 */
export function detectPythonPath() {
  const envPython = process.env.ASR_PYTHON_PATH;
  if (envPython && fs.existsSync(envPython)) {
    return envPython;
  }

  const resourcesPath = process.resourcesPath;
  const projectRoot = app.isPackaged
    ? path.join(resourcesPath || app.getAppPath(), '..')
    : app.getAppPath();

  const bundledPython = process.platform === 'win32'
    ? path.join(resourcesPath || '', 'python-env', 'Scripts', 'python.exe')
    : path.join(resourcesPath || '', 'python-env', 'bin', 'python3');

  const repoPythonEnv = process.platform === 'win32'
    ? path.join(projectRoot, 'python-env', 'Scripts', 'python.exe')
    : path.join(projectRoot, 'python-env', 'bin', 'python3');

  const candidates = [
    bundledPython,
    repoPythonEnv,
    path.join(projectRoot, '.venv', 'bin', 'python'),
    path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  ];

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore lookup errors and continue
    }
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}
