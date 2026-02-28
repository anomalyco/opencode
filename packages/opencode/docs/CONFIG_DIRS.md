# Configuration Directory Locations

OpenCode stores its files in different directories depending on your operating system. Understanding where these files are located is important for configuration, backup, and troubleshooting.

## Overview

OpenCode follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html) for Unix-like systems, and uses platform-specific conventions for Windows.

### Quick Reference

| Directory Type | Linux | macOS | Windows |
|----------------|-------|-------|---------|
| **Configuration** | `~/.config/opencode/` | `~/Library/Application Support/opencode/` | `%APPDATA%/opencode/` |
| **Data/Credentials** | `~/.local/share/opencode/` | `~/Library/Application Support/opencode/` | `%LOCALAPPDATA%/opencode/` |
| **Cache** | `~/.cache/opencode/` | `~/Library/Caches/opencode/` | `%LOCALAPPDATA%/Temp/opencode/` |
| **State** | `~/.local/state/opencode/` | `~/Library/State/opencode/` | `%LOCALAPPDATA%/opencode/` |

## Configuration Directory (`~/.config/opencode/`)

**Purpose**: User preferences, settings, and customization files.

### What's stored here:

- **`opencode.json`** - Main configuration file
- **`opencode.jsonc`** - Configuration with comments support (preferred)
- **`config.json`** - Legacy configuration file (auto-migrated)
- **`themes/`** - Custom theme files (`*.json`)
- **`agents/`** - Custom agent definitions (`*.md`)
- **`commands/`** - Custom commands (`*.md`)
- **`plugins/`** - Local plugin files (`*.ts`, `*.js`)
- **`tools/`** - Custom tool definitions
- **`skills/`** - Custom skills (`<name>/SKILL.md`)

### Files you should preserve:

- `opencode.json` or `opencode.jsonc` - Your settings
- `themes/` - Custom themes
- `agents/` - Custom agent configurations
- `commands/` - Custom command templates

### Environment Variables:

- `$XDG_CONFIG_HOME/opencode/` - If `XDG_CONFIG_HOME` is set
- Otherwise: `$HOME/.config/opencode/`

### Windows:

