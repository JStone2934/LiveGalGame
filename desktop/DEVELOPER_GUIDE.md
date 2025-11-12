# 🚀 LiveGalGame 桌面版开发者快速启动指南

> **目标**：从零开始搭建 Electron 应用，完整实现所有功能  
> **预计时间**：4-6 周（取决于团队规模和并行度）  
> **技术栈**：Electron + React + TypeScript + Tailwind CSS + SQLite

---

## 📍 项目阶段概览

```
第一阶段（第 1 周）：项目初始化与环境搭建
  ↓
第二阶段（第 1-2 周）：组件库与基础设施
  ↓
第三阶段（第 2-3 周）：核心功能开发（音频、LLM、数据）
  ↓
第四阶段（第 3-4 周）：页面与业务逻辑集成
  ↓
第五阶段（第 4-5 周）：打包、测试与优化
  ↓
第六阶段（第 5-6 周）：发版与迭代
```

---

# 第一阶段：项目初始化与环境搭建（第 1 周）

## 1.1 环境检查清单

在开始前，确保已安装：

```bash
# 检查 Node.js 版本（建议 18.x+）
node --version  # 应为 v18.0.0 或更高

# 检查 npm 版本（建议 9.x+）
npm --version

# 检查 Git
git --version
```

如未安装，请访问：
- Node.js：https://nodejs.org
- Git：https://git-scm.com

## 1.2 初始化项目结构

### 第一步：克隆或创建项目

```bash
cd ~/LiveGalGame
mkdir desktop
cd desktop

# 初始化 npm 项目
npm init -y
```

### 第二步：安装核心依赖

```bash
npm install \
  electron \
  react \
  react-dom \
  typescript \
  tailwindcss \
  postcss \
  autoprefixer \
  framer-motion \
  zustand \
  @react-query/core \
  axios
```

### 第三步：安装开发依赖

```bash
npm install -D \
  @types/react \
  @types/react-dom \
  @types/node \
  ts-loader \
  webpack \
  webpack-cli \
  webpack-dev-server \
  html-webpack-plugin \
  @testing-library/react \
  @testing-library/jest-dom \
  jest \
  @storybook/react \
  @storybook/addon-essentials \
  electron-builder \
  cross-env
```

### 第四步：创建基础目录结构

```bash
# 从项目根目录执行
mkdir -p src/{main,renderer,components,pages,hooks,store,types,utils,assets}
mkdir -p public
mkdir -p spec
mkdir -p tests
mkdir -p .github/workflows
```

最终结构：

