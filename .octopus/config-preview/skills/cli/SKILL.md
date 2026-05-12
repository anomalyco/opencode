---
name: cli
description: CLI/TUI/PTY best practices for terminal applications
---

# CLI Engineering

此 Skill 供 feature-dev 和 core-dev 在涉及 CLI/TUI/PTY 代码时使用。

## 终端兼容性

### 支持的终端

| 终端             | 平台        | 最低版本 |
| ---------------- | ----------- | -------- |
| WezTerm          | 全平台      | latest   |
| Alacritty        | 全平台      | 0.12+    |
| Ghostty          | Linux/macOS | 1.0+     |
| Kitty            | Linux/macOS | 0.32+    |
| Windows Terminal | Windows     | 1.18+    |
| iTerm2           | macOS       | 3.5+     |

### 兼容性模式

- 不要假设终端支持所有 ANSI escape codes
- 使用 `terminfo` / `termcap` 查询终端能力（而非硬编码）
- True Color（24-bit）支持非必需，8-bit（256色）作为 fallback
- Mouse 支持通过 `SGR` 或 `URXVT` 协议，根据 `TERM` 自动选择

## 信号处理

### 必须处理的信号

| 信号               | 行为                     |
| ------------------ | ------------------------ |
| `SIGINT` (Ctrl+C)  | 取消当前操作，不退出 TUI |
| `SIGTERM`          | 保存状态后安全退出       |
| `SIGWINCH`         | 重新计算布局，重新渲染   |
| `SIGHUP`           | 同 SIGTERM（终端关闭时） |
| `SIGTSTP` (Ctrl+Z) | 暂停进程，恢复后刷新全屏 |

### PTY 管理

- PTY 的 stdin/stdout/stderr 独立于 TUI 的主渲染
- PTY 退出时清理子进程，不留僵尸进程
- 对 PTY 的 write 操作使用非阻塞模式，避免 TUI 冻结
- PTY 输出缓冲 > 64KB 时降速消费（backpressure）

## 渲染规范

### 颜色

- 主题颜色通过 `tui.json` 的 theme 配置管理，不硬编码色值
- 文本对比度满足 WCAG AA（≥ 4.5:1）
- 色盲友好：关键信息不做仅靠颜色的区分（配合图标或文字标签）

### 进度显示

- 长时间操作（> 500ms）显示进度指示器
- 不确定耗时的操作使用 spinner，确定性操作使用 progress bar
- 进度更新频率 ≤ 30fps（避免终端闪烁）

### 布局

- 使用 flexbox 模型布局，支持窗口缩放（SIGWINCH 响应）
- 最小窗口尺寸：80×24（经典终端标准）
- 列表/表格超过可视区域时支持虚拟滚动

## Shell 集成

### 命令执行

- 使用项目配置的 shell（`opencode.json` 的 `shell` 字段）
- 不加 `-i`（interactive）flag，避免加载 `.bashrc`/`.zshrc` 影响性能
- 命令超时默认 120s，可在 agent 配置中覆盖
- 命令输出 > 10K 行时截断，提示完整输出通过文件访问

### 环境隔离

- Agent 执行的命令不继承用户的 `PATH` 修改
- 敏感环境变量（API keys）通过 provider options 注入，不在 shell 环境中暴露
- 对 `rm`、`git push --force` 等破坏性命令提升权限级别到 `ask`

## 参考

- `packages/octopus/src/pty/` — PTY 管理
- `packages/octopus/src/shell/` — Shell 执行
- `opencode.json` schema — `shell` 配置项
- https://opencode.ai/docs/tui/ — TUI 文档
