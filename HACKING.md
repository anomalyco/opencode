# HACKING.md

Undocumented debugging facilities, environment variables, and internal tools for OpenCode developers.

## Command-Line Options

```bash
opencode --print-logs          # Print logs to stderr in real-time
opencode --log-level DEBUG     # Set log level: DEBUG | INFO | WARN | ERROR
```

When running from source (`bun run`), log level defaults to `DEBUG` automatically.

---

## Debug CLI Commands

All debug commands live under `opencode debug`:

### Paths & Config

```bash
opencode debug paths           # Show global paths (data, config, cache, state)
opencode debug config          # Dump fully resolved config as JSON
```

### Agent Inspection & Tool Execution

```bash
opencode debug agent <name>                          # Show agent config, tools, permissions
opencode debug agent <name> --tool <id>              # Execute a tool
opencode debug agent <name> --tool <id> --params '{"filePath": "/tmp/test.txt"}'
```

The `--params` flag accepts JSON or JS object literals.

### LSP Debugging

```bash
opencode debug lsp diagnostics <file>      # Get LSP diagnostics for a file
opencode debug lsp symbols <query>         # Search workspace symbols
opencode debug lsp document-symbols <uri>  # Get symbols from a document
```

### Ripgrep Internals

```bash
opencode debug rg tree [--limit N]                    # Show file tree
opencode debug rg files [--query Q] [--glob G] [--limit N]  # List files
opencode debug rg search <pattern> [--glob G] [--limit N]   # Search contents
```

### File System

```bash
opencode debug file read <path>      # Read file contents as JSON
opencode debug file status           # Show file status info
opencode debug file list <path>      # List directory contents
opencode debug file search <query>   # Search files by query
opencode debug file tree [dir]       # Show directory tree
```

### Snapshots (Undo/Redo System)

```bash
opencode debug snapshot track        # Track current snapshot state
opencode debug snapshot patch <hash> # Show patch for a snapshot
opencode debug snapshot diff <hash>  # Show diff for a snapshot
```

### Miscellaneous

```bash
opencode debug skill     # List all available skills
opencode debug scrap     # List all known projects
opencode debug wait      # Block forever (for attaching debuggers)
```

---

## Log Files

Location: `~/.local/share/opencode/log/`

**Infinite retention**: All log files are kept permanently with unique timestamps (e.g., `2026-02-13T153456.log`, `dev-2026-02-13T153456.log`). No automatic cleanup or truncation - operator handles storage management.

---

## Environment Variables

### Config & Paths

| Variable                  | Type | Description                                            |
| ------------------------- | ---- | ------------------------------------------------------ |
| `OPENCODE_CONFIG`         | path | Path to custom config file                             |
| `OPENCODE_CONFIG_DIR`     | path | Custom config directory (evaluated at runtime)         |
| `OPENCODE_CONFIG_CONTENT` | JSON | Inline config as JSON string                           |
| `OPENCODE_PERMISSION`     | JSON | Permission overrides as JSON                           |
| `OPENCODE_MODELS_URL`     | URL  | Custom models endpoint (default: `https://models.dev`) |
| `OPENCODE_MODELS_PATH`    | path | Path to local models JSON file                         |

### Feature Disablers

Set these to `true` or `1` to disable features:

| Variable                              | Effect                                |
| ------------------------------------- | ------------------------------------- |
| `OPENCODE_DISABLE_PROJECT_CONFIG`     | Ignore `.opencode/` project config    |
| `OPENCODE_DISABLE_AUTOUPDATE`         | No auto-update checks                 |
| `OPENCODE_DISABLE_AUTOCOMPACT`        | No session auto-compaction            |
| `OPENCODE_DISABLE_PRUNE`              | No session pruning                    |
| `OPENCODE_DISABLE_LSP_DOWNLOAD`       | Don't auto-download LSP servers       |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS`    | Skip default plugins                  |
| `OPENCODE_DISABLE_EXTERNAL_SKILLS`    | Don't load external skills            |
| `OPENCODE_DISABLE_CLAUDE_CODE`        | Disable all Claude Code compatibility |
| `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` | Disable Claude Code prompt format     |
| `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` | Disable Claude Code skills loading    |
| `OPENCODE_DISABLE_MODELS_FETCH`       | Don't fetch remote model definitions  |
| `OPENCODE_DISABLE_FILETIME_CHECK`     | Skip file modification time checks    |
| `OPENCODE_DISABLE_TERMINAL_TITLE`     | Don't update terminal title           |