```
desktop/
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron 主进程入口
│   │   ├── preload.ts            # 预加载脚本（安全桥接）
│   │   └── ipc/                  # IPC 通信处理器
│   │
│   ├── renderer/
│   │   ├── index.tsx             # React 入口
│   │   └── App.tsx               # 根组件
│   │
│   ├── components/
│   │   ├── base/                 # 基础组件（Button, Input 等）
│   │   ├── containers/           # 容器组件（Layout, Sidebar 等）
│   │   └── features/             # 业务组件（MessageBubble 等）
│   │
│   ├── pages/
│   │   ├── ChatWindow.tsx        # 对话 HUD 浮窗
│   │   ├── Dashboard.tsx         # 主页
│   │   ├── LLMConfig.tsx         # LLM 配置
│   │   └── ConversationDetail.tsx # 对话详情
│   │
│   ├── hooks/
│   │   ├── useTheme.ts           # 主题 hook
│   │   ├── useUIStore.ts         # UI 状态 hook
│   │   └── useConversation.ts    # 对话数据 hook
│   │
│   ├── store/
│   │   ├── ui.ts                 # UI 状态（Zustand）
│   │   ├── conversation.ts       # 对话状态
│   │   └── config.ts             # 应用配置
│   │
│   ├── types/
│   │   ├── index.ts              # 全局类型定义
│   │   ├── conversation.ts       # 对话相关类型
│   │   └── llm.ts                # LLM 相关类型
│   │
│   ├── utils/
│   │   ├── logger.ts             # 日志工具
│   │   ├── storage.ts            # 本地存储
│   │   ├── api.ts                # API 请求
│   │   └── formatters.ts         # 格式化工具
│   │
│   ├── assets/
│   │   ├── icons/
│   │   ├── fonts/
│   │   └── styles/
│   │       ├── globals.css       # 全局样式
│   │       ├── tailwind.css      # Tailwind 入口
│   │       └── animations.css    # 自定义动画
│   │
│   └── main.css                  # 应用主样式
│
├── public/
│   ├── index.html                # 渲染进程 HTML
│   └── preload.js               # 预加载脚本分发
│
├── spec/
│   ├── prd-desktop.md            # ← 产品需求文档
│   ├── tech-architecture.md      # ← 技术架构
│   ├── ui-design-01-chat-window.md       # ← UI 设计 1
│   ├── ui-design-02-llm-config.md        # ← UI 设计 2
│   ├── ui-design-03-dashboard.md         # ← UI 设计 3
│   ├── ui-design-04-conversation-detail.md # ← UI 设计 4
│   ├── ui-design-components.md  # ← 组件库规范
│   ├── audio-capture-tech-note.md        # ← 音频采集技术
│   ├── llm-integration.md        # ← LLM 集成
│   ├── hud-ux.md                 # ← HUD 交互细节
│   ├── data-model.md             # ← 数据模型
│   ├── build-and-release.md      # ← 构建发版
│   ├── privacy-and-permissions.md        # ← 隐私权限
│   └── test-plan.md              # ← 测试计划
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .github/
│   └── workflows/
│       ├── build.yml
│       └── release.yml
│
├── package.json
├── tsconfig.json                 # TypeScript 配置
├── webpack.config.js             # Webpack 配置
├── tailwind.config.js            # Tailwind 配置
├── postcss.config.js             # PostCSS 配置
├── jest.config.js                # Jest 配置
├── electron-builder.yml          # 打包配置
├── README.md
└── DEVELOPER_GUIDE.md            # ← 本文档
```

## 1.3 配置文件创建

