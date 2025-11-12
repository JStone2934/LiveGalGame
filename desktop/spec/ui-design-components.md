# UI 组件库设计文档（Reusable Components）

> **用途**：跨页面复用的基础组件、容器组件和业务组件规范  
> **框架**：React + Tailwind CSS + Framer Motion  
> **设计工具**：Figma（组件库系统）

---

## 1. 设计系统基础

### 1.1 设计令牌（Design Tokens）

#### 颜色系统
```css
/* 品牌色 */
--color-brand-primary: #D91B5C;      /* 品牌粉红 */
--color-brand-primary-dark: #C2185B;
--color-brand-primary-light: rgba(217, 27, 92, 0.1);

/* 中性色 */
--color-gray-50: #F9FAFB;
--color-gray-100: #F3F4F6;
--color-gray-200: #E5E7EB;
--color-gray-300: #D1D5DB;
--color-gray-400: #9CA3AF;
--color-gray-500: #6B7280;
--color-gray-600: #4B5563;
--color-gray-700: #374151;
--color-gray-800: #1F2937;
--color-gray-900: #111827;

/* 语义色 */
--color-success: #10B981;
--color-warning: #F59E0B;
--color-error: #EF4444;
--color-info: #3B82F6;

/* 深色模式补充 */
--color-dark-bg: #1F1F1F;
--color-dark-surface: #2A2A2A;
--color-dark-text: #E5E7EB;
```

#### 尺寸系统
```css
/* 间距 */
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;
--spacing-2xl: 40px;

/* 圆角 */
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-full: 9999px;

/* 阴影 */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.15);
--shadow-xl: 0 10px 40px rgba(0, 0, 0, 0.2);

/* 字体 */
--font-family-sans: 'Noto Sans SC', 'PingFang SC', Inter, sans-serif;
--font-family-mono: 'JetBrains Mono', 'Fira Code', monospace;

/* 字体尺寸 */
--font-size-xs: 11px;
--font-size-sm: 12px;
--font-size-base: 13px;
--font-size-md: 14px;
--font-size-lg: 15px;
--font-size-xl: 16px;
--font-size-2xl: 18px;
--font-size-3xl: 20px;
--font-size-4xl: 24px;
--font-size-5xl: 28px;
--font-size-6xl: 32px;
--font-size-7xl: 36px;

/* 行高 */
--line-height-tight: 1.2;
--line-height-normal: 1.5;
--line-height-relaxed: 1.6;
--line-height-loose: 1.8;
```

#### 动画曲线
```css
--ease-in: ease-in;
--ease-out: ease-out;
--ease-in-out: ease-in-out;
--ease-linear: linear;
--ease-custom-spring: cubic-bezier(0.25, 0.46, 0.45, 0.94);
```

---

## 2. 基础组件库（Atomic Components）

### 2.1 Button 组件

#### 属性定义
```tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}
```

#### 样式规范

| Variant | 背景 | 文字色 | 边框 | Hover 背景 |
|---------|------|-------|------|-----------|
| primary | `#D91B5C` | 白色 | 无 | `#C2185B` |
| secondary | `#F3F4F6` | `#374151` | `#E5E7EB` | `#E5E7EB` |
| outline | 透明 | `#374151` | `#D1D5DB` | `#F9FAFB` |
| ghost | 透明 | `#374151` | 无 | 无色 |

| Size | 高度 | 内边距 | 字体 | 圆角 |
|------|------|-------|------|------|
| xs | 28px | 6px 12px | 11px | 4px |
| sm | 32px | 8px 16px | 12px | 6px |
| md | 40px | 10px 20px | 14px | 8px |
| lg | 48px | 12px 24px | 16px | 8px |

#### 实现示例
```tsx
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  onClick,
  className,
}) => {
  const variantClasses = {
    primary: 'bg-brand-primary text-white hover:bg-brand-primary-dark',
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
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'font-medium rounded-md transition-all duration-200 ease-out',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  );
};
```

---

### 2.2 Input 组件

#### 属性定义
```tsx
interface InputProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'search';
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  error?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}
```

#### 样式规范
- **背景**：`#F9FAFB`
- **边框**：`1px solid #D1D5DB`
- **Focus**：边框 `#D91B5C`，阴影 `0 0 0 3px rgba(217, 27, 92, 0.1)`
- **圆角**：6px
- **高度**：40px（md）
- **内边距**：10px 12px
- **字体**：14px，颜色 `#374151`
- **Placeholder**：14px，颜色 `#9CA3AF`
- **Error 状态**：边框变为红色 `#EF4444`，下方显示错误文本