### Experimental Features

Set `OPENCODE_EXPERIMENTAL=true` to enable ALL experimental features, or enable individually:

| Variable                                        | Effect                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `OPENCODE_EXPERIMENTAL`                         | Master switch for all experimental features   |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER`             | New file watcher implementation               |
| `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER`     | Disable file watcher entirely                 |
| `OPENCODE_EXPERIMENTAL_LSP_TOOL`                | Enable LSP tool for agents                    |
| `OPENCODE_EXPERIMENTAL_LSP_TY`                  | Enable Ty (Python type checker) LSP           |
| `OPENCODE_EXPERIMENTAL_OXFMT`                   | Enable oxfmt formatter                        |
| `OPENCODE_EXPERIMENTAL_PLAN_MODE`               | Enable plan mode tools (PlanEnter/PlanExit)   |
| `OPENCODE_EXPERIMENTAL_MARKDOWN`                | Experimental markdown rendering               |
| `OPENCODE_EXPERIMENTAL_ICON_DISCOVERY`          | Project icon discovery                        |
| `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT`  | Disable copy-on-select (default on Windows)   |
| `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | Override bash timeout (default: 120000)       |
| `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`        | Override max output tokens (default: 32000)   |
| `OPENCODE_ENABLE_EXPERIMENTAL_MODELS`           | Show alpha-status models in provider listings |
| `OPENCODE_ENABLE_EXA`                           | Enable Exa web search tool                    |

### Server & Auth

| Variable                   | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | HTTP basic auth password (required for `opencode serve` / `opencode web`) |
| `OPENCODE_SERVER_USERNAME` | HTTP basic auth username (default: `opencode`)                            |
| `OPENCODE_AUTO_SHARE`      | Automatically share all sessions                                          |

### Development & Testing

| Variable                 | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `OPENCODE_CLIENT`        | Client identifier: `cli`, `app`, `desktop`         |
| `OPENCODE_FAKE_VCS`      | Fake VCS type for testing (e.g., `git`)            |
| `OPENCODE_GIT_BASH_PATH` | Path to Git Bash shell on Windows                  |
| `OPENCODE_CALLER`        | Set by IDE extensions: `vscode`, `vscode-insiders` |
| `OPENCODE_PORT`          | Port for desktop app's local server                |

### Test-Only Variables

| Variable                           | Description                           |
| ---------------------------------- | ------------------------------------- |
| `OPENCODE_TEST_HOME`               | Override home directory for tests     |
| `OPENCODE_TEST_MANAGED_CONFIG_DIR` | Override managed config dir for tests |

---

## Storage Locations

| Path                                | Contents                         |
| ----------------------------------- | -------------------------------- |
| `~/.local/share/opencode/`          | Main data directory              |
| `~/.local/share/opencode/auth.json` | API keys, OAuth tokens           |
| `~/.local/share/opencode/log/`      | Log files                        |
| `~/.local/share/opencode/project/`  | Project-specific session data    |
| `~/.config/opencode/`               | Global config (`opencode.jsonc`) |
| `~/.config/opencode/plugins/`       | Global plugins                   |
| `~/.cache/opencode/`                | Provider packages, plugin cache  |

---

## Other Useful Commands

```bash
opencode models --verbose      # Show models with cost metadata
opencode stats                 # Usage statistics
opencode export                # Export session data
opencode session               # Session management
```

