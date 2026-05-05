# OpenCode Fork 维护与同步指南

本仓库是 [OpenCode](https://github.com/anomalyco/opencode) 的定制化 Fork 版本，主要目标是实现 **极简 REPL 体验**、**离线构建支持** 以及 **环境适配增强**。

## 一、 新增内容 (New Additions)
这些是本 Fork 独有的资产。同步时通常不会产生冲突。

| 文件/目录 | 说明 |
| :--- | :--- |
| `fork/scripts/` | 自动化编译 (`build.sh`) 与同步 (`sync-upstream.sh`) 脚本。 |
| `fork/docs/` | Fork 专属文档库。 |
| `fork/test/` | 针对 REPL 和 Diff 渲染的专项测试套件。 |
| `fork/models-cache.json` | 离线编译所需的模型清单缓存。 |
| `packages/opencode/src/cli/cmd/minimal-repl.ts` | **核心**：极简模式交互逻辑。 |
| `packages/opencode/src/cli/cmd/minimal-render.ts` | **核心**：极简模式渲染引擎（含 ANSI 渲染）。 |

---

## 二、 修改的上游文件 (Modified Upstream Files)
这些是同步时的**高风险区域**，需要脚本保护。

### 1. `packages/opencode/src/cli/cmd/tui/thread.ts`
*   **修改内容**：
    *   在 `TuiThreadCommand.handler` 中插入了模式判断。
    *   强制将默认模式设为 `minimal` 并调用自定义的 `minimal-repl`。
*   **冲突点**：上游如果重构了 TUI 的启动总入口。

### 2. `packages/opencode/script/build.ts`
*   **修改内容**：修复了编译路径的绝对路径处理，确保编译产物搬运稳健。
*   **冲突点**：上游如果大幅修改编译流程。

---

## 三、 同步建议 (Sync Advice)

### 1. 自动化同步
始终运行 `./fork/scripts/sync-upstream.sh`。
该脚本会自动通过 `git checkout --ours` 保护上述修改后的文件，并强制保留整个 `fork/` 目录。

### 2. 离线构建说明
在运行 `./fork/scripts/build.sh` 时，脚本会自动注入环境变量：
`export MODELS_DEV_API_JSON=".../fork/models-cache.json"`
这使得上游代码无需联网即可完成编译。
