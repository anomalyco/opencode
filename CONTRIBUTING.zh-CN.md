# 贡献给 OpenCode

我们希望让大家能够轻松地为 OpenCode 做贡献。以下是最常见的会被合并的更改类型：

- Bug 修复
- 增加额外的 LSP / Formatter
- 提升 LLM 性能
- 支持新的提供商 (Provider)
- 针对特定环境问题的修复
- 缺失的标准行为
- 文档改进

但是，任何 UI 或核心产品功能的更改，在实施前必须经过核心团队的设计审查。

如果您不确定您的 PR 是否会被接受，请随时咨询维护者，或查看带有以下相关标签的 issue：

- [`help wanted`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://github.com/anomalyco/opencode/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

> [!NOTE]
> 忽略这些限制的 PR 很可能会被关闭。

想认领一个 issue 吗？请留言，除非我们已经着手处理，否则维护者可能会将其分配给您。

## 开发 OpenCode

- 需求: Bun 1.3+
- 从代码库根目录安装依赖并启动开发服务器：

  ```bash
  bun install
  bun dev
  ```

### 在不同目录下运行

默认情况下，`bun dev` 会在 `packages/opencode` 目录下运行 OpenCode。若要在不同目录或仓库下运行：

```bash
bun dev <directory>
```

要在 opencode 仓库本身的根目录下运行 OpenCode：

```bash
bun dev .
```

### 构建 "localcode"

要编译独立的可执行文件：

```bash
./packages/opencode/script/build.ts --single
```

然后通过以下命令运行：

```bash
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

将 `<platform>` 替换为您的平台（例如 `darwin-arm64`, `linux-x64`）。

- 核心组件：
  - `packages/opencode`: OpenCode 核心业务逻辑与服务器。
  - `packages/opencode/src/cli/cmd/tui/`: TUI 代码，使用 SolidJS 和 [opentui](https://github.com/sst/opentui) 编写。
  - `packages/app`: 共享的 Web UI 组件，使用 SolidJS 编写。
  - `packages/desktop`: 原生桌面应用，使用 Tauri 构建（封装了 `packages/app`）。
  - `packages/plugin`: `@opencode-ai/plugin` 的源代码。

### 运行 Web 应用

要在开发过程中测试 UI 更改，请运行 Web 应用：

```bash
bun run --cwd packages/app dev
```

这将在 http://localhost:5173 （或输出中显示的其他端口）启动本地开发服务器。大多数 UI 更改都可以在此处进行测试。

### 运行桌面应用

桌面应用是一个封装了 Web UI 的原生 Tauri 应用。

要运行原生桌面应用：

```bash
bun run --cwd packages/desktop tauri dev
```

这将在 http://localhost:1420 启动 Web 开发服务器并打开原生窗口。

如果您只需要 Web 开发服务器（不需要原生 shell）：

```bash
bun run --cwd packages/desktop dev
```

要创建生产环境的 `dist/` 并构建原生应用包：

```bash
bun run --cwd packages/desktop tauri build
```

这将通过 Tauri 的 `beforeBuildCommand` 自动运行 `bun run --cwd packages/desktop build`。

> [!NOTE]
> 运行桌面应用需要额外的 Tauri 依赖项（Rust 工具链、特定平台的库）。请参阅 [Tauri 先决条件](https://v2.tauri.app/start/prerequisites/) 了解设置说明。

> [!NOTE]
> 如果您更改了 API 或 SDK（例如 `packages/opencode/src/server/server.ts`），请运行 `./script/generate.ts` 以重新生成 SDK 和相关文件。

请尝试遵循 [风格指南](./STYLE_GUIDE.md)。

### 设置调试器 (Debugger)

Bun 的调试功能目前还比较粗糙。希望本指南能帮助您完成设置并避免一些痛点。

调试 OpenCode 最可靠的方法是通过 `bun run --inspect=<url> dev ...` 手动在终端运行，然后通过该 URL 附加您的调试器。其他方法可能会导致断点映射错误，至少在 VSCode 中是这样（因人而异）。

注意事项：

- 如果您想运行 OpenCode TUI 并在服务器代码中触发断点，您可能需要运行 `bun dev spawn` 而不是通常的 `bun dev`。这是因为 `bun dev` 在工作线程中运行服务器，断点可能无法在那里工作。
- 如果 `spawn` 对您不起作用，您可以单独调试服务器：
  - 调试服务器：`bun run --inspect=ws://localhost:6499/ ./src/index.ts serve --port 4096`，
    然后使用 `opencode attach http://localhost:4096` 附加 TUI。
  - 调试 TUI：`bun run --inspect=ws://localhost:6499/ --conditions=browser ./src/index.ts`

其他技巧：

- 根据您的工作流程，您可能想要使用 `--inspect-wait` 或 `--inspect-brk` 代替 `--inspect`。
- 每次调用都指定 `--inspect=ws://localhost:6499/` 可能很繁琐，您可以使用 `export BUN_OPTIONS=--inspect=ws://localhost:6499/` 代替。

#### VSCode 设置

如果您使用 VSCode，可以使用我们的配置示例 [.vscode/settings.example.json](.vscode/settings.example.json) 和 [.vscode/launch.example.json](.vscode/launch.example.json)。

一些可能有问题的调试方法：

- `"request": "launch"` 的调试配置可能会导致断点映射错误而无法使用。
- 在 VSCode `JavaScript Debug Terminal` 中运行 OpenCode 时也会出现同样的问题。

话虽如此，您不妨尝试这些方法，它们可能对您有用。

## Pull Request 期望

- 尽量保持 PR 小而专注。
- 在描述中链接相关的 issue。
- 解释问题以及您的更改为何能修复它。
- 避免使用冗长的 LLM 生成的 PR 描述。
- 在添加新函数或功能之前，请确保该行为代码库中尚未存在。

### 风格偏好

这些不是强制执行的，只是一般准则：

- **函数**：保持逻辑在一个函数内，除非拆分能通过复用或组合带来明显的好处。
- **解构**：不要进行不必要的变量解构。
- **控制流**：避免 `else` 语句。
- **错误处理**：尽可能使用 `.catch(...)` 而不是 `try`/`catch`。
- **类型**：追求精确的类型，避免 `any`。
- **变量**：坚持不可变模式，避免 `let`。
- **命名**：当能保持描述性时，选择简洁的单词标识符。
- **运行时 API**：当适合用例时，使用 Bun 辅助函数，如 `Bun.file()`。

## 功能请求

对于全新的功能，请从设计讨论开始。开启一个 issue 描述问题、您建议的方法（可选）以及为什么它属于 OpenCode。核心团队将帮助决定是否应该推进；请等待批准，不要直接开启功能 PR。