---

## Running from Source

```bash
# Install dependencies (use --ignore-scripts if bun2nix postinstall fails)
bun install
bun install --ignore-scripts  # workaround for bun2nix lockfile parsing issues

# Run TUI
bun run dev

# Run with browser conditions (required for direct execution)
bun run --conditions=browser ./packages/opencode/src/index.ts

# Run tests
bun test

# Run specific test
bun test test/tool/tool.test.ts

# Typecheck
bun run typecheck
```

---

## Nix Build

```bash
# Build and run
nix run .#opencode

# Build only
nix build .#opencode

# Enter dev shell
nix develop

# Update node_modules hash (after bun.lock changes)
# 1. Build with fakeHash to get the real hash:
nix build .#node_modules_updater
# 2. Update nix/hashes.json with the hash from the error message
# 3. Rebuild
```

**Note**: The nix build uses FOD (fixed-output derivation) for node_modules. After updating `bun.lock`, you must regenerate hashes for each platform.

---

## SDK Regeneration

After modifying server endpoints in `packages/opencode/src/server/server.ts`:

```bash
./script/generate.ts           # Regenerate SDK
./packages/sdk/js/script/build.ts  # Rebuild JS SDK
```

---

## Desktop App Debugging

### Quick Fixes

- macOS: `OpenCode` menu → **Reload Webview** (for blank/frozen UI)
- Clear cache: `rm -rf ~/.cache/opencode`
- Disable plugins: Remove `plugin` key from config or rename `~/.config/opencode/plugins/`

### Linux Wayland Issues

```bash
OC_ALLOW_WAYLAND=1 opencode    # Force Wayland support
```

### Reset Desktop State

Delete these files from app data directory:

- `opencode.settings.dat`
- `opencode.global.dat`
- `opencode.workspace.*.dat`

---

## Internal Architecture

### Key Namespaces

| Namespace                         | Purpose                    |
| --------------------------------- | -------------------------- |
| `Tool.define()`                   | Define tools               |
| `Session.create()`                | Create sessions            |
| `App.provide()`                   | Dependency injection       |
| `Log.create({ service: "name" })` | Logging                    |
| `Storage`                         | Persistence                |
| `Flag`                            | Environment variable flags |

### Tool Context

Tools receive a context with:

- `sessionID` - Current session
- `messageID` - Current message
- `callID` - Tool call identifier
- `agent` - Agent name
- `abort` - AbortSignal for cancellation
- `ask()` - Permission checking

---

## Debugging Agent Tool Execution

Create a debug session and execute tools directly:

```bash
# See what tools an agent has access to
opencode debug agent code

# Execute the Read tool
opencode debug agent code --tool read --params '{"filePath": "/tmp/test.txt"}'

# Execute Bash tool
opencode debug agent code --tool bash --params '{"command": "ls -la", "description": "list files"}'
```

---

## Undocumented TUI Features

- `Tab` - Toggle between Build/Plan mode
- `@` - Fuzzy file search
- Drag and drop images into terminal to add to prompt
- `/undo` and `/redo` - Revert/restore changes (multiple times)
- `/share` - Create shareable link to conversation

### FREE Mode Auto-Recovery

The TUI includes automatic stall detection and recovery. If the model stops responding, the system will automatically retry with exponential backoff. The status bar shows `STALL` indicator when a stall is detected (but not during normal tool execution).

### Custom Keybindings

Keybindings can be customized in config. Use `opencode debug config` to see the current keymap, or check `packages/opencode/src/config/keymap.ts` for defaults.

---

## Server API

The OpenCode server exposes an HTTP API. When running with `--print-logs`, you can see all requests.

Log entries to server:

```
POST /api/log
{ "level": "debug" | "info" | "warn" | "error", "message": "...", "extra": {...} }
```

The server uses HTTP Basic Auth when `OPENCODE_SERVER_PASSWORD` is set.