### 1.3.1 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@pages/*": ["src/pages/*"],
      "@hooks/*": ["src/hooks/*"],
      "@store/*": ["src/store/*"],
      "@types/*": ["src/types/*"],
      "@utils/*": ["src/utils/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 1.3.2 tailwind.config.js

```javascript
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#D91B5C",
          dark: "#C2185B",
          light: "rgba(217, 27, 92, 0.1)",
        },
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "40px",
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
    },
  },
  plugins: [],
};
```

### 1.3.3 package.json scripts

```json
{
  "scripts": {
    "start": "cross-env NODE_ENV=development electron .",
    "dev": "concurrently \"npm run webpack:dev\" \"wait-on http://localhost:8080 && npm run start\"",
    "webpack:dev": "webpack serve --config webpack.config.js --mode development",
    "build": "webpack --config webpack.config.js --mode production",
    "test": "jest",
    "test:watch": "jest --watch",
    "storybook": "storybook dev -p 6006",
    "storybook:build": "storybook build",
    "lint": "eslint src",
    "package": "electron-builder",
    "package:win": "electron-builder --win",
    "package:mac": "electron-builder --mac",
    "release": "npm run build && electron-builder -p always"
  }
}
```

## 1.4 验证环境

```bash
# 检查依赖安装成功
npm list electron react typescript

# 尝试编译
npm run build

# 应该看到 "build successful" 消息
```

## 1.5 参考文档

| 文档 | 用途 |
|------|------|
| **README.md** | 项目概览和快速开始 |
| **tech-architecture.md** | 了解 Electron 主/渲染进程分层 |
| **build-and-release.md** | 理解打包流程（虽然现在还不需要） |

---

# 第二阶段：组件库与基础设施（第 1-2 周）

## 2.1 创建设计系统与主题

### 第一步：创建设计令牌文件

**文件**：`src/assets/styles/tokens.ts`

```typescript
export const colors = {
  // 品牌色
  brand: {
    primary: "#D91B5C",
    primaryDark: "#C2185B",
    primaryLight: "rgba(217, 27, 92, 0.1)",
  },
  // 中性色
  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
  },
  // 语义色
  status: {
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 40,
};

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const shadows = {
  xs: "0 1px 2px rgba(0, 0, 0, 0.05)",
  sm: "0 1px 3px rgba(0, 0, 0, 0.1)",
  md: "0 4px 6px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px rgba(0, 0, 0, 0.15)",
  xl: "0 10px 40px rgba(0, 0, 0, 0.2)",
};
```

### 第二步：创建全局样式

**文件**：`src/assets/styles/globals.css`

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');

:root {
  --color-brand-primary: #D91B5C;
  --color-brand-primary-dark: #C2185B;
  --color-brand-primary-light: rgba(217, 27, 92, 0.1);
  
  --color-gray-50: #F9FAFB;
  --color-gray-100: #F3F4F6;
  --color-gray-200: #E5E7EB;
  --color-gray-300: #D1D5DB;
  --color-gray-400: #9CA3AF;
  --color-gray-500: #6B7280;
  --color-gray-600: #4B5563;
  --color-gray-700: #374151;
  --color-gray-800: #1F2937;
  
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-info: #3B82F6;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Noto Sans SC', system-ui, -apple-system, sans-serif;
  background-color: #F5F7FA;
  color: #1F2937;
  line-height: 1.5;
}

button {
  cursor: pointer;
  border: none;
  font-family: inherit;
}

input, textarea {
  font-family: inherit;
}

/* 自定义滚动条 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #D1D5DB;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #9CA3AF;
}
```

### 第三步：创建 Framer Motion 动画预设

**文件**：`src/utils/animations.ts`

```typescript
import { Variants } from 'framer-motion';

export const fadeInOut: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

export const slideUp: Variants = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: 20, opacity: 0 },
  transition: { duration: 0.3, ease: 'easeOut' },
};

export const slideInRight: Variants = {
  initial: { x: 300, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 300, opacity: 0 },
  transition: { duration: 0.3, ease: 'easeOut' },
};

export const scaleIn: Variants = {
  initial: { scale: 0.9, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.9, opacity: 0 },
  transition: { duration: 0.2, ease: 'easeOut' },
};

export const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

export const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3 },
  },
};
```

## 2.2 创建基础组件库

### 任务列表
- [ ] 创建 Button 组件（`src/components/base/Button.tsx`）
- [ ] 创建 Input 组件（`src/components/base/Input.tsx`）
- [ ] 创建 Card 组件（`src/components/base/Card.tsx`）
- [ ] 创建 Badge 组件（`src/components/base/Badge.tsx`）
- [ ] 创建 Modal 组件（`src/components/base/Modal.tsx`）
- [ ] 创建 Spinner 组件（`src/components/base/Spinner.tsx`）

**参考文档**：`spec/ui-design-components.md` 第 2 节

**示例代码**：`src/components/base/Button.tsx`

```typescript
import React from 'react';
import clsx from 'clsx';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  onClick,
  className,
  type = 'button',
}) => {
  const variantClasses = {
    primary: 'bg-brand-primary text-white hover:bg-brand-dark disabled:opacity-50',
    secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-200',
    outline: 'bg-transparent text-gray-800 border border-gray-300 hover:bg-gray-50',
    ghost: 'bg-transparent text-gray-800 hover:bg-gray-100',
  };

  const sizeClasses = {
    xs: 'h-7 px-3 text-xs',
    sm: 'h-8 px-4 text-sm',
    md: 'h-10 px-5 text-base',
    lg: 'h-12 px-6 text-lg',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'font-medium rounded-md transition-all duration-200 ease-out',
        'focus:outline-none focus:ring-2 focus:ring-brand-light',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      {loading ? '⏳' : children}
    </button>
  );
};
```

## 2.3 创建容器与布局组件

### 任务列表
- [ ] 创建 Layout 组件（`src/components/containers/Layout.tsx`）
- [ ] 创建 Sidebar 组件（`src/components/containers/Sidebar.tsx`）
- [ ] 创建 Header 组件（`src/components/containers/Header.tsx`）

**参考文档**：`spec/ui-design-components.md` 第 3 节

## 2.4 创建业务组件

### 任务列表
- [ ] 创建 MessageBubble 组件（`src/components/features/MessageBubble.tsx`）
- [ ] 创建 SuggestionCard 组件（`src/components/features/SuggestionCard.tsx`）
- [ ] 创建 StatCard 组件（`src/components/features/StatCard.tsx`）
- [ ] 创建 ConversationCard 组件（`src/components/features/ConversationCard.tsx`）

**参考文档**：`spec/ui-design-components.md` 第 4 节

## 2.5 创建状态管理

### 文件：`src/store/ui.ts`（Zustand store）

```typescript
import create from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  
  selectedConversation: string | null;
  setSelectedConversation: (id: string | null) => void;
  
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  
  selectedConversation: null,
  setSelectedConversation: (id) => set({ selectedConversation: id }),
  
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
}));
```

## 2.6 参考文档

| 文档 | 用途 |
|------|------|
| **spec/ui-design-components.md** | 所有组件详细规范 |
| **spec/UI_DESIGN_INDEX.md** | 快速导航组件库 |

---

# 第三阶段：核心功能开发（第 2-3 周）

## 3.1 音频采集与转录

### 第一步：安装音频库

```bash
npm install \
  node-record-lpcm16 \
  web-audio-api \
  @types/node
```

### 第二步：创建音频服务

**文件**：`src/main/services/AudioService.ts`

参考文档：`spec/audio-capture-tech-note.md`

```typescript
// 伪代码框架
class AudioService {
  private micStream: any;
  private systemAudioStream: any;

  async startCapture() {
    // 1. 请求麦克风权限
    // 2. 启动麦克风采集
    // 3. 启动系统音频捕获
  }

  async stopCapture() {
    // 停止所有采集
  }

  async getMicAudio(): Promise<Buffer> {
    // 获取麦克风音频缓冲区
  }

  async getSystemAudio(): Promise<Buffer> {
    // 获取系统音频缓冲区
  }

  async mergeAudio(mic: Buffer, system: Buffer): Promise<Buffer> {
    // 混合两路音频
  }
}

export const audioService = new AudioService();
```

### 第三步：IPC 通信桥接

**文件**：`src/main/ipc/audio.ts`

```typescript
import { ipcMain } from 'electron';
import { audioService } from '../services/AudioService';

export function setupAudioIPC() {
  ipcMain.handle('audio:start-capture', async () => {
    await audioService.startCapture();
  });

  ipcMain.handle('audio:stop-capture', async () => {
    await audioService.stopCapture();
  });

  ipcMain.handle('audio:get-mic', async () => {
    return audioService.getMicAudio();
  });
}
```

## 3.2 LLM 集成与 API 调用

### 第一步：创建 LLM 配置类型

**文件**：`src/types/llm.ts`

```typescript
export interface LLMProvider {
  id: string;
  name: string;
  modelId: string;
  apiKey: string;
  apiUrl?: string;
  isActive: boolean;
}

export interface LLMResponse {
  content: string;
  tokens: number;
  model: string;
}

export interface SuggestionRequest {
  context: string;
  conversationHistory: Message[];
  userMessage: string;
}

export interface Suggestion {
  text: string;
  tags: string[];
  expectedImpact: number;
}
```

### 第二步：创建 LLM 服务

**文件**：`src/main/services/LLMService.ts`

参考文档：`spec/llm-integration.md`

```typescript
class LLMService {
  private provider: LLMProvider;

  setProvider(provider: LLMProvider) {
    this.provider = provider;
  }

  async testConnection(): Promise<boolean> {
    // 发送测试请求到 LLM API
    // 返回连接成功/失败
  }

  async generateSuggestions(request: SuggestionRequest): Promise<Suggestion[]> {
    // 1. 构建提示词（Prompt Engineering）
    // 2. 调用 LLM API
    // 3. 解析响应，提取建议
    // 4. 返回建议列表
  }

  async analyzeConversation(messages: Message[]): Promise<Analysis> {
    // 1. 构建分析提示词
    // 2. 调用 LLM API
    // 3. 返回分析结果
  }
}

export const llmService = new LLMService();
```

## 3.3 数据模型与存储

### 第一步：安装 SQLite 库

```bash
npm install better-sqlite3 @types/better-sqlite3
```

### 第二步：创建数据库初始化脚本

**文件**：`src/main/db/init.ts`

参考文档：`spec/data-model.md`

```typescript
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || process.env.HOME, 'LiveGalGame', 'app.db');

export const db = new Database(dbPath);

export function initializeDatabase() {
  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS person (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nickname TEXT,
      personality_desc TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      person_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (person_id) REFERENCES person(id)
    );

    CREATE TABLE IF NOT EXISTS turn (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_key_point BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (conversation_id) REFERENCES conversation(id)
    );

    CREATE TABLE IF NOT EXISTS score (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      previous_score REAL,
      current_score REAL,
      delta REAL,
      turn_id TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversation(id),
      FOREIGN KEY (turn_id) REFERENCES turn(id)
    );
  `);
}
```

## 3.4 参考文档

| 文档 | 用途 |
|------|------|
| **spec/audio-capture-tech-note.md** | 音频采集实现细节 |
| **spec/llm-integration.md** | LLM 集成与提示工程 |
| **spec/data-model.md** | SQLite 表设计 |

---

# 第四阶段：页面与业务逻辑集成（第 3-4 周）

## 4.1 Electron 主窗口与 HUD 浮窗

### 第一步：创建主进程入口

**文件**：`src/main/index.ts`

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { isDev } from './utils';
import { setupAudioIPC } from './ipc/audio';
import { setupLLMIPC } from './ipc/llm';
import { initializeDatabase } from './db/init';

let mainWindow: BrowserWindow;
let chatWindow: BrowserWindow;

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.ts'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:8080'
    : `file://${path.join(__dirname, '../../dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

async function createChatWindow() {
  chatWindow = new BrowserWindow({
    width: 440,
    height: 700,
    minWidth: 360,
    minHeight: 480,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.ts'),
      contextIsolation: true,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:8080/chat'
    : `file://${path.join(__dirname, '../../dist/index.html')}`;

  chatWindow.loadURL(startUrl);
}

app.on('ready', async () => {
  initializeDatabase();
  setupAudioIPC();
  setupLLMIPC();
  
  await createMainWindow();
  await createChatWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### 第二步：创建 React 路由

**文件**：`src/renderer/App.tsx`

```typescript
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@components/containers/Layout';
import Dashboard from '@pages/Dashboard';
import LLMConfig from '@pages/LLMConfig';
import ConversationDetail from '@pages/ConversationDetail';
import ChatWindow from '@pages/ChatWindow';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 主窗口路由 */}
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/llm-config" element={<Layout><LLMConfig /></Layout>} />
        <Route path="/conversation/:id" element={<Layout><ConversationDetail /></Layout>} />
        
        {/* HUD 浮窗路由 */}
        <Route path="/chat" element={<ChatWindow />} />
      </Routes>
    </BrowserRouter>
  );
}
```

## 4.2 页面开发顺序

### 优先级 P0（第一周完成）

1. **Dashboard（主页）** - `src/pages/Dashboard.tsx`
   - 参考：`spec/ui-design-03-dashboard.md`
   - 包含：欢迎区、统计卡片、对话列表、新建对话
   - 预计时间：2-3 天
   - 依赖组件：StatCard, ConversationCard, Header

2. **LLMConfig（配置页）** - `src/pages/LLMConfig.tsx`
   - 参考：`spec/ui-design-02-llm-config.md`
   - 包含：模型卡片、添加模型、连接测试
   - 预计时间：2-3 天
   - 依赖组件：Card, Button, Input, Modal

3. **ChatWindow（HUD 浮窗）** - `src/pages/ChatWindow.tsx`
   - 参考：`spec/ui-design-01-chat-window.md`
   - 包含：对话气泡、AI 建议、状态指示、操作栏
   - 预计时间：3-4 天
   - 依赖组件：MessageBubble, SuggestionCard, Button, Spinner

### 优先级 P1（第二周完成）

4. **ConversationDetail（对话详情）** - `src/pages/ConversationDetail.tsx`
   - 参考：`spec/ui-design-04-conversation-detail.md`
   - 包含：对话内容、AI 分析、好感度曲线、消息编辑
   - 预计时间：4-5 天
   - 依赖组件：MessageBubble, Card, Button, Modal, Chart

## 4.3 业务逻辑集成

### 创建自定义 Hooks

**文件**：`src/hooks/useConversation.ts`

```typescript
import { useQuery, useMutation } from '@react-query/core';
import { conversationService } from '@utils/api';

