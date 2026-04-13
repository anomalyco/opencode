---
title: 故障排除
description: 常见问题及其解决方法。
---

要调试 OpenCode 的问题，请先检查其存储在磁盘上的日志和本地数据。

---

## 日志

日志文件写入位置：

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: 按 `WIN+R` 并粘贴 `%USERPROFILE%\.local\share\opencode\log`

日志文件以时间戳命名（例如 `2025-01-09T123456.log`），并保留最近的 10 个日志文件。

你可以通过 `--log-level` 命令行选项设置日志级别以获取更详细的调试信息。例如：`opencode --log-level DEBUG`。

---

## 存储

OpenCode 将会话数据和其他应用数据存储在磁盘上：

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: 按 `WIN+R` 并粘贴 `%USERPROFILE%\.local\share\opencode`

该目录包含：

- `auth.json` - 身份验证数据，如 API 密钥、OAuth Token
- `log/` - 应用日志
- `project/` - 项目特定数据，如会话和消息数据
  - 如果项目位于 Git 仓库中，则存储在 `./<project-slug>/storage/`
  - 如果不是 Git 仓库，则存储在 `./global/storage/`

---

## 桌面应用

OpenCode Desktop 会在后台运行一个本地 OpenCode 服务器（即 `opencode-cli` 附属进程）。大多数问题是由插件异常、缓存损坏或错误的服务器设置引起的。

### 快速检查

- 完全退出并重新启动应用。
- 如果应用显示错误页面，请点击**重新启动**并复制错误详情。
- 仅限 macOS：`OpenCode` 菜单 -> **Reload Webview**（当 UI 空白或冻结时有效）。

---

### 禁用插件

如果桌面应用在启动时崩溃、卡住或行为异常，请先禁用插件。

#### 检查全局配置

打开你的全局配置文件，查找 `plugin` 键。

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc`（或 `~/.config/opencode/opencode.json`）
- **macOS/Linux**（旧版安装）: `~/.local/share/opencode/opencode.jsonc`
- **Windows**: 按 `WIN+R` 并粘贴 `%USERPROFILE%\.config\opencode\opencode.jsonc`

如果你配置了插件，请通过移除该键或将其设置为空数组来临时禁用它们：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### 检查插件目录

OpenCode 还可以从磁盘加载本地插件。临时将这些插件移走（或重命名文件夹），然后重新启动桌面应用：

- **全局插件**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: 按 `WIN+R` 并粘贴 `%USERPROFILE%\.config\opencode\plugins`
- **项目插件**（仅当你使用了项目级配置时）
  - `<your-project>/.opencode/plugins/`

如果应用恢复正常，请逐个重新启用插件，找出导致问题的那个。

---

### 清除缓存

如果禁用插件没有帮助（或插件安装卡住了），请清除缓存以便 OpenCode 重新构建。

1. 完全退出 OpenCode Desktop。
2. 删除缓存目录：

- **macOS**: Finder -> `Cmd+Shift+G` -> 粘贴 `~/.cache/opencode`
- **Linux**: 删除 `~/.cache/opencode`（或运行 `rm -rf ~/.cache/opencode`）
- **Windows**: 按 `WIN+R` 并粘贴 `%USERPROFILE%\.cache\opencode`

3. 重新启动 OpenCode Desktop。

---

### 修复服务器连接问题

OpenCode Desktop 可以启动自己的本地服务器（默认行为），也可以连接到你配置的服务器 URL。

如果你看到**"Connection Failed"**对话框（或应用始终停留在启动画面），请检查自定义服务器 URL。

#### 清除桌面默认服务器 URL

在主页面上，点击服务器名称（带有状态指示点）以打开服务器选择器。在**默认服务器**部分，点击**清除**。

#### 从配置中移除 `server.port` / `server.hostname`

如果你的 `opencode.json(c)` 包含 `server` 部分，请临时移除该部分并重新启动桌面应用。

#### 检查环境变量

如果你在环境中设置了 `OPENCODE_PORT`，桌面应用将尝试使用该端口作为本地服务器端口。

- 取消设置 `OPENCODE_PORT`（或选择一个空闲端口）并重新启动。

---

### Linux: Wayland / X11 问题

在 Linux 上，某些 Wayland 设置可能会导致窗口空白或合成器错误。

- 如果你使用 Wayland 且应用出现空白或崩溃，请尝试使用 `OC_ALLOW_WAYLAND=1` 启动。
- 如果情况变得更糟，请移除该设置并尝试在 X11 会话下启动。

---

### Windows: WebView2 运行时

在 Windows 上，OpenCode Desktop 需要 Microsoft Edge **WebView2 Runtime**。如果应用打开后是空白窗口或无法启动，请安装或更新 WebView2 后重试。

---

### Windows: 常见性能问题

如果你在 Windows 上遇到性能缓慢、文件访问问题或终端问题，请尝试使用 [WSL (Windows Subsystem for Linux)](/docs/windows-wsl)。WSL 提供了一个 Linux 环境，能更好地与 OpenCode 的功能兼容。

---

### 通知不显示

OpenCode Desktop 仅在以下情况下显示系统通知：

- 在操作系统设置中已为 OpenCode 启用通知，且
- 应用窗口未处于焦点状态。

---

### 重置桌面应用存储（最后手段）

如果应用无法启动且你无法从 UI 内部清除设置，请重置桌面应用的保存状态。

1. 退出 OpenCode Desktop。
2. 找到并删除以下文件（它们位于 OpenCode Desktop 应用数据目录中）：

- `opencode.settings.dat`（桌面默认服务器 URL）
- `opencode.global.dat` 和 `opencode.workspace.*.dat`（UI 状态，如最近的服务器/项目）

快速找到该目录：

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support`（然后搜索上述文件名）
- **Linux**: 在 `~/.local/share` 下搜索上述文件名
- **Windows**: 按 `WIN+R` -> `%APPDATA%`（然后搜索上述文件名）

