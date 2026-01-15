# Agent Foundry Build Studio (Console)

> AI-powered development console for Agent Foundry

## 快速开始

### Prerequisites

- **Bun** 1.3+ ([安装](https://bun.sh))
- **Rust** 1.70+ ([安装](https://rustup.rs))
- **Node.js** 18+ (用于一些工具链)

### 安装依赖

```bash
# 在项目根目录
bun install

# 或者只安装 console package
cd packages/console
bun install
```

### 开发模式

```bash
# 方式1：运行 Tauri desktop app (推荐)
bun run --cwd packages/console tauri dev

# 方式2：只运行 web dev server (调试 UI)
bun run --cwd packages/console dev
```

### 构建

```bash
# 构建桌面应用
bun run --cwd packages/console tauri build

# 输出位置:
# - macOS: src-tauri/target/release/bundle/macos/
# - Windows: src-tauri/target/release/bundle/msi/
```

## 项目结构

```
packages/console/
├── src/                      # 前端代码 (React + TypeScript)
│   ├── main.tsx              # 入口文件
│   ├── App.tsx               # 主应用组件
│   ├── components/           # UI 组件
│   │   ├── ChatPanel.tsx     # 左侧 Chat 面板
│   │   ├── WorkspacePanel.tsx # 右侧 Workspace 面板
│   │   └── ActionsBar.tsx    # 右上角操作按钮
│   ├── hooks/                # React hooks
│   ├── lib/                  # 工具函数
│   └── types/                # TypeScript 类型定义
│       └── workspace.ts      # Workspace 数据模型
├── src-tauri/                # Tauri backend (Rust)
│   ├── src/
│   │   ├── main.rs           # Rust 入口
│   │   └── workspace_runner.rs # Workspace 进程管理
│   ├── Cargo.toml            # Rust 依赖
│   └── tauri.conf.json       # Tauri 配置
├── public/                   # 静态资源
├── vite.config.ts            # Vite 配置
├── tailwind.config.js        # Tailwind CSS 配置
└── package.json              # NPM 依赖
```

## Phase 1 完成功能

✅ **基础框架**
- Tauri 2.x 项目初始化
- Vite + React + Tailwind CSS 配置
- Workspace TypeScript 类型定义
- 两栏布局 (Chat + Workspace)
- 右上角 Actions Bar (4个按钮)
  - Open Workspace (已连接 Tauri IPC)
  - Deploy to AF (占位)
  - Export Local (占位)
  - Copy (占位)

✅ **Tauri IPC**
- `greet` command (测试连接)
- `open_workspace_dialog` command (打开文件选择器)

## 下一步 (Week 2)

- [ ] 实现 Workspace Runner (pnpm dev/build)
- [ ] Preview Tab 嵌入 dev server
- [ ] Code Tab 文件树 + 编辑器
- [ ] 集成 OpenCode Server

## 技术栈

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Tauri 2.x (Rust)
- **Build Tool**: Bun
- **State Management**: Zustand (待添加)
- **Editor**: CodeMirror 6 (待添加)

## 开发说明

### Tauri Commands

所有 Rust commands 在 `src-tauri/src/main.rs` 中定义，通过 `invoke` 从前端调用：

```typescript
import { invoke } from '@tauri-apps/api/core'

// 调用 Rust command
const result = await invoke<string>('open_workspace_dialog')
```

### 添加新的 Tauri Command

1. 在 `src-tauri/src/*.rs` 中定义函数并添加 `#[tauri::command]`
2. 在 `main.rs` 的 `invoke_handler` 中注册
3. 在前端使用 `invoke('command_name', { args })` 调用

### 样式规范

- 使用 Tailwind CSS utility classes
- 遵循暗色主题 (bg-gray-900/800/700)
- 间距使用 4px 基数 (p-4, gap-2, etc.)

## 故障排除

### Rust 编译错误

```bash
cd packages/console/src-tauri
cargo clean
cargo build
```

### 前端类型错误

```bash
bun run --cwd packages/console typecheck
```

### 依赖问题

```bash
# 清理并重装
rm -rf node_modules
bun install
```

## 参考文档

- [设计方案](../../doc/devplan/BUILD-STUDIO-DESIGN.md)
- [规格说明](../../doc/agent-foundry/AF-BUILDCONSOLE-SPEC.md)
- [Tauri 文档](https://tauri.app/)
- [React 文档](https://react.dev/)
