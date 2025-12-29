/**
 * 准备内置 Python 运行环境，供打包后使用。
 * - 创建 venv: desktop/python-env
 * - 安装 requirements.txt 中的依赖（包含 funasr-onnx 等）
 *
 * 设计目标：
 * 1. 打包时将 python-env 放入 extraResources，客户端无需自行安装 Python。
 * 2. 跨平台（macOS/Windows）调用 pip，避免依赖激活脚本。
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const venvDir = path.join(projectRoot, 'python-env');
const bootstrapDir = path.join(projectRoot, 'python-bootstrap');
const miniforgePrefix = path.join(bootstrapDir, 'miniforge');
const requirementsPath = path.join(projectRoot, 'requirements.txt');
const pyprojectPath = path.join(projectRoot, 'pyproject.toml');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const desiredPy = process.env.PYTHON_VERSION || '3.10';
const prepareMode = (process.env.PREPARE_PYTHON_MODE || (process.env.CI === 'true' ? 'bundle' : 'dev')).toLowerCase();
// auto: 开发模式优先使用 uv（若可用），bundle 模式优先使用 conda-pack（历史实现）
const prepareTool = (process.env.PREPARE_PYTHON_TOOL || 'auto').toLowerCase();
const candidateCmds = [
  process.env.PYTHON,                          // 用户显式指定
  isWin ? `py -${desiredPy}` : null,           // Windows 推荐 py 启动器
  isWin ? `python${desiredPy}` : `python${desiredPy}`, // python3.10
  isWin ? `python${desiredPy.replace('.', '')}` : null, // 兼容 python310
  isWin ? 'python3' : 'python3',
  isWin ? 'python' : 'python',
].filter(Boolean);

const pythonPath = isWin
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python3');
const pipPath = isWin
  ? path.join(venvDir, 'Scripts', 'pip.exe')
  : path.join(venvDir, 'bin', 'pip');

function run(cmd, options = {}) {
  execSync(cmd, { stdio: 'inherit', ...options });
}

function runCapture(cmd, options = {}) {
  try {
    const output = execSync(cmd, { encoding: 'utf-8', ...options });
    return { success: true, stdout: output, stderr: '' };
  } catch (err) {
    return { 
      success: false, 
      stdout: err.stdout?.toString() || '', 
      stderr: err.stderr?.toString() || err.message || err.toString() 
    };
  }
}

function detectPython() {
  for (const cmd of candidateCmds) {
    try {
      const v = execSync(`"${cmd}" -c "import sys;print(sys.version)"`, { encoding: 'utf-8' }).trim();
      const [major, minor] = v.split('.')[0] ? v.split('.').map((n) => parseInt(n, 10)) : [0, 0];
      if (major === 3 && minor >= 8 && minor <= 12) {
        console.log(`[prepare-python-env] using python: ${cmd} (version ${major}.${minor})`);
        return cmd;
      }
      console.warn(`[prepare-python-env] skip ${cmd}, unsupported version ${v}`);
    } catch {
      // ignore and try next
    }
  }
  return null;
}

function isCondaEnvPrefix(prefix) {
  // conda 环境会有 conda-meta/history（比单纯判断 python 可执行文件可靠）
  return fs.existsSync(path.join(prefix, 'conda-meta', 'history'));
}

function isVenvPrefix(prefix) {
  // venv/virtualenv 会有 pyvenv.cfg
  return fs.existsSync(path.join(prefix, 'pyvenv.cfg'));
}

function hasUv() {
  const res = runCapture('uv --version', { stdio: 'pipe' });
  return res.success;
}

function hasPyproject() {
  return fs.existsSync(pyprojectPath);
}

function pathExistsOrSymlink(p) {
  // fs.existsSync 会跟随 symlink；当 symlink 断链时会返回 false。
  // 但我们需要把“断链 symlink”也当作“路径占位存在”，否则创建目录会报 File exists。
  if (fs.existsSync(p)) return true;
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function removeIfBrokenSymlink(p) {
  try {
    const stat = fs.lstatSync(p);
    if (!stat.isSymbolicLink()) return false;
    // 如果是断链 symlink：existsSync 会是 false；这时应删除 link 本身
    if (!fs.existsSync(p)) {
      console.warn(`[prepare-python-env] Detected broken symlink, removing: ${p}`);
      fs.unlinkSync(p);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function bootstrapMiniforge() {
  if (process.platform !== 'darwin') {
    throw new Error(
      `[prepare-python-env] 找不到可用的 Python，请安装 3.10~3.12 并设置环境变量 PYTHON 指向该解释器（当前尝试: ${candidateCmds.join(', ')})`
    );
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const installer = `Miniforge3-MacOSX-${arch}.sh`;
  const url = `https://github.com/conda-forge/miniforge/releases/latest/download/${installer}`;

  if (!fs.existsSync(bootstrapDir)) {
    fs.mkdirSync(bootstrapDir, { recursive: true });
  }

  const installerPath = path.join(bootstrapDir, installer);
  if (!fs.existsSync(installerPath)) {
    console.log(`[prepare-python-env] downloading Miniforge (${arch}) ...`);
    try {
      run(`curl -L --retry 3 --retry-all-errors --http1.1 "${url}" -o "${installerPath}"`);
    } catch (err) {
      // 清理损坏的下载，避免下次误判
      if (fs.existsSync(installerPath)) {
        fs.unlinkSync(installerPath);
      }
      throw err;
    }
    run(`chmod +x "${installerPath}"`);
  } else {
    console.log('[prepare-python-env] Miniforge installer already downloaded');
  }

  // 解除 macOS 安全属性，避免 “Operation not permitted”
  try {
    run(`xattr -d com.apple.quarantine "${installerPath}"`, { stdio: 'ignore' });
  } catch {
    // ignore
  }

  if (!fs.existsSync(path.join(miniforgePrefix, 'bin', 'python'))) {
    console.log('[prepare-python-env] installing Miniforge (py310)...');
    run(`bash "${installerPath}" -b -p "${miniforgePrefix}"`);
  } else {
    console.log('[prepare-python-env] Miniforge already installed');
  }

  const bundledPy = path.join(miniforgePrefix, 'bin', 'python3');
  console.log(`[prepare-python-env] using bootstrapped python: ${bundledPy}`);
  return bundledPy;
}

function ensureCondaEnv(miniforgePython, { forceRebuild = false } = {}) {
  // 兼容：venvDir 可能是断链 symlink（例如 python-env -> .venv 且 .venv 不存在）
  removeIfBrokenSymlink(venvDir);

  let condaBin = isWin
    ? path.join(miniforgePrefix, 'Scripts', 'conda.exe')
    : path.join(miniforgePrefix, 'bin', 'conda');

  if (!fs.existsSync(condaBin)) {
    console.log(`[prepare-python-env] conda not found at ${condaBin}, bootstrapping Miniforge...`);
    const bootstrappedPy = bootstrapMiniforge();
    condaBin = isWin
      ? path.join(miniforgePrefix, 'Scripts', 'conda.exe')
      : path.join(miniforgePrefix, 'bin', 'conda');
    if (!fs.existsSync(condaBin)) {
      throw new Error(`[prepare-python-env] conda still not found at ${condaBin} after bootstrap`);
    }
    miniforgePython = bootstrappedPy;
  }

  if (fs.existsSync(venvDir) && forceRebuild) {
    console.log(`[prepare-python-env] removing existing env for rebuild: ${venvDir}`);
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  // 关键修复：python-env 可能曾用 venv 创建过（没有 conda-meta），这会导致后续 mamba install 直接失败。
  if (fs.existsSync(pythonPath)) {
    if (isCondaEnvPrefix(venvDir)) {
      console.log(`[prepare-python-env] conda env already exists: ${pythonPath}`);
      return;
    }
    console.warn(
      `[prepare-python-env] Detected existing python-env but it is NOT a conda env (missing conda-meta). Rebuilding: ${venvDir}`
    );
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  console.log(`[prepare-python-env] creating conda env (Python ${desiredPy}) at ${venvDir}`);
  run(`"${condaBin}" create -y -p "${venvDir}" python=${desiredPy} pip`);

  // 返回可能更新后的 Miniforge python 路径，便于后续步骤使用同一发行版
  return miniforgePython;
}

function ensureVenv(pythonCmd, { forceRebuild = false } = {}) {
  // 兼容：venvDir 可能是断链 symlink（例如 python-env -> .venv 且 .venv 不存在）
  removeIfBrokenSymlink(venvDir);

  if (fs.existsSync(venvDir) && forceRebuild) {
    console.log(`[prepare-python-env] removing existing venv for rebuild: ${venvDir}`);
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  if (fs.existsSync(pythonPath)) {
    console.log(`[prepare-python-env] venv already exists: ${pythonPath}`);
    return;
  }

    console.log(`[prepare-python-env] creating venv via ${pythonCmd} -m venv "${venvDir}"`);
    run(`"${pythonCmd}" -m venv "${venvDir}"`);
}

function installDeps() {
  if (!fs.existsSync(requirementsPath)) {
    throw new Error(`requirements.txt not found at ${requirementsPath}`);
  }
  // 为 pip 安装禁用代理，避免 socks 依赖错误
  const envNoProxy = {
    ...process.env,
    ALL_PROXY: undefined,
    all_proxy: undefined,
    HTTP_PROXY: undefined,
    http_proxy: undefined,
    HTTPS_PROXY: undefined,
    https_proxy: undefined,
    PIP_NO_PROXY: '*',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };

  console.log(`[prepare-python-env] upgrade pip`);
  run(`"${pythonPath}" -m pip install --upgrade pip`, { env: envNoProxy });

  // 全平台统一安装 requirements（默认使用 FunASR ONNX）
  console.log(`[prepare-python-env] install requirements (platform=${isWin ? 'win' : 'unix'})`);
  
  if (isWin) {
    // Windows 上：先尝试正常安装，如果失败且是 av 相关错误，则跳过 av 继续安装
    // funasr-onnx 不依赖 av，所以可以安全跳过
    const result = runCapture(`"${pythonPath}" -m pip install -r "${requirementsPath}"`, { env: envNoProxy });
    
    if (!result.success) {
      const errorOutput = result.stderr + result.stdout;
      // 检查是否是 av 相关的编译错误
      if (errorOutput.includes('av') && (errorOutput.includes('LNK1181') || errorOutput.includes('Failed building wheel') || errorOutput.includes('failed-wheel-build'))) {
        console.warn('[prepare-python-env] av package build failed (expected on Windows), trying alternative installation...');
        
        // 尝试使用 --only-binary 安装，跳过需要编译的包
        const binaryResult = runCapture(`"${pythonPath}" -m pip install -r "${requirementsPath}" --only-binary=:all:`, { env: envNoProxy });
        
        if (!binaryResult.success) {
          // 如果 --only-binary 也失败，逐个安装关键包（跳过可能有问题的传递依赖）
          console.warn('[prepare-python-env] --only-binary failed, installing critical packages individually...');
          const criticalPkgs = [
            'funasr-onnx==0.4.1',
            'onnxruntime==1.21.1',
            'fastapi>=0.115.0',
            'uvicorn[standard]>=0.30.0',
            'websockets>=12.0',
            'pyinstaller>=6.3.0',
            'python-multipart>=0.0.9',
            'soundfile>=0.12.1',
            'numpy>=1.26.4,<2',
            'jieba>=0.42.1',
            'requests[socks]>=2.31.0',
            'httpx[socks]>=0.27.0',
          ];
          
          let allSuccess = true;
          for (const pkg of criticalPkgs) {
            const pkgResult = runCapture(`"${pythonPath}" -m pip install "${pkg}"`, { env: envNoProxy });
            if (!pkgResult.success) {
              console.warn(`[prepare-python-env] Failed to install ${pkg}: ${pkgResult.stderr.substring(0, 200)}`);
              allSuccess = false;
            }
          }
          
          if (!allSuccess) {
            console.warn('[prepare-python-env] Some packages failed to install, but continuing...');
          }
        }
      } else {
        // 其他错误，直接抛出
        console.error('[prepare-python-env] Installation failed:', result.stderr);
        throw new Error(`pip install failed: ${result.stderr.substring(0, 500)}`);
      }
    }
  } else {
    run(`"${pythonPath}" -m pip install -r "${requirementsPath}"`, { env: envNoProxy });
  }
}

function ensureCondaPackInstalled(miniforgePython) {
  console.log('[prepare-python-env] ensure conda-pack is installed in base');
  run(`"${miniforgePython}" -m pip install --upgrade conda-pack`);
}

function installCondaPackages(packages) {
  const mambaBin = path.join(miniforgePrefix, isWin ? 'Scripts' : 'bin', isWin ? 'mamba.exe' : 'mamba');
  const condaBin = path.join(miniforgePrefix, isWin ? 'Scripts' : 'bin', isWin ? 'conda.exe' : 'conda');
  const installer = fs.existsSync(mambaBin) ? mambaBin : condaBin;
  if (!fs.existsSync(installer)) {
    throw new Error('[prepare-python-env] neither mamba nor conda found');
  }
  const pkgList = packages.join(' ');
  console.log(`[prepare-python-env] conda installing packages: ${pkgList}`);
  run(`"${installer}" install -y -p "${venvDir}" -c conda-forge ${pkgList}`);
}

function packCondaEnv() {
  const tarPath = `${venvDir}.tar.gz`;
  console.log(`[prepare-python-env] packing env with conda-pack -> ${tarPath}`);
  run(`"${miniforgePrefix}/bin/conda-pack" -p "${venvDir}" -o "${tarPath}" -f`);

  console.log(`[prepare-python-env] repacking env to make it relocatable`);
  fs.rmSync(venvDir, { recursive: true, force: true });
  fs.mkdirSync(venvDir, { recursive: true });
  run(`tar -xzf "${tarPath}" -C "${venvDir}"`);
  run(`"${path.join(venvDir, 'bin', 'conda-unpack')}"`);
  fs.rmSync(tarPath, { force: true });
}

function ensureUvVenv(pythonSpec, { forceRebuild = false, relocatable = false } = {}) {
  const useRelocatable = relocatable ? '--relocatable' : '';
  // 兼容：venvDir 可能是断链 symlink（例如 python-env -> .venv 且 .venv 不存在）
  removeIfBrokenSymlink(venvDir);

  if (pathExistsOrSymlink(venvDir) && (forceRebuild || !isVenvPrefix(venvDir))) {
    console.log(`[prepare-python-env] (uv) clearing existing env: ${venvDir}`);
    // uv venv --clear 会清理目标目录；这里也兼容“目录存在但不是 venv”的情况
    run(`uv venv "${venvDir}" --clear ${useRelocatable} --python "${pythonSpec}" --managed-python`);
    return;
  }
  if (fs.existsSync(pythonPath) && isVenvPrefix(venvDir)) {
    console.log(`[prepare-python-env] (uv) venv already exists: ${pythonPath}`);
    return;
  }
  console.log(`[prepare-python-env] (uv) creating venv at ${venvDir} (python=${pythonSpec}${relocatable ? ', relocatable' : ''})`);
  run(`uv venv "${venvDir}" ${useRelocatable} --python "${pythonSpec}" --managed-python`);
}

function installDepsWithUv() {
  if (!fs.existsSync(requirementsPath)) {
    throw new Error(`requirements.txt not found at ${requirementsPath}`);
  }
  console.log('[prepare-python-env] (uv) installing requirements via uv pip ...');
  // uv 会自己处理 pip/resolve/缓存；这里显式指定目标 python
  run(`uv pip install -r "${requirementsPath}" -p "${pythonPath}"`);
}

/**
 * 使用 uv sync（pyproject.toml 模式）一次性创建 venv 并安装依赖
 * 比 uv venv + uv pip install 更简洁、更可靠
 */