---

## 获取帮助

如果你遇到 OpenCode 的问题：

1. **在 GitHub 上报告问题**

   报告 Bug 或请求功能的最佳方式是通过我们的 GitHub 仓库：

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   在创建新 Issue 之前，请先搜索已有的 Issue，看看你的问题是否已被报告。

2. **加入我们的 Discord**

   如需实时帮助和社区讨论，请加入我们的 Discord 服务器：

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## 常见问题

以下是一些常见问题及其解决方法。

---

### OpenCode 无法启动

1. 检查日志中的错误消息
2. 尝试使用 `--print-logs` 运行以在终端中查看输出
3. 使用 `opencode upgrade` 确保你使用的是最新版本

---

### 身份验证问题

1. 尝试在 TUI 中使用 `/connect` 命令重新进行身份验证
2. 检查你的 API 密钥是否有效
3. 确保你的网络允许连接到提供商的 API

---

### 模型不可用

1. 检查你是否已通过提供商的身份验证
2. 验证配置中的模型名称是否正确
3. 某些模型可能需要特定的访问权限或订阅

如果你遇到 `ProviderModelNotFoundError`，很可能是在某处错误地引用了模型。
模型应按如下方式引用：`<providerId>/<modelId>`

示例：

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

要查看你有权访问哪些模型，请运行 `opencode models`

---

### ProviderInitError

如果你遇到 ProviderInitError，很可能是配置无效或已损坏。

要解决此问题：

1. 首先，按照[提供商指南](/docs/providers)验证你的提供商是否已正确设置
2. 如果问题仍然存在，请尝试清除已存储的配置：

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   在 Windows 上，按 `WIN+R` 并删除：`%USERPROFILE%\.local\share\opencode`

3. 在 TUI 中使用 `/connect` 命令重新与提供商进行身份验证。

---

### AI_APICallError 和提供商包问题

如果你遇到 API 调用错误，可能是由于提供商包过期导致的。OpenCode 会根据需要动态安装提供商包（OpenAI、Anthropic、Google 等）并将它们缓存到本地。

要解决提供商包问题：

1. 清除提供商包缓存：

   ```bash
   rm -rf ~/.cache/opencode
   ```

   在 Windows 上，按 `WIN+R` 并删除：`%USERPROFILE%\.cache\opencode`

2. 重新启动 OpenCode 以重新安装最新的提供商包

这将强制 OpenCode 下载最新版本的提供商包，通常可以解决模型参数和 API 变更带来的兼容性问题。

---

### 在 Linux 上复制/粘贴不可用

Linux 用户需要安装以下剪贴板工具之一，复制/粘贴功能才能正常工作：

**对于 X11 系统：**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**对于 Wayland 系统：**

```bash
apt install -y wl-clipboard
```

**对于无头环境：**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

OpenCode 会检测你是否正在使用 Wayland 并优先使用 `wl-clipboard`，否则将按以下顺序尝试查找剪贴板工具：`xclip` 和 `xsel`。