export function useConversation(id: string) {
  return useQuery(['conversation', id], () => 
    conversationService.getConversation(id)
  );
}

export function useCreateConversation() {
  return useMutation((data) => 
    conversationService.createConversation(data)
  );
}

export function useSaveMessage() {
  return useMutation(({ conversationId, message }) =>
    conversationService.addMessage(conversationId, message)
  );
}
```

## 4.4 参考文档

| 文档 | 用途 | 优先级 |
|------|------|-------|
| **spec/ui-design-03-dashboard.md** | Dashboard 页面规范 | P0 |
| **spec/ui-design-02-llm-config.md** | LLM 配置页规范 | P0 |
| **spec/ui-design-01-chat-window.md** | Chat HUD 规范 | P0 |
| **spec/ui-design-04-conversation-detail.md** | 对话详情页规范 | P1 |
| **spec/hud-ux.md** | HUD 交互细节 | P0 |

---

# 第五阶段：打包、测试与优化（第 4-5 周）

## 5.1 单元测试与集成测试

### 第一步：编写测试用例

**文件**：`tests/unit/Button.test.tsx`

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@components/base/Button';

describe('Button Component', () => {
  it('renders button with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick handler when clicked', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    
    fireEvent.click(screen.getByText('Click'));
    expect(handleClick).toHaveBeenCalled();
  });

  it('applies primary variant styles', () => {
    render(<Button variant="primary">Submit</Button>);
    const button = screen.getByText('Submit');
    expect(button).toHaveClass('bg-brand-primary');
  });
});
```

