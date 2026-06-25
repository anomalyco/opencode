# opencode Quick Reference Guide

## Getting Started

```bash
opencode                    # start in current directory
opencode /path/to/project   # start in a specific directory
```

---

## Slash Commands

| Command | Alias | Description |
|---|---|---|
| `/init` | | Analyze project and create/update `AGENTS.md` |
| `/new` | `/clear` | Start a new session |
| `/sessions` | `/resume` `/continue` | List and switch sessions |
| `/undo` | | Revert last message + file changes |
| `/redo` | | Re-apply previously undone message |
| `/compact` | `/summarize` | Compact context for the current session |
| `/models` | | List available models |
| `/connect` | | Add/configure a provider API key |
| `/share` | | Share current session (creates a link) |
| `/unshare` | | Remove a shared session link |
| `/themes` | | Browse and switch themes |
| `/thinking` | | Toggle display of model reasoning blocks |
| `/details` | | Toggle tool execution details |
| `/editor` | | Open external editor for composing messages |
| `/export` | | Export conversation to Markdown |
| `/help` | | Show the help dialog |
| `/exit` | `/quit` `/q` | Exit opencode |

---

## Key Shortcuts

The default **leader key** is `ctrl+x`. Press it, then the shortcut letter.

| Shortcut | Action |
|---|---|
| `ctrl+p` | Open command palette |
| `Tab` | Cycle primary agent forward (Build → Plan → ...) |
| `Shift+Tab` | Cycle primary agent in reverse |
| `ctrl+t` | Cycle model variant (e.g. toggle thinking) |
| `Escape` | Interrupt a running session |
| `ctrl+x n` | New session |
| `ctrl+x l` | List sessions |
| `ctrl+x u` | Undo last message |
| `ctrl+x r` | Redo |
| `ctrl+x c` | Compact session |
| `ctrl+x m` | Model list |
| `ctrl+x e` | Open external editor |
| `ctrl+x x` | Export session to Markdown |
| `ctrl+x t` | Theme list |
| `ctrl+x q` | Quit |

**In the prompt:**

| Input | Action |
|---|---|
| `@filename` | Fuzzy-search and attach a file as context |
| `!command` | Run a shell command and add output to context |
| `Shift+Enter` / `ctrl+j` | Insert a newline without submitting |

---

## Agents and the Tab Key

`Tab` cycles through **primary agents** only. These are the main assistants you interact with directly. The active agent is shown in the lower-right corner of the TUI.

> Switching agents with `Tab` only affects which agent handles your *next* message — the conversation history stays intact.

### Built-in primary agents

| Agent | Description |
|---|---|
| **Build** | Default. All tools enabled — for active development work. |
| **Plan** | Read-only by default. `edit` and `bash` require approval. Use this to analyze code and review a plan *before* making changes. |

### Subagents (invoked with `@`)

Subagents do **not** appear in the `Tab` cycle. They are invoked either automatically by the primary agent, or manually by `@` mentioning them in a prompt:

| Subagent | Description |
|---|---|
| `@general` | Full tool access. Multi-step tasks, parallel work. |
| `@explore` | Read-only. Fast codebase search and navigation. |
| `@scout` | Read-only. External docs and dependency research. |

Subagents run as **child sessions**. Navigate them with:

| Key | Action |
|---|---|
| `ctrl+x` + `Down` | Enter first child session |
| `Right` | Cycle to next child session |
| `Left` | Cycle to previous child session |
| `Up` | Return to parent session |

### Custom agents and the Tab cycle

Any agent defined with `mode: primary` is added to the `Tab` cycle automatically. Use `mode: subagent` to keep it out of the cycle and accessible only via `@`. Use `mode: all` (the default) to allow both.

```md
---
description: Read-only code review
mode: primary
permission:
  edit: deny
  bash: deny
---
```

---

## The `.opencode` Folder

Place a `.opencode/` folder in your project root (or `~/.config/opencode/` for global config). OpenCode loads everything inside automatically.

```
.opencode/
  agents/       # Custom agent definitions (.md files)
  commands/     # Custom slash commands (.md files)
  skills/       # Agent skills (.md files)
  plugins/      # Local plugin files (.ts/.js)
  themes/       # Custom themes
```

**`AGENTS.md`** is the most important file — place it in the project root and commit it to Git. Run `/init` to generate one. It contains project-specific instructions (build commands, conventions, architecture notes) that are automatically injected into every session.

Global rules live at `~/.config/opencode/AGENTS.md`. Claude Code's `CLAUDE.md` is also supported as a fallback.

---

## `opencode.json`

Two config files control behavior. Both support JSONC (comments allowed).

| File | Purpose |
|---|---|
| `opencode.json` | Server/runtime behavior: models, providers, tools, permissions |
| `tui.json` | TUI appearance and keybinds: theme, scroll speed, shortcuts |

**Config locations** (later overrides earlier):

1. `~/.config/opencode/opencode.json` — global user settings
2. `opencode.json` in project root — per-project settings (safe to commit)

### Common `opencode.json` options

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "autoupdate": true,          // false | "notify"
  "snapshot": true,            // set false to disable undo/redo
  "share": "manual",           // "auto" | "disabled"
  "instructions": ["CONTRIBUTING.md", "docs/**/*.md"],
  "permission": {
    "bash": "ask",             // require approval before running bash
    "edit": "ask"
  },
  "formatter": true,           // auto-format files after edits
  "lsp": true,                 // enable LSP diagnostics
  "tools": {
    "bash": false              // disable a tool entirely
  },
  "compaction": {
    "auto": true,              // compact when context fills up
    "prune": false
  }
}
```

### Common `tui.json` options

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "opencode",
  "keybinds": {
    "leader": "ctrl+x",
    "command_list": "ctrl+p"
  },
  "scroll_speed": 3,
  "mouse": true,
  "attention": {
    "enabled": true,           // desktop notifications + sounds
    "sound": true,
    "volume": 0.4
  }
}
```

**Variable substitution** is available in config values:

| Syntax | Description |
|---|---|
| `{env:MY_VAR}` | Reads value from an environment variable |
| `{file:~/.secrets/key}` | Reads value from a file |

---

*Full docs: https://opencode.ai/docs*
