# OpenCode Fork 架构与设计指南

本文档详细说明了此分支（Fork）的设计思路、核心变动以及代码分布，旨在帮助维护者理解“极简模式”是如何在不破坏上游逻辑的情况下实现的。

---

## 1. 设计哲学：侵入性最小化 (Minimal Intrusion)

为了确保能长期、顺畅地合并上游（anomalyco/opencode）的更新，本分支采用了**“插件式”**的开发策略：
- **只新增，少修改**：核心逻辑尽可能实现在全新的文件中，而不是直接修改上游的复杂模块。
- **挂载点机制**：仅在上游代码的关键入口处添加少量判断逻辑（Hooks），将控制权引导至我们的自定义模块。
- **功能解耦**：保留原有的 TUI 功能，将“极简模式”实现为一套并行的交互系统。

---

## 2. 核心逻辑流

1. **启动控制** (`packages/opencode/src/cli/cmd/tui/thread.ts`)
   - 拦截启动流程，检查 `minimal` 配置项。
   - 若为 `true`，则直接调用自定义的 `REPL` 模块，不再初始化原版的全屏 TUI 界面。

2. **交互循环** (`packages/opencode/src/cli/cmd/repl.ts`)
   - 基于 Node.js 的 `readline` 模块实现的轻量级交互界面。
   - 负责处理用户输入、斜杠命令（`/model` 等）以及 Tab 自动补全。

3. **视觉渲染** (`packages/opencode/src/cli/cmd/render.ts`)
   - 专门为终端命令行优化的渲染器。
   - 实现 Markdown 格式化、Diff 高亮、代码块边框等视觉效果。

---

## 3. 文件变动详表

所有的自定义内容都统一存放在根目录的 **`fork/`** 文件夹下。

### 📂 新增文件 (Added)

| 文件路径 | 功能说明 |
| :--- | :--- |
| `packages/opencode/src/cli/cmd/repl.ts` | **核心**：极简模式的交互与命令处理逻辑 |
| `packages/opencode/src/cli/cmd/render.ts` | **核心**：终端命令行风格的视觉渲染器 |
| `fork/scripts/sync-upstream.sh` | 自动化同步脚本，内置全方位保护逻辑 |
| `fork/scripts/build.sh` | 个人定制版编译脚本（默认单平台） |
| `fork/docs/MAINTENANCE.md` | 维护与同步指南（中文） |
| `fork/docs/AWS_BEDROCK_GUIDE_ZH.md` | AWS Bedrock 专项配置指南（中文） |
| `fork/docs/FORK_ARCHITECTURE_ZH.md` | 本文档（架构说明） |

### 📝 修改文件 (Modified)

| 文件路径 | 修改目的 |
| :--- | :--- |
| `packages/opencode/src/cli/cmd/tui/thread.ts` | 插入 REPL 启动开关，实现模式分流 |
| `packages/opencode/src/config/keybinds.ts` | 适配终端环境的快捷键定义 |
| `packages/opencode/script/build.ts` | 优化编译逻辑（已被同步脚本保护） |
| `README.md` | 文档引导至 `fork/docs` |
| `.gitignore` | 过滤 `fork/dist` 产物 |

---

## 4. 维护与同步策略

运行 `./fork/scripts/sync-upstream.sh` 时，脚本会自动执行以下保护：
- **核心逻辑保护**：保留对 `thread.ts` 和 `build.ts` 的修改。
- **全文件夹保护**：强制保留整个 `fork/` 目录的所有内容。
- **文档保护**：保留 `README.md`。

---

## 5. 结论

通过将所有改动收纳在 `fork/` 目录下，我们不仅让代码结构变得井然有序，更重要的是实现了一种**“可插拔”的自定义模式**。这种设计最大程度地平衡了“追求个人极致体验”与“跟随官方版本演进”这两个需求。