function ensureUvSync({ forceRebuild = false, pythonSpec = desiredPy } = {}) {
  // 清理断链 symlink
  removeIfBrokenSymlink(venvDir);

  if (forceRebuild && pathExistsOrSymlink(venvDir)) {
    console.log(`[prepare-python-env] (uv sync) removing existing env for rebuild: ${venvDir}`);
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  console.log(`[prepare-python-env] (uv sync) syncing project (python=${pythonSpec}) ...`);
  // uv sync 会自动：创建 venv（如不存在）、解析 pyproject.toml、安装依赖
  // --python 指定版本，--managed-python 让 uv 自动下载对应版本
  // UV_PROJECT_ENVIRONMENT 指定 venv 路径（默认是 .venv，我们改成 python-env）
  run(`uv sync --python "${pythonSpec}" --managed-python`, {
    cwd: projectRoot,
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: venvDir },
  });
}

/**
 * Patch funasr_onnx/__init__.py，移除对 torch 的无用依赖（兼容层）
 * funasr_onnx >= 0.3 的 __init__.py 无条件导入了 sensevoice_bin（需要 torch），
 * 但本项目不使用 SenseVoice。当前 pyproject.toml 锁定 funasr-onnx < 0.3 以避免此问题，
 * 此 patch 仅作为兼容层，以防未来升级。
 */
