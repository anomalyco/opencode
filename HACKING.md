# HACKING.md

Undocumented debugging facilities, environment variables, and internal tools for Weapon developers.

## Command-Line Options

```bash
weapon --print-logs          # Print logs to stderr in real-time
weapon --log-level DEBUG     # Set log level: DEBUG | INFO | WARN | ERROR
```

When running from source (`bun run`), log level defaults to `DEBUG` automatically.

---

## Debug CLI Commands

All debug commands live under `weapon debug`:

### Paths & Config

```bash
weapon debug paths           # Show global paths (data, config, cache, state)
weapon debug config          # Dump fully resolved config as JSON
```

### Agent Inspection & Tool Execution

```bash
weapon debug agent <name>                          # Show agent config, tools, permissions
weapon debug agent <name> --tool <id>              # Execute a tool
weapon debug agent <name> --tool <id> --params '{"filePath": "/tmp/test.txt"}'
```

The `--params` flag accepts JSON or JS object literals.

### LSP Debugging

```bash
weapon debug lsp diagnostics <file>      # Get LSP diagnostics for a file
weapon debug lsp symbols <query>         # Search workspace symbols
weapon debug lsp document-symbols <uri>  # Get symbols from a document
```

### Ripgrep Internals

```bash
weapon debug rg tree [--limit N]                    # Show file tree
weapon debug rg files [--query Q] [--glob G] [--limit N]  # List files
weapon debug rg search <pattern> [--glob G] [--limit N]   # Search contents
```

### File System

```bash
weapon debug file read <path>      # Read file contents as JSON
weapon debug file status           # Show file status info
weapon debug file list <path>      # List directory contents
weapon debug file search <query>   # Search files by query
weapon debug file tree [dir]       # Show directory tree
```

### Snapshots (Undo/Redo System)

```bash
weapon debug snapshot track        # Track current snapshot state
weapon debug snapshot patch <hash> # Show patch for a snapshot
weapon debug snapshot diff <hash>  # Show diff for a snapshot
```

### Miscellaneous

```bash
weapon debug skill     # List all available skills
weapon debug scrap     # List all known projects
weapon debug wait      # Block forever (for attaching debuggers)
```

---

## Log Files

Location: `~/.local/share/weapon/log/`

**Infinite retention**: All log files are kept permanently with unique timestamps (e.g., `2026-02-13T153456.log`, `dev-2026-02-13T153456.log`). No automatic cleanup or truncation - operator handles storage management.

---

## Environment Variables

### Config & Paths

| Variable                  | Type | Description                                            |
| ------------------------- | ---- | ------------------------------------------------------ |
| `WEAPON_CONFIG`         | path | Path to custom config file                             |
| `WEAPON_CONFIG_DIR`     | path | Custom config directory (evaluated at runtime)         |
| `WEAPON_CONFIG_CONTENT` | JSON | Inline config as JSON string                           |
| `WEAPON_PERMISSION`     | JSON | Permission overrides as JSON                           |
| `WEAPON_MODELS_URL`     | URL  | Custom models endpoint (default: `https://models.dev`) |
| `WEAPON_MODELS_PATH`    | path | Path to local models JSON file                         |

### Feature Disablers

Set these to `true` or `1` to disable features:

| Variable                              | Effect                                |
| ------------------------------------- | ------------------------------------- |
| `WEAPON_DISABLE_PROJECT_CONFIG`     | Ignore `.weapon/` project config    |
| `WEAPON_DISABLE_AUTOUPDATE`         | No auto-update checks                 |
| `WEAPON_DISABLE_AUTOCOMPACT`        | No session auto-compaction            |
| `WEAPON_DISABLE_PRUNE`              | No session pruning                    |
| `WEAPON_DISABLE_LSP_DOWNLOAD`       | Don't auto-download LSP servers       |
| `WEAPON_DISABLE_DEFAULT_PLUGINS`    | Skip default plugins                  |
| `WEAPON_DISABLE_EXTERNAL_SKILLS`    | Don't load external skills            |
| `WEAPON_DISABLE_CLAUDE_CODE`        | Disable all Claude Code compatibility |
| `WEAPON_DISABLE_CLAUDE_CODE_PROMPT` | Disable Claude Code prompt format     |
| `WEAPON_DISABLE_CLAUDE_CODE_SKILLS` | Disable Claude Code skills loading    |
| `WEAPON_DISABLE_MODELS_FETCH`       | Don't fetch remote model definitions  |
| `WEAPON_DISABLE_FILETIME_CHECK`     | Skip file modification time checks    |
| `WEAPON_DISABLE_TERMINAL_TITLE`     | Don't update terminal title           |

### Experimental Features

Set `WEAPON_EXPERIMENTAL=true` to enable ALL experimental features, or enable individually:

| Variable                                        | Effect                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `WEAPON_EXPERIMENTAL`                         | Master switch for all experimental features   |
| `WEAPON_EXPERIMENTAL_FILEWATCHER`             | New file watcher implementation               |
| `WEAPON_EXPERIMENTAL_DISABLE_FILEWATCHER`     | Disable file watcher entirely                 |
| `WEAPON_EXPERIMENTAL_LSP_TOOL`                | Enable LSP tool for agents                    |
| `WEAPON_EXPERIMENTAL_LSP_TY`                  | Enable Ty (Python type checker) LSP           |
| `WEAPON_EXPERIMENTAL_OXFMT`                   | Enable oxfmt formatter                        |
| `WEAPON_EXPERIMENTAL_PLAN_MODE`               | Enable plan mode tools (PlanEnter/PlanExit)   |
| `WEAPON_EXPERIMENTAL_MARKDOWN`                | Experimental markdown rendering               |
| `WEAPON_EXPERIMENTAL_ICON_DISCOVERY`          | Project icon discovery                        |
| `WEAPON_EXPERIMENTAL_DISABLE_COPY_ON_SELECT`  | Disable copy-on-select (default on Windows)   |
| `WEAPON_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | Override bash timeout (default: 120000)       |
| `WEAPON_EXPERIMENTAL_OUTPUT_TOKEN_MAX`        | Override max output tokens (default: 32000)   |
| `WEAPON_ENABLE_EXPERIMENTAL_MODELS`           | Show alpha-status models in provider listings |
| `WEAPON_ENABLE_EXA`                           | Enable Exa web search tool                    |

### Server & Auth

| Variable                   | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| `WEAPON_SERVER_PASSWORD` | HTTP basic auth password (required for `weapon serve` / `weapon web`) |
| `WEAPON_SERVER_USERNAME` | HTTP basic auth username (default: `weapon`)                            |
| `WEAPON_AUTO_SHARE`      | Automatically share all sessions                                          |

### Development & Testing

| Variable                 | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `WEAPON_CLIENT`        | Client identifier: `cli`, `app`, `desktop`         |
| `WEAPON_FAKE_VCS`      | Fake VCS type for testing (e.g., `git`)            |
| `WEAPON_GIT_BASH_PATH` | Path to Git Bash shell on Windows                  |
| `WEAPON_CALLER`        | Set by IDE extensions: `vscode`, `vscode-insiders` |
| `WEAPON_PORT`          | Port for desktop app's local server                |

### Test-Only Variables

| Variable                           | Description                           |
| ---------------------------------- | ------------------------------------- |
| `WEAPON_TEST_HOME`               | Override home directory for tests     |
| `WEAPON_TEST_MANAGED_CONFIG_DIR` | Override managed config dir for tests |

---

## Storage Locations

| Path                                | Contents                         |
| ----------------------------------- | -------------------------------- |
| `~/.local/share/weapon/`          | Main data directory              |
| `~/.local/share/weapon/auth.json` | API keys, OAuth tokens           |
| `~/.local/share/weapon/log/`      | Log files                        |
| `~/.local/share/weapon/project/`  | Project-specific session data    |
| `~/.config/weapon/`               | Global config (`weapon.jsonc`) |
| `~/.config/weapon/plugins/`       | Global plugins                   |
| `~/.cache/weapon/`                | Provider packages, plugin cache  |

---

## Other Useful Commands

```bash
weapon models --verbose      # Show models with cost metadata
weapon stats                 # Usage statistics
weapon export                # Export session data
weapon session               # Session management
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
bun run --conditions=browser ./packages/weapon/src/index.ts

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
nix run .#weapon

# Build only
nix build .#weapon

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

After modifying server endpoints in `packages/weapon/src/server/server.ts`:

```bash
./script/generate.ts           # Regenerate SDK
./packages/sdk/js/script/build.ts  # Rebuild JS SDK
```

---

## Desktop App Debugging

### Quick Fixes

- macOS: `Weapon` menu → **Reload Webview** (for blank/frozen UI)
- Clear cache: `rm -rf ~/.cache/weapon`
- Disable plugins: Remove `plugin` key from config or rename `~/.config/weapon/plugins/`

### Linux Wayland Issues

```bash
OC_ALLOW_WAYLAND=1 weapon    # Force Wayland support
```

### Reset Desktop State

Delete these files from app data directory:

- `weapon.settings.dat`
- `weapon.global.dat`
- `weapon.workspace.*.dat`

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
weapon debug agent code

# Execute the Read tool
weapon debug agent code --tool read --params '{"filePath": "/tmp/test.txt"}'

# Execute Bash tool
weapon debug agent code --tool bash --params '{"command": "ls -la", "description": "list files"}'
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

Keybindings can be customized in config. Use `weapon debug config` to see the current keymap, or check `packages/weapon/src/config/keymap.ts` for defaults.

---

## Server API

The Weapon server exposes an HTTP API. When running with `--print-logs`, you can see all requests.

Log entries to server:

```
POST /api/log
{ "level": "debug" | "info" | "warn" | "error", "message": "...", "extra": {...} }
```

The server uses HTTP Basic Auth when `WEAPON_SERVER_PASSWORD` is set.
