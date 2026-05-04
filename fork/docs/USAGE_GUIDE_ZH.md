# OpenCode (Minimal Fork) 使用指南

本文档汇总了此极简分支支持的所有命令行参数、交互指令及常用技巧。

---

## 1. 命令行启动参数 (CLI Flags)

你可以通过命令行参数直接控制 OpenCode 的启动行为。

| 参数 | 缩写 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `[project]` | - | 指定项目根目录（可选，默认为当前目录） | `opencode ./my-project` |
| `--model` | `-m` | 指定要使用的模型 | `--model opencode/minimax-m2.5-free` |
| `--agent` | - | 指定要使用的 Agent（如 `architect`, `coder`） | `--agent coder` |
| `--thinking` | - | 启动时默认开启推理过程（Thinking）显示 | `--thinking` |
| `--continue` | `-c` | 继续上一次的会话 | `--continue` |
| `--session` | `-s` | 指定 Session ID 继续特定会话 | `--session abc123` |
| `--prompt` | - | 启动后立即发送的第一条指令 | `--prompt "帮我重构代码"` |
| `--mode` | - | 切换界面模式：`minimal` (默认) 或 `tui` (原版) | `--mode tui` |

---

## 2. 交互式斜杠命令 (Slash Commands)

进入交互界面（黑窗口）后，输入 `/` 触发命令。支持 **Tab 键自动补全**。

### 🤖 核心控制
- `/model [name]`：查看当前模型或切换模型（如 `/model openai/gpt-4o`）。
- `/agent [name]`：切换 Agent 角色。
- `/thinking`：开关“思考过程”的显示（对支持 Reasoning 的模型有效）。
- `/clear`：清理终端屏幕。

### 📝 会话管理
- `/new`：开启一个全新的会话。
- `/sessions`：列出最近的 20 条历史会话。
- `/undo`：撤回上一条发送的消息。
- `/redo`：重做刚刚撤回的消息。
- `/rename [title]`：为当前会话重命名。
- `/fork`：分叉当前会话（基于当前进度开启新聊天）。

### 📤 导出与分享
- `/copy`：将当前会话的纯文本完整记录拷贝到 Stdout。
- `/export [file]`：将会话导出为 Markdown 文件（默认存放在当前目录）。
- `/share`：生成一个 Web 端可查看的分享链接。
- `/unshare`：取消当前会话的分享。

---

## 3. 常用模型推荐 (Built-in Models)

以下是一些常用的模型 ID（需运行 `opencode auth login` 登录后效果最佳）：

- **官方免费版**：`opencode/minimax-m2.5-free` (推荐，速度快)
- **OpenAI 系列**：`openai/gpt-4o`, `openai/o1-mini`
- **Anthropic 系列**：`anthropic/claude-3-5-sonnet`
- **本地模型 (需 Ollama)**：`ollama/llama3`, `ollama/qwen2.5-coder`

---

## 4. 常见问题 (FAQ)

### 如何查看支持的所有模型？
运行命令：
```bash
opencode models
```

### 如何查看当前登录状态？
运行命令：
```bash
opencode auth console
```

### 高亮显示不正常？
如果代码没有颜色，可以输入以下命令测试高亮引擎：
```bash
/debug-shiki
```
如果依然没有颜色，请确保你的终端支持真彩色（TrueColor），并建议使用 **Nord** 或相似的终端主题。

---

## 5. 维护者链接
- **维护指南**: [MAINTENANCE.md](MAINTENANCE.md)
- **架构说明**: [FORK_ARCHITECTURE_ZH.md](FORK_ARCHITECTURE_ZH.md)