### 第二步：运行测试

```bash
npm test                # 运行一次
npm run test:watch     # 监听模式
```

## 5.2 性能优化

### 参考清单

- [ ] 组件使用 React.memo 避免不必要重渲染
- [ ] 使用 useCallback 缓存函数
- [ ] 列表使用虚拟化（react-window）处理大数据量
- [ ] 图片优化（使用 WebP 格式）
- [ ] 代码分割（code splitting）

参考文档：`spec/ui-design-components.md` 第 10 节

## 5.3 构建和打包

### 第一步：编译应用

```bash
npm run build
```

### 第二步：生成应用程序包

```bash
# Windows
npm run package:win

# macOS
npm run package:mac

# 两个平台
npm run package
```

参考文档：`spec/build-and-release.md`

## 5.4 参考文档

| 文档 | 用途 |
|------|------|
| **spec/test-plan.md** | 完整测试计划 |
| **spec/build-and-release.md** | 打包与发版流程 |

---

# 第六阶段：发版与迭代（第 5-6 周）

## 6.1 版本发布

### 第一步：更新版本号

```bash
# package.json
{
  "version": "1.0.0"
}
```

### 第二步：生成 CHANGELOG

```
## v1.0.0 (2025-12-XX)

### 新增
- ✅ 对话 HUD 浮窗实现
- ✅ AI 建议生成
- ✅ LLM 模型配置
- ✅ 对话数据存储与分析

### 修复
- 修复音频采集延迟问题
- 修复 macOS 透明窗口适配

### 性能
- 优化消息列表虚拟化
- 减少内存占用 30%
```