#### 实现示例
```tsx
export const Input: React.FC<InputProps> = ({
  type = 'text',
  placeholder,
  value,
  onChange,
  disabled,
  error,
  icon,
  size = 'md',
  className,
}) => {
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={clsx(
          'w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md',
          'focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-light',
          'placeholder-gray-400 text-gray-800',
          'transition-all duration-200',
          error && 'border-error focus:border-error',
          disabled && 'opacity-50 cursor-not-allowed',
          icon && 'pl-9',
          className,
        )}
      />
      {icon && <span className="absolute left-3 top-2.5">{icon}</span>}
      {error && (
        <span className="block text-xs text-error mt-1">{error}</span>
      )}
    </div>
  );
};
```

---

### 2.3 Card 组件

#### 属性定义
```tsx
interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
}
```

#### 样式规范
- **背景**：白色 `#FFFFFF`
- **边框**：`1px solid #E5E7EB`（outlined 变体）
- **圆角**：12px
- **阴影**：
  - default: `0 1px 3px rgba(0, 0, 0, 0.1)`
  - elevated: `0 4px 12px rgba(0, 0, 0, 0.15)`
  - outlined: 无
- **过渡**：hover 时阴影升高

---

### 2.4 Badge 组件

#### 属性定义
```tsx
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}
```

#### 样式规范
```
variant: primary
  背景: rgba(217, 27, 92, 0.1)
  文字: #D91B5C
  
variant: success
  背景: rgba(16, 185, 129, 0.1)
  文字: #10B981
```

---

### 2.5 Tag 组件

#### 属性定义
```tsx
interface TagProps {
  label: string;
  color?: string;
  onRemove?: () => void;
  interactive?: boolean;
}
```

#### 样式规范
- **背景**：`rgba(217, 27, 92, 0.1)`（默认）
- **文字**：`#D91B5C`
- **内边距**：4px 8px
- **圆角**：12px
- **字体**：11px 粗体
- **可删除**：右侧显示 `×` 按钮

---

### 2.6 Modal 组件

#### 属性定义
```tsx
interface ModalProps {
  isOpen: boolean;
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg';
  showCloseButton?: boolean;
}
```

#### 样式规范
- **背景 Overlay**：`rgba(0, 0, 0, 0.5)`
- **对话框**：白色卡片，圆角 12px，阴影 xl
- **尺寸**：
  - sm: 400px
  - md: 600px
  - lg: 800px
- **动画**：`scale(0.9, 0) → scale(1, 1)`，200ms ease-out

---

### 2.7 Spinner 组件

#### 属性定义
```tsx
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}
```

#### 样式规范
- **尺寸**：16px (sm), 24px (md), 32px (lg)
- **颜色**：`#D91B5C`（默认）
- **动画**：旋转 360°，2s 无限循环

---

## 3. 容器组件（Layout Components）

### 3.1 Layout 组件（主框架）

```tsx
interface LayoutProps {
  children: React.ReactNode;
  showSidebar?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ children, showSidebar = true }) => {
  return (
    <div className="flex h-screen bg-gray-100">
      {showSidebar && <Sidebar />}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
};
```

### 3.2 Sidebar 组件

```tsx
interface SidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  // 导航项列表
  const navItems = [
    { id: 'overview', label: '总览', icon: '◆' },
    { id: 'targets', label: '攻略对象', icon: '◆' },
    { id: 'editor', label: '对话编辑器', icon: '◆' },
    { id: 'llm', label: 'LLM 配置', icon: '◆' },
    { id: 'settings', label: '设置', icon: '◆' },
  ];

  return (
    <aside className="w-70 bg-gradient-to-b from-brand-primary to-brand-primary-dark text-white fixed h-screen">
      {/* 导航项 */}
      {/* 底部功能区 */}
    </aside>
  );
};
```

### 3.3 Header 组件

```tsx
interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle, actions }) => {
  return (
    <header className="bg-white border-b border-gray-200 px-8 py-5">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
    </header>
  );
};
```

---

## 4. 业务组件（Feature Components）

### 4.1 MessageBubble 组件

```tsx
interface MessageBubbleProps {
  content: string;
  role: 'user' | 'partner';
  timestamp?: Date;
  isKeyPoint?: boolean;
  sentimentImpact?: number;
  onEdit?: () => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  content,
  role,
  timestamp,
  isKeyPoint,
  sentimentImpact,
  onEdit,
}) => {
  const isUser = role === 'user';

  return (
    <div className={clsx('flex gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={clsx(
          'max-w-xs px-4 py-3 rounded-2xl',
          isUser
            ? 'bg-brand-light text-white'
            : 'bg-gray-200 text-gray-900',
        )}
      >
        <p className="text-sm leading-relaxed">{content}</p>
        {timestamp && (
          <span className="text-xs text-gray-400 mt-1">
            {timestamp.toLocaleTimeString()}
          </span>
        )}
      </div>
      
      {isKeyPoint && <span className="text-lg">⭐</span>}
      {sentimentImpact && (
        <span className={clsx('text-xs font-bold', sentimentImpact > 0 ? 'text-success' : 'text-error')}>
          {sentimentImpact > 0 ? '+' : ''}{sentimentImpact}
        </span>
      )}
    </div>
  );
};
```