function patchFunasrOnnx() {
  const sitePackages = path.join(venvDir, isWin ? 'Lib/site-packages' : 'lib/python' + desiredPy + '/site-packages');
  const initFile = path.join(sitePackages, 'funasr_onnx', '__init__.py');

  if (!fs.existsSync(initFile)) {
    console.log('[prepare-python-env] funasr_onnx not found, skipping patch');
    return;
  }

  let content = fs.readFileSync(initFile, 'utf-8');

  // 检查是否已经 patch 过
  if (content.includes('# PATCHED: sensevoice_bin')) {
    console.log('[prepare-python-env] funasr_onnx already patched');
    return;
  }

  // 替换 sensevoice_bin 的导入为 try/except
  const originalImport = 'from .sensevoice_bin import SenseVoiceSmall';
  const patchedImport = `# PATCHED: sensevoice_bin requires torch, but we don't use SenseVoice
try:
    from .sensevoice_bin import SenseVoiceSmall
except ImportError:
    SenseVoiceSmall = None`;

  if (content.includes(originalImport)) {
    content = content.replace(originalImport, patchedImport);
    fs.writeFileSync(initFile, content);
    console.log('[prepare-python-env] patched funasr_onnx to skip torch dependency');
  } else {
    console.log('[prepare-python-env] funasr_onnx import pattern not found, skipping patch');
  }
}