### 第三步：发布应用

```bash
npm run release
```

参考文档：`spec/build-and-release.md`

## 6.2 用户反馈与迭代

- 收集用户反馈（GitHub Issues、用户调查等）
- 优先级排序（Critical > High > Medium > Low）
- 规划下一版本（v1.1）

## 6.3 持续集成/部署

参考文档：`.github/workflows/release.yml`

---

# 开发检查清单

## ✅ 第一阶段完成标志

- [ ] 所有依赖安装完毕
- [ ] 目录结构创建完整
- [ ] TypeScript 配置正确
- [ ] `npm run build` 成功编译
- [ ] Webpack dev server 正常启动

## ✅ 第二阶段完成标志

- [ ] 所有基础组件完成（6 个）
- [ ] 容器组件完成（3 个）
- [ ] 业务组件完成（4 个）
- [ ] 设计系统配置（令牌、样式、动画）
- [ ] Storybook 可视化展示所有组件
- [ ] 组件单元测试覆盖率 > 80%

## ✅ 第三阶段完成标志

- [ ] 音频采集功能正常工作
- [ ] LLM API 连接测试成功
- [ ] 数据库初始化完成
- [ ] IPC 通信桥接建立
- [ ] 本地存储正常读写

## ✅ 第四阶段完成标志

