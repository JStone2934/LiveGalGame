# LiveGalGame Desktop

> 🖥️ Windows / macOS 桌面端 —— 让语音聊天也能像 GalGame 一样有字幕和选项

[← 返回主页](../README.md)

---

## 这是什么？

一个浮动在你聊天软件上方的智能助手窗口。它能：

- **实时显示字幕** —— 你说的话、对方说的话，全部转成文字
- **给出 AI 回复建议** —— 关键时刻告诉你该说什么
- **显示好感度变化** —— 让聊天效果可视化

半透明、置顶、可拖动，不干扰你正常使用任何聊天软件。

---

## 🎮 使用流程

### 1️⃣ 创建对话对象
点击"新建对话"，填写：
- 对方昵称
- 你们的关系
- 备注信息（比如对方的喜好）

> 💡 这些信息会帮助 AI 更懂你的场景

### 2️⃣ 启动浮动窗口
点击"开始对话"，一个小窗会出现在屏幕上：
- 半透明设计，不遮挡聊天界面
- 可以拖动到任意位置
- 始终置顶显示

### 3️⃣ 开始聊天
打开你的聊天软件（微信、QQ、Discord...），开始语音对话：
- 你说的话会实时转成文字显示
- 对方说的话也会被识别并显示
- 再也不用担心听漏或忘记

### 4️⃣ 获取 AI 建议
当对方问你问题或对话到了关键时刻：
- AI 会自动弹出回复建议
- 每个选项都带有情感标签（温柔/幽默/直接...）
- 还会预测这样说的效果

### 5️⃣ 看到反馈
选择一个回复说出来后：
- 好感度进度条会动态变化
- 比如：`❤️ 好感度: 50 → 70 (+20 ↗)`
- 把"聊得好"变成看得见的成就

---

## ✨ 设计亮点

| 特性 | 说明 |
|------|------|
| 🪟 场景化设计 | 浮动窗口完美融入你已有的聊天场景 |
| 🎮 游戏化体验 | 好感度预测和实时变化，让聊天像玩游戏 |
| 🧠 可解释 AI | 不只给建议，还告诉你为什么这样说更好 |
| 🔇 离线可用 | 语音识别本地运行，隐私有保障 |

---

## 🚀 快速开始

### 安装

```bash
git clone https://github.com/JStone2934/LiveGalGame.git
cd LiveGalGame/desktop
pnpm install
```

### 配置语音识别

```bash
# 准备内置 Python 运行环境（会创建 desktop/python-env 并安装依赖,uv 会自行管理lib）
PREPARE_PYTHON_TOOL=uv pnpm run prepare:python
```

- 本项目桌面端的本地 ASR **默认使用 FunASR ONNX（`funasr-onnx + onnxruntime`）**，因此 **不需要安装 `torch`**。
- Windows 也使用 FunASR ONNX，无需额外安装 faster-whisper。

**依赖管理**：

- 项目使用 `pyproject.toml` 管理 Python 依赖（现代标准）
- 推荐安装 [uv](https://docs.astral.sh/uv/)（更快的包管理器）：`brew install uv`

**关于 `prepare:python`**：

| 模式 | 命令 | 说明 |
|------|------|------|
| 开发（默认） | `pnpm run prepare:python` | macOS 优先使用 `uv sync`，无 uv 时回退到 venv/pip |
| 打包/发布 | `PREPARE_PYTHON_MODE=bundle pnpm run prepare:python` | 创建可搬运的内置 Python 环境 |

### 启动

```bash
pnpm dev
```

---

## 💻 系统要求

- **Windows**: 10 / 11
- **macOS**: 12.0+
- 需要麦克风权限
- Node.js 20+, Python 3.10+（推荐安装 [uv](https://docs.astral.sh/uv/)）

---

## ❓ 常见问题

**听不到声音？**
- 检查系统麦克风权限
- 在应用设置中选择正确的音频输入设备

**识别不准确？**
- 调整麦克风距离（建议 20-30cm）
- 在安静环境下效果更好

**窗口挡住了聊天界面？**
- 拖动窗口到合适位置
- 可以调整窗口透明度

---

## 📦 桌面端发布规则（GitHub Actions）

桌面端发布使用 tag 触发，并区分 **预发布** 和 **正式发布**：

- **预发布（Prerelease）**：`vX.Y.Z-xxx`  
  例：`v0.1.0-beta.1`
- **正式发布（Release）**：`vX.Y.Z`  
  例：`v0.1.0`

Android 的发布已独立为 `android-v*` 标签，避免干扰桌面端发布。

示例：

```bash
# 预发布（会生成 GitHub Prerelease）
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1

# 正式发布（会生成 GitHub Release）
git tag v0.1.0
git push origin v0.1.0

# Android 发布（仅 Android 流程触发）
git tag android-v0.1.0
git push origin android-v0.1.0
```

> 说明：桌面端产物为 macOS `.dmg` 与 Windows `.exe`，不会生成 APK。

---

## 🧰 模型下载与缓存目录（HF / ModelScope）

应用内的语音识别模型（尤其是 FunASR ONNX）会在首次使用/点击下载时自动拉取，并缓存到本机磁盘。为了方便管理、并兼容 Windows / macOS 的默认目录差异，项目默认把缓存放到 Electron 的 `userData` 目录下（不同系统会自动选择合适位置）。

如果你希望把模型统一下载到自己指定的盘符/目录（例如放到大硬盘、NAS 挂载目录等），推荐通过环境变量覆盖：

- `ASR_CACHE_BASE`：ASR 缓存根目录（推荐只改这个）
- `HF_HOME`：HuggingFace 缓存根目录（高级用法）
- `ASR_CACHE_DIR`：HuggingFace hub 目录（高级用法）
- `MODELSCOPE_CACHE`：ModelScope 缓存根目录（注意：实际会写到 `<MODELSCOPE_CACHE>/hub`）

示例（macOS/Linux）：

```bash
ASR_CACHE_BASE=/data/livegalgame/asr-cache pnpm dev
```

示例（Windows PowerShell）：

```powershell
$env:ASR_CACHE_BASE="D:\\LiveGalGame\\asr-cache"; pnpm dev
```

如果你想手动使用 ModelScope CLI 把某个模型下载到指定位置（不走应用内下载），确实可以用：

```bash
modelscope download --model 'Qwen/Qwen2-7B' --local_dir /data/models/Qwen2-7B
```

但应用内的 FunASR 模型下载是由 `funasr_onnx` 触发的（不是直接下载单个 Qwen 模型），因此更推荐用上面的环境变量来统一管理缓存位置。

---

## 🔧 开发者指南

如果你想参与开发或了解技术细节，请查看项目源码：

- `src/main.js` - Electron 主进程
- `src/renderer/` - React 前端界面
- `src/asr/` - 语音识别服务
- `src/db/` - 本地数据存储

欢迎提交 PR！有问题请加 QQ 群：**1074602400**
