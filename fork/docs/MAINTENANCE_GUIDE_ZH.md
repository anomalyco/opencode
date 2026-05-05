# OpenCode Fork 维护与同步指南

本仓库是 [OpenCode](https://github.com/anomalyco/opencode) 的定制化 Fork 版本，主要目标是实现 **轻量化 REPL 体验**、**离线构建支持** 以及 **环境适配增强**。

## 一、 新增内容 (New Additions)
这些文件是本 Fork 独有的，上游更新通常不会影响到它们，同步时安全等级：**极高**。

| 文件/目录 | 说明 |
| :--- | :--- |
| `fork/scripts/build.sh` | 定制化编译脚本，包含全英文提示和产物自动搬运逻辑。 |
| `fork/scripts/sync-upstream.sh` | 自动化同步脚本，内置了对定制化核心文件的合并保护逻辑。 |
| `fork/docs/` | 存放 Fork 相关的架构设计和维护文档。 |
| `fork/dist/` | 存放编译产物的目录（已被 Git 忽略）。 |

---

## 二、 修改的上游文件 (Modified Upstream Files)
这些文件是同步时的**高风险区域**，一旦上游发生变动，可能会产生冲突。

### 1. `packages/opencode/src/cli/cmd/minimal-repl.ts`
*   **修改内容**：
    *   重写了 `repl` 函数，移除了对复杂 TUI 组件的依赖。
    *   在 `handler` 中通过 `sdk.config.get()` 获取配置，而非直接注入 Service。
    *   定制了三行启动 Banner（显示 Session、Model 和快捷键提示）。
*   **冲突点**：上游如果修改了 `Cli.run` 的参数解析或 `sdk` 的调用方式。
*   **代码段位置**：`export async function repl(...)` 函数体。

### 2. `packages/opencode/src/cli/cmd/tui/thread.ts`
*   **修改内容**：
    *   在 `TuiThreadCommand.handler` 中插入了模式判断。
    *   强制将默认模式设为 `minimal` 并调用我们的自定义 `repl`。
*   **冲突点**：这是程序的启动总开关，上游如果重构了启动逻辑（如 `Instance` 初始化），此文件必冲突。

### 3. `packages/opencode/src/cli/cmd/minimal-render.ts`
*   **修改内容**：
    *   优化了 `colorizeDiff` 函数，去掉了昂贵的解析逻辑，改用基于 ANSI 逃逸码的红绿背景色渲染。
    *   对 `shiki` 引擎采用了动态导入（带 Fallback 路径），并使用变量绕过 TypeScript 的严格检查。
*   **冲突点**：上游如果更换了语法高亮引擎或修改了 `ToolPart` 的渲染接口。

### 4. `packages/opencode/script/generate.ts`
*   **修改内容**：
    *   增加了 `snapshotExists` 检测，支持在断网环境下复用本地 `models-snapshot.js`。
    *   移除了会导致父进程中断的 `process.exit(0)`。
*   **冲突点**：上游如果修改了模型 API 的获取地址或数据结构。

---

## 三、 同步建议 (Sync Advice)

### 1. 优先使用同步脚本
建议始终使用 `./fork/scripts/sync-upstream.sh` 进行同步。该脚本会自动执行：
```bash
git checkout --ours [核心文件路径]
```
这意味着在发生冲突时，它会**自动保护**上述四大核心文件中的 Fork 版本，防止你的定制逻辑被冲掉。

### 2. 手动对齐 (Manual Alignment)
如果上游对上述核心文件做了重大的 API 更改，导致程序无法编译，你需要手动对比：
*   **左侧**：上游的新版逻辑（如新的 Service 注入方式）。
*   **右侧**：我们的 `minimal` 模式分流代码。
*   **操作**：将我们的 `if (args.mode === "minimal") { ... }` 逻辑移植到上游的新函数体中。

### 3. 产物校验
每次同步后，务必运行：
```bash
oc-build && oc
```
如果启动 Banner 正常显示，且代码 Diff 依然带红绿背景，则说明同步成功。