/**
 * 修复 venv 中的 Python 符号链接为实际文件副本
 * venv 创建的符号链接是绝对路径，打包后在其他机器上会失效
 */
function fixPythonSymlinks() {
  const binDir = path.join(venvDir, isWin ? 'Scripts' : 'bin');
  const pythonLinks = isWin
    ? ['python.exe', 'python3.exe']
    : ['python', 'python3', `python${desiredPy}`];

  for (const linkName of pythonLinks) {
    const linkPath = path.join(binDir, linkName);
    if (!fs.existsSync(linkPath)) {
      continue;
    }

    try {
      const stat = fs.lstatSync(linkPath);
      if (!stat.isSymbolicLink()) {
        continue; // 已经是实际文件，跳过
      }

      const target = fs.readlinkSync(linkPath);
      // 检查是否是绝对路径的符号链接
      if (path.isAbsolute(target) && fs.existsSync(target)) {
        console.log(`[prepare-python-env] fixing symlink: ${linkName} -> ${target}`);
        // 删除符号链接，复制实际文件
        fs.unlinkSync(linkPath);
        fs.copyFileSync(target, linkPath);
        // 确保可执行权限
        if (!isWin) {
          fs.chmodSync(linkPath, 0o755);
        }
        console.log(`[prepare-python-env] replaced symlink with actual file: ${linkName}`);
      }
    } catch (err) {
      console.warn(`[prepare-python-env] warning: failed to fix ${linkName}:`, err.message);
    }
  }
}

