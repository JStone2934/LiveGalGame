# LiveGalGame Desktop 开发进度与下一步提示词

## 当前完成状态 (2025-11-13)

### ✅ 阶段 0: 基础项目搭建 (100%)
- [x] Electron 33 + pnpm 初始化
- [x] 主进程 (main.js) 和预加载脚本 (preload.js)
- [x] 开发环境配置和热重载
- [x] 基础文件结构创建

### ✅ 阶段 1: 主窗口UI框架 (100%)
- [x] 窗口配置 (1200x800, 快捷键 Ctrl+R/Ctrl+Shift+I)
- [x] 三栏布局优化
- [x] 对话列表组件 (支持切换)
- [x] 对话详情组件 (消息气泡)
- [x] AI分析面板 (动态洞察 + 标签管理)
- [x] **页面跳转系统** (总览 ↔ 对话编辑器)

### ✅ 阶段 2: HUD浮窗基础 (100%)
- [x] HUD窗口创建 (无边框、透明、右下角)
- [x] HUD UI基础 (双通道转录 + AI建议卡片)
- [x] 主窗口与HUD通信 (IPC机制)
- [x] 从主窗口触发HUD显示
- [x] HUD拖拽移动
- [x] 鼠标穿透切换 (通过窗口边缘调整大小)
- [x] 窗口大小调节

## 核心架构说明

### 主进程 (main.js)
- `mainWindow`: 主窗口 (1200x800)
- `hudWindow`: HUD浮窗 (520x600, 右下角, 可拖拽、可调整大小)
- IPC通信: `show-hud`, `hide-hud`, `close-hud`, `start-hud-drag`, `update-hud-drag`, `end-hud-drag`

### 渲染进程
- **index.html**: 总览页
  - 左侧导航 (粉色渐变)
  - 统计卡片 (4个)
  - 最近对话列表
- **conversation-editor.html**: 对话编辑器
  - 三栏布局 (对话列表/详情/AI分析)
  - 对话切换功能
- **hud.html**: HUD浮窗
  - 聊天式消息气泡 (左对齐/右对齐)
  - AI建议卡片
  - 拖拽移动功能
  - 关闭按钮
- **settings.html**: 设置页面 (NEW)
  - 麦克风权限请求UI
  - 音频测试组件
  - 音量检测和波形可视化
  - API配置界面

### 预加载脚本 (preload.js)
暴露API:
- `window.electronAPI.showHUD()`
- `window.electronAPI.hideHUD()`
- `window.electronAPI.closeHUD()`
- `window.electronAPI.startHUDDrag(pos)`
- `window.electronAPI.updateHUDDrag(pos)`
- `window.electronAPI.endHUDDrag()`

## 当前问题

### 🔧 需要修复
1. **HUD触发按钮无效**
   - 点击"实时助手"按钮，HUD未显示
   - 可能原因: `window.electronAPI.showHUD()` 未正确调用
   - 日志显示: `Show HUD button clicked` 但没有后续

2. **需要测试**
   - 页面跳转 (总览 ↔ 对话编辑器)
   - 对话切换功能
   - HUD窗口样式

## 下一步开发计划

### 🎯 阶段 2.3: 完成HUD触发 (优先级: 高)
1. 修复 `window.electronAPI.showHUD()` 调用
2. 添加"开始对话"按钮
3. 测试HUD显示/隐藏
4. 验证IPC通信正常

### 🎯 阶段 2.4: HUD交互 (优先级: 中)
1. 拖拽移动功能
2. 鼠标穿透切换
3. 自动收起/展开
4. ESC键最小化

### 🎯 阶段 3: 音频采集 (优先级: 高)
1. 麦克风权限请求UI
2. 音频测试组件
3. Web Audio API集成
4. 音量检测

## 关键代码位置

```
src/
├── main.js                      # 主进程 (HUD创建 + IPC)
├── preload.js                   # 预加载 (暴露API)
└── renderer/
    ├── index.html              # 总览页
    ├── conversation-editor.html # 对话编辑器
    ├── hud.html                # HUD浮窗
    └── js/renderer.js          # 渲染进程脚本
```

## 测试命令

```bash
cd /Users/cccmmmdd/LiveGalGame/desktop
pnpm dev
```

## 功能测试清单

### 页面导航
- [ ] 总览页 → 对话编辑器 (导航菜单)
- [ ] 对话编辑器 → 总览页 (返回按钮)
- [ ] 点击对话卡片跳转

### 对话编辑器
- [ ] 切换对话 (Miyu/Akira/Hana)
- [ ] 查看消息气泡
- [ ] AI洞察更新
- [ ] 添加/删除标签

### HUD浮窗
- [ ] 点击"实时助手"打开HUD
- [ ] HUD显示在右下角
- [ ] 显示转录内容
- [ ] 显示AI建议
- [ ] 最小化/关闭按钮

## 提示词 (给后续LLM)

你是LiveGalGame Desktop的开发助手。当前任务是：

1. **修复HUD触发问题**
   - 用户点击"实时助手"按钮后，HUD窗口应该显示
   - 检查 `window.electronAPI.showHUD()` 是否正确调用
   - 确保IPC通信正常 (`ipcMain.on('show-hud')`)
   - 验证HUD窗口 (`createHUDWindow()`) 是否正确创建

2. **实现阶段 2.4**
   - 拖拽移动功能
   - 鼠标穿透切换
   - ESC键最小化

3. **准备阶段 3**
   - 麦克风权限请求UI
   - 音频测试组件

**重要**: 每个步骤完成后立即测试，确认无报错后再继续。

## 相关文档

- 完整开发计划: `/Users/cccmmmdd/LiveGalGame/desktop/DEVELOPMENT_PLAN.md`
- README: `/Users/cccmmmdd/LiveGalGame/desktop/README.md`
- HUD UI: `/Users/cccmmmdd/LiveGalGame/desktop/src/renderer/hud.html`
