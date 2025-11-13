const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');

// 主窗口实例
let mainWindow;
let hudWindow;

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false, // 先不显示，准备好后再显示
    title: 'LiveGalGame Desktop'
  });

  // 加载index.html
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // 窗口准备就绪后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 开发环境自动打开开发者工具
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }
  });

  // 窗口关闭事件
  mainWindow.on('closed', () => {
    mainWindow = null;
    // 主窗口关闭时，也关闭HUD
    if (hudWindow) {
      hudWindow.close();
    }
  });

  // 监听来自渲染进程的IPC消息
  setupIPC();
}

// 设置IPC通信
function setupIPC() {
  // 显示HUD
  ipcMain.on('show-hud', () => {
    if (!hudWindow) {
      createHUDWindow();
    } else {
      hudWindow.show();
    }
    console.log('HUD显示');
  });

  // 隐藏HUD
  ipcMain.on('hide-hud', () => {
    if (hudWindow) {
      hudWindow.hide();
      console.log('HUD隐藏');
    }
  });

  // 关闭HUD
  ipcMain.on('close-hud', () => {
    if (hudWindow) {
      hudWindow.close();
      hudWindow = null;
      console.log('HUD关闭');
    }
  });

  // HUD拖拽相关变量
  let dragStartPos = { x: 0, y: 0 };
  let dragWindowBounds = { x: 0, y: 0, width: 0, height: 0 };
  let isHUDDragging = false;

  // 开始拖拽HUD
  ipcMain.on('start-hud-drag', (event, pos) => {
    if (!hudWindow) return;
    isHUDDragging = true;
    dragStartPos = pos;
    // 获取窗口的完整边界信息（位置和大小）
    const bounds = hudWindow.getBounds();
    dragWindowBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    console.log('HUD拖拽开始，窗口边界:', dragWindowBounds);
  });

  // 更新HUD拖拽位置
  // 重要：使用setBounds同时设置位置和大小，避免高DPI缩放时窗口无限放大
  // 参考：https://zhuanlan.zhihu.com/p/112564936
  ipcMain.on('update-hud-drag', (event, pos) => {
    if (!hudWindow || !isHUDDragging) return;
    const deltaX = pos.x - dragStartPos.x;
    const deltaY = pos.y - dragStartPos.y;
    const newX = dragWindowBounds.x + deltaX;
    const newY = dragWindowBounds.y + deltaY;
    // 必须使用setBounds同时设置位置和大小，不能只用setPosition
    hudWindow.setBounds({
      x: newX,
      y: newY,
      width: dragWindowBounds.width,
      height: dragWindowBounds.height
    });
  });

  // 结束HUD拖拽
  ipcMain.on('end-hud-drag', () => {
    isHUDDragging = false;
    console.log('HUD拖拽结束');
  });

  console.log('IPC通信已设置');
}

// 创建HUD窗口
function createHUDWindow() {
  try {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    console.log(`Creating HUD window at position: ${width - 540}, ${height - 620}`);

    hudWindow = new BrowserWindow({
      width: 520,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      maxWidth: 1200,
      maxHeight: 1000,
      x: width - 540,
      y: height - 620,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,  // 允许调整大小
      show: false, // 先不显示，等ready后再显示
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        preload: path.join(__dirname, 'preload.js')
      },
      title: 'LiveGalGame HUD'
    });

    // 确保窗口可以调整大小（显式设置）
    hudWindow.setResizable(true);

    // 加载HUD页面
    hudWindow.loadFile(path.join(__dirname, 'renderer/hud.html'));

    // 页面加载完成后再显示
    hudWindow.once('ready-to-show', () => {
      console.log('HUD window ready to show');
      // 再次确认窗口可以调整大小
      hudWindow.setResizable(true);
      hudWindow.show();
    });

    // 页面加载错误处理
    hudWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('HUD failed to load:', errorCode, errorDescription);
    });

    // HUD关闭事件
    hudWindow.on('closed', () => {
      console.log('HUD window closed');
      hudWindow = null;
      // 通知主窗口HUD已关闭
      if (mainWindow) {
        mainWindow.webContents.send('hud-closed');
      }
    });

    console.log('HUD窗口创建成功');
  } catch (error) {
    console.error('Failed to create HUD window:', error);
  }
}

// 注册全局快捷键
function registerGlobalShortcuts() {
  // Ctrl+R 刷新
  globalShortcut.register('CommandOrControl+R', () => {
    if (mainWindow) {
      mainWindow.reload();
      console.log('窗口已刷新');
    }
  });

  // Ctrl+Shift+I 打开开发者工具
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
      console.log('开发者工具已切换');
    }
  });

  // ESC 键最小化HUD（后续实现）
  globalShortcut.register('Escape', () => {
    console.log('ESC pressed - will minimize HUD later');
  });

  console.log('全局快捷键已注册');
}

// 应用准备就绪
app.whenReady().then(() => {
  createWindow();
  // createHUDWindow(); // 暂时不自动创建HUD，等待用户触发
  registerGlobalShortcuts();

  // macOS上激活应用时创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 应用退出前清理
app.on('will-quit', () => {
  // 注销所有全局快捷键
  globalShortcut.unregisterAll();
  console.log('全局快捷键已注销');
});

// 所有窗口关闭时退出应用（除了macOS）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

console.log('LiveGalGame Desktop 启动成功！');