- [ ] Dashboard 页面完整实现
- [ ] LLM Config 页面完整实现
- [ ] Chat HUD 浮窗完整实现
- [ ] Conversation Detail 页面完整实现
- [ ] 页面间导航正常工作
- [ ] 功能测试通过（对照 spec/test-plan.md）

## ✅ 第五阶段完成标志

- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试通过
- [ ] 性能指标达标（首屏 < 2s，帧率 60fps）
- [ ] Windows 和 macOS 打包成功
- [ ] 应用程序能正常安装和运行

## ✅ 第六阶段完成标志

- [ ] v1.0.0 发版成功
- [ ] 用户反馈收集与整理完成
- [ ] v1.1 迭代计划制定完成

---

# 快速命令参考

```bash
# 开发
npm run dev              # 启动开发服务器 + Electron
npm run webpack:dev     # 仅启动 Webpack dev server
npm start               # 仅启动 Electron

# 构建
npm run build           # 编译 React + TypeScript
npm run package         # 打包应用程序（Win + Mac）
npm run package:win     # 仅打包 Windows
npm run package:mac     # 仅打包 macOS

# 测试
npm test                # 运行测试
npm run test:watch     # 测试监听模式

# 文档
npm run storybook      # 启动 Storybook（http://localhost:6006）

# 代码质量
npm run lint           # 检查代码风格
```

---

# 常见问题（FAQ）

## Q1：如何在 macOS 上处理代码签名？

A：参考 `spec/build-and-release.md` 第 3.2 节（macOS 硬化与公证）

## Q2：如何添加代理以加速下载？

A：根据用户规则，使用 `dl1` 命令启动代理，并配置 npm：
```bash
dl1  # 启动代理
npm config set registry http://registry.proxy.local
```

## Q3：音频采集在 Linux 上支持吗？

A：当前设计仅支持 Windows 和 macOS，Linux 支持需要后续扩展

## Q4：如何本地测试 LLM 集成？

A：在 `spec/llm-integration.md` 中找到本地测试脚本

## Q5：如何生成热更新？

A：参考 `spec/build-and-release.md` 第 3.4 节（自动更新配置）

---

# 进阶主题

## 性能监控

参考 `spec/ui-design-components.md` 第 10 节性能优化部分

## 无障碍支持

参考 `spec/ui-design-components.md` 第 11 节无障碍指南

## 国际化（i18n）

当前版本仅支持中文，国际化支持需要后续规划

---

# 支持与联系

- **技术支持**：team@livegalgame.local
- **Bug 报告**：GitHub Issues
- **功能建议**：Discussions
- **设计反馈**：Figma 评论

---

**文档版本**：v1.0  
**最后更新**：2025-11-12  
**预计完成时间**：4-6 周（取决于团队规模）