function main() {
  // CI 场景强制使用 Miniforge，避免使用系统 Framework Python 导致打包后动态链接失效
  const forceMiniforge = isMac && process.env.CI === 'true';
  const forceRebuild = forceMiniforge || process.env.FORCE_REBUILD_VENV === 'true';

  let pythonCmd = forceMiniforge ? null : detectPython();

  // 如果检测到的 python 是 macOS Framework 路径，也切换到 Miniforge
  const isMacFrameworkPython = pythonCmd && isMac &&
    pythonCmd.includes('/Library/Frameworks/Python.framework');

  if (!pythonCmd || forceMiniforge || isMacFrameworkPython) {
    pythonCmd = bootstrapMiniforge();
  }

  const toolAutoPreferUv = prepareTool === 'auto' && prepareMode === 'dev' && hasUv();
  const useUv = prepareTool === 'uv' || toolAutoPreferUv;
  const useBundle = prepareMode === 'bundle';

  if (isMac) {
    // macOS:
    // - dev: 默认用 uv（若可用）创建 venv 并安装依赖，避免 Miniforge+conda-pack 的笨重流程
    // - bundle: 默认使用 conda env + conda-pack，确保可搬运（打包发布）
    if (useUv) {
      // 优先使用 pyproject.toml + uv sync（更现代、更干净）
      if (hasPyproject()) {
        ensureUvSync({ forceRebuild, pythonSpec: desiredPy });
      } else {
        // 回退：uv venv + uv pip install（兼容只有 requirements.txt 的场景）
        ensureUvVenv(desiredPy, { forceRebuild, relocatable: useBundle });
        installDepsWithUv();
      }
      // patch funasr_onnx 以移除对 torch 的无用依赖
      patchFunasrOnnx();
      // 只在 bundle 模式下 fix symlinks（开发模式保持 symlink 指向 uv managed python）
      if (useBundle) {
        fixPythonSymlinks();
      }
    } else if (useBundle) {
      const updatedPy = ensureCondaEnv(pythonCmd, { forceRebuild });
      if (updatedPy) {
        pythonCmd = updatedPy;
      }
      ensureCondaPackInstalled(pythonCmd);
      // 以前这里安装 ffmpeg/av；当前默认 ONNX 推理不需要，且容易引入体积/失败点。
      // 如确有需求，可通过 PREPARE_INSTALL_MEDIA_DEPS=1 启用。
      if (process.env.PREPARE_INSTALL_MEDIA_DEPS === '1') {
        installCondaPackages(['ffmpeg', 'av=11.*']);
      }
      installDeps();
      packCondaEnv();
      fixPythonSymlinks();
    } else {
      // mac dev 非 uv：走普通 venv + pip（比 conda-pack 更轻）
      ensureVenv(pythonCmd, { forceRebuild });
      installDeps();
      fixPythonSymlinks();
    }
  } else {
    // Windows/Linux：沿用 venv + pip（可选 uv 也可用，但先保持稳定）
    ensureVenv(pythonCmd, { forceRebuild });
    installDeps();
    fixPythonSymlinks();
  }
  console.log('[prepare-python-env] done');
}

main();