- `%APPDATA%\opencode\` (usually `C:\Users\<user>\AppData\Roaming\opencode\`)

### macOS:

- `~/Library/Application Support/opencode/`

## Data Directory (`~/.local/share/opencode/`)

**Purpose**: Persistent data, authentication credentials, and session information.

### What's stored here:

- **`auth.json`** - API keys and authentication tokens
- **`mcp-auth.json`** - MCP server authentication
- **`opencode.db`** - SQLite database for sessions and messages
- **`log/`** - Application logs
- **`sessions/`** - Session history and state

### ⚠️ Important:

- Contains **sensitive authentication data**
- **Do not share** this directory
- Backup this directory to preserve sessions and credentials
- On reinstall, restore this directory to keep your data

### Environment Variables:

- `$XDG_DATA_HOME/opencode/` - If `XDG_DATA_HOME` is set
- Otherwise: `$HOME/.local/share/opencode/`

### Windows:

- `%LOCALAPPDATA%\opencode\` (usually `C:\Users\<user>\AppData\Local\opencode\`)

### macOS:

- `~/Library/Application Support/opencode/` (same as config on macOS)

## Cache Directory (`~/.cache/opencode/`)

**Purpose**: Temporary files and cached data that can be regenerated.

### What's stored here:

- Downloaded model files
- Compiled assets
- Temporary processing files
- `version` - Cache version marker

### Notes:

- **Safe to delete** - OpenCode will regenerate as needed
- Clears automatically on version updates
- Can be cleared to free up disk space

### Environment Variables:

- `$XDG_CACHE_HOME/opencode/` - If `XDG_CACHE_HOME` is set
- Otherwise: `$HOME/.cache/opencode/`

### Windows:

- `%LOCALAPPDATA%\Temp\opencode\`

### macOS:

- `~/Library/Caches/opencode/`

## State Directory (`~/.local/state/opencode/`)

**Purpose**: Application state that persists across sessions.

### What's stored here:

- Application state files
- UI preferences
- Window positions and sizes

### Notes:

- Can be cleared if UI state issues occur
- Generally safe to delete, settings will reset to defaults

### Environment Variables:

- `$XDG_STATE_HOME/opencode/` - If `XDG_STATE_HOME` is set
- Otherwise: `$HOME/.local/state/opencode/`

### Windows:

- Stored in `%LOCALAPPDATA%\opencode\`

### macOS:

- `~/Library/State/opencode/`

## Installation Directory

**Purpose**: OpenCode executable and bundled files.

### Locations:

| Installation Method | Default Location |
|---------------------|------------------|
| **npm/bun/pnpm** | `~/.npm-global/lib/node_modules/opencode-ai/` |
| **Homebrew** | `/usr/local/opt/opencode/` (Intel) <br> `/opt/homebrew/opt/opencode/` (Apple Silicon) |
| **install script** | `$OPENCODE_INSTALL_DIR` (if set) <br> `$XDG_BIN_DIR` (if set) <br> `~/.local/bin` <br> `~/.opencode/bin` (default fallback) |
| **System-wide** | `/usr/local/bin/opencode` |

### Environment Variables:

- `$OPENCODE_INSTALL_DIR` - Override installation directory
- `$XDG_BIN_DIR` - XDG-compliant binary directory

## Project Configuration

OpenCode also reads project-specific configuration from your working directory:

### In your project folder:

- **`.opencode/opencode.json`** - Project-level configuration
- **`.opencode/agents/`** - Project-specific agents
- **`.opencode/commands/`** - Project-specific commands
- **`.opencode/plugins/`** - Project plugins

### Configuration Precedence (lowest to highest):

1. Remote `.well-known/opencode` (organization defaults)
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`$OPENCODE_CONFIG`)
4. Project config (`opencode.json` in workspace)
5. `.opencode` directories (project and global)
6. Inline config (`$OPENCODE_CONFIG_CONTENT`)
7. **Managed config** (enterprise admin-controlled, always overrides)

## Backup Recommendations

### What to backup:

```bash
# Configuration
~/.config/opencode/opencode.json
~/.config/opencode/themes/
~/.config/opencode/agents/
~/.config/opencode/commands/

# Data (if you want to preserve sessions/credentials)
~/.local/share/opencode/
```

### What NOT to backup (regeneratable):

```bash
# Safe to skip - these regenerate
~/.cache/opencode/
~/.local/state/opencode/
```

## Troubleshooting

### Find where OpenCode stores files:

```bash
# Check environment variables
echo "Config: $XDG_CONFIG_HOME/opencode/"
echo "Data: $XDG_DATA_HOME/opencode/"
echo "Cache: $XDG_CACHE_HOME/opencode/"

# Or use OpenCode commands
opencode --version
opencode debug paths  # If available
```

### Common issues:

**"Config file not found"**
- Check if `~/.config/opencode/opencode.json` exists
- Create it manually if needed

**"Permission denied" errors**
- Check directory permissions
- Ensure you own the config/data directories

**Lost settings after reinstall**
- Backup `~/.config/opencode/` before uninstalling
- Restore after reinstall

## Migration from Legacy Locations

If you installed OpenCode before version 1.0, your configuration might be in legacy locations:

| Old Location | New Location |
|--------------|--------------|
| `~/.opencode/opencode.json` | `~/.config/opencode/opencode.json` |
| `~/.opencode/config.toml` | `~/.config/opencode/config.json` |

OpenCode will automatically migrate these files on first run.

## Contributing

Found incorrect information? Want to add more details? Please contribute to [anomalyco/opencode](https://github.com/anomalyco/opencode) by opening a PR to update this documentation.