### 4.2 SuggestionCard 组件

```tsx
interface SuggestionCardProps {
  suggestion: string;
  tags: string[];
  expectedImpact?: number;
  onSelect?: () => void;
  onDismiss?: () => void;
}

export const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  tags,
  expectedImpact,
  onSelect,
  onDismiss,
}) => {
  return (
    <Card className="p-4 bg-gray-900 border-brand-primary">
      <p className="text-white text-sm mb-3">{suggestion}</p>
      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          {tags.map(tag => (
            <Badge key={tag} variant="primary">{tag}</Badge>
          ))}
        </div>
        {expectedImpact && (
          <span className="text-xs text-success">❤️ +{expectedImpact}</span>
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="primary" onClick={onSelect}>
          选择
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          X
        </Button>
      </div>
    </Card>
  );
};
```

### 4.3 StatCard 组件

```tsx
interface StatCardProps {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down';
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  trend,
}) => {
  return (
    <Card className="p-6 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs text-gray-500 uppercase">{label}</p>
          <p className="text-4xl font-bold text-gray-900 mt-2">{value}</p>
        </div>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      {trend && (
        <p className={clsx('text-xs mt-2', trend === 'up' ? 'text-success' : 'text-error')}>
          {trend === 'up' ? '↑' : '↓'} 较上周
        </p>
      )}
    </Card>
  );
};
```

### 4.4 ConversationCard 组件

```tsx
interface ConversationCardProps {
  title: string;
  description: string;
  partners: string[];
  lastEdited: Date;
  onClick?: () => void;
}

export const ConversationCard: React.FC<ConversationCardProps> = ({
  title,
  description,
  partners,
  lastEdited,
  onClick,
}) => {
  return (
    <Card
      onClick={onClick}
      className="p-5 hover:bg-gray-50 cursor-pointer transition-colors"
    >
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{description}</p>
      
      <div className="flex justify-between items-center mt-4">
        <div className="flex gap-2 flex-wrap">
          {partners.map(partner => (
            <Tag key={partner} label={partner} />
          ))}
        </div>
        <span className="text-xs text-gray-500">
          {formatRelativeTime(lastEdited)}
        </span>
      </div>
    </Card>
  );
};
```

---

## 5. 组件状态管理模式

### 5.1 使用 Zustand
```tsx
import create from 'zustand';

interface UIStore {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  
  selectedConversation: string | null;
  setSelectedConversation: (id: string | null) => void;
  
  showModal: boolean;
  setShowModal: (show: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  
  selectedConversation: null,
  setSelectedConversation: (id) => set({ selectedConversation: id }),
  
  showModal: false,
  setShowModal: (show) => set({ showModal: show }),
}));
```

---

## 6. 动画和过渡库

### 6.1 使用 Framer Motion
```tsx
import { motion, AnimatePresence } from 'framer-motion';

/* 淡入淡出动画 */
export const fadeInOut = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

/* 从下滑入 */
export const slideUp = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: 20, opacity: 0 },
  transition: { duration: 0.3, ease: 'easeOut' },
};

/* 从右滑入 */
export const slideInRight = {
  initial: { x: 300, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 300, opacity: 0 },
  transition: { duration: 0.3, ease: 'easeOut' },
};

/* 缩放 + 淡入 */
export const scaleIn = {
  initial: { scale: 0.9, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.9, opacity: 0 },
  transition: { duration: 0.2, ease: 'easeOut' },
};

/* Stagger 容器 */
export const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

/* Stagger 子项 */
export const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3 },
  },
};
```

---

## 7. 类型定义（TypeScript）

### 7.1 共享类型
```typescript
/* 通用类型 */
export type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';
export type Status = 'idle' | 'loading' | 'success' | 'error';

/* 用户相关 */
export interface User {
  id: string;
  name: string;
  avatar?: string;
}

/* 对话相关 */
export interface Conversation {
  id: string;
  title: string;
  description?: string;
  partnerId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  role: 'user' | 'partner';
  content: string;
  timestamp: Date;
  isKeyPoint?: boolean;
  sentimentImpact?: number;
}

/* 分析相关 */
export interface Analysis {
  id: string;
  type: 'positive' | 'neutral' | 'improvement' | 'turning_point';
  text: string;
  messageId?: string;
}

export interface SentimentCurve {
  points: number[];
  startValue: number;
  endValue: number;
  maxValue: number;
  minValue: number;
}
```

---

## 8. 主题切换（深色/浅色模式）

### 8.1 主题上下文
```tsx
import React, { createContext, useContext, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('dark');

  const toggleTheme = () => {
    setTheme(t => t === 'light' ? 'dark' : 'light');
    // 同时更新 HTML 属性和 localStorage
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
```

### 8.2 Tailwind 深色模式配置
```js
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    colors: {
      /* ... */
    },
  },
};
```

---

## 9. 测试覆盖（Jest + React Testing Library）

### 9.1 按钮组件测试示例
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button Component', () => {
  it('renders button with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('applies primary variant styles', () => {
    render(<Button variant="primary">Submit</Button>);
    const button = screen.getByText('Submit');
    expect(button).toHaveClass('bg-brand-primary', 'text-white');
  });

  it('handles click events', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    
    fireEvent.click(screen.getByText('Click'));
    expect(handleClick).toHaveBeenCalled();
  });

  it('disables button when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByText('Disabled')).toBeDisabled();
  });
});
```

---

## 10. 性能优化

### 10.1 使用 React.memo 避免不必要重渲染
```tsx
export const MessageBubble = React.memo((props: MessageBubbleProps) => {
  // ...
});
```

### 10.2 使用 useCallback 缓存函数
```tsx
const handleSave = useCallback(() => {
  saveConversation(conversationId);
}, [conversationId]);
```

### 10.3 列表虚拟化（大数据量）
```tsx
import { FixedSizeList as List } from 'react-window';

const MessageList = ({ messages }: { messages: Message[] }) => {
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <div style={style}>
      <MessageBubble {...messages[index]} />
    </div>
  );

  return (
    <List
      height={600}
      itemCount={messages.length}
      itemSize={80}
      width="100%"
    >
      {Row}
    </List>
  );
};
```

---

## 11. 无障碍（Accessibility）

### 11.1 ARIA 属性
```tsx
<button
  aria-label="打开菜单"
  aria-expanded={isOpen}
  aria-controls="menu"
  onClick={toggle}
>
  ☰
</button>

<div id="menu" role="menu" aria-hidden={!isOpen}>
  {/* 菜单项 */}
</div>
```

### 11.2 键盘导航
```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onClick?.();
  }
  if (e.key === 'Escape') {
    onClose?.();
  }
};
```

---

## 12. 文档与示例（Storybook）

### 12.1 按钮 Story
```tsx
import { Button } from './Button';

export default {
  title: 'Components/Button',
  component: Button,
};

export const Primary = () => <Button variant="primary">Primary</Button>;
export const Secondary = () => <Button variant="secondary">Secondary</Button>;
export const Disabled = () => <Button disabled>Disabled</Button>;
export const Loading = () => <Button loading>Loading...</Button>;
```

---

## 13. 组件清单

| 组件名 | 类型 | 用途 | 依赖 |
|-------|------|------|------|
| Button | 基础 | 通用按钮 | - |
| Input | 基础 | 文本输入 | - |
| Card | 基础 | 卡片容器 | - |
| Badge | 基础 | 徽章标签 | - |
| Tag | 基础 | 可删除标签 | - |
| Modal | 基础 | 模态对话框 | Framer Motion |
| Spinner | 基础 | 加载指示器 | Framer Motion |
| Layout | 容器 | 主框架 | Sidebar, Header |
| Sidebar | 容器 | 侧边栏导航 | Button |
| Header | 容器 | 页面头部 | Button |
| MessageBubble | 业务 | 聊天气泡 | Card |
| SuggestionCard | 业务 | 建议卡片 | Card, Badge, Button |
| StatCard | 业务 | 统计卡片 | Card |
| ConversationCard | 业务 | 对话卡片 | Card, Tag |

---

## 14. 版本管理与更新流程

### 14.1 Changelog 示例
```
## v1.0.0 (2025-11-15)

### 新增
- Button 组件：支持 4 种变体、4 种尺寸
- Input 组件：支持错误状态和图标
- Modal 组件：完整的模态对话框实现

### 改进
- 优化 MessageBubble 动画性能
- 改进 Tag 组件可访问性

### 修复
- 修复 Button loading 状态在移动端的显示问题
```

---

**文档版本**：v1.0  
**最后更新**：2025-11-12  
**维护者**：前端架构团队  
**设计工具**：Figma (组件库链接)  
**代码仓库**：`/src/components`  
**Storybook**：http://localhost:6006

