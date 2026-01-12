# CloseCode - A Fork of OpenCode

CloseCode is a customized fork of [OpenCode](https://github.com/anomalyco/opencode) with enhanced support for the [Antigravity Claude Proxy](https://github.com/KhronosMirrorGroup/antigravity-claude-proxy) which provides free access to Claude and Gemini models.

## Features

### Core OpenCode Features
- Full TUI interface for AI-assisted coding
- Multi-model support (GitHub Copilot, OpenAI, Anthropic, etc.)
- Tool system (bash, file operations, grep, etc.)
- Agent system for specialized workflows
- Session management and history

### CloseCode Enhancements

#### 1. Custom Branding
- **Logo**: ASCII art spelling "CLOSECODE" (CLOSED in gray, CODE in bold)
- **Terminal Title**: "CC | {session title}"
- **Binary Name**: `closecode`
- **Config Location**: `~/.config/closecode/` and `~/.local/share/closecode/`
- **Separate from OpenCode**: Uses completely independent config directories

#### 2. Thinking Block Display
- **Problem**: Antigravity proxy returns `<thinking>` tags as text, not as reasoning events
- **Solution**: Enhanced `TextPart` component in `src/cli/cmd/tui/routes/session/index.tsx`
  - Parses `<thinking>` and `</thinking>` tags from text content
  - Displays thinking in same style as native reasoning blocks (muted gray, border)
  - Handles streaming: shows "Thinking..." while streaming, "Thinking:" when complete
  - Supports both complete and incomplete (unclosed) thinking blocks

#### 3. AG Thinking Toggle
- **Feature**: Separate control for hiding Antigravity `<thinking>` blocks
- **Files Modified**:
  - `src/cli/cmd/tui/routes/session/index.tsx` - Added `hideAGThinking` state and context
  - `src/cli/cmd/tui/component/prompt/autocomplete.tsx` - Added `/agthinking` slash command
- **Usage**: `/agthinking` toggles visibility of `<thinking>` blocks from text
  - `showThinking()`/`/thinking` - Controls all thinking visibility
  - `hideAGThinking()`/`/agthinking` - Only affects Antigravity text-based thinking

#### 4. Sudo Tool
- **Feature**: Run commands with elevated privileges using sudo
- **How it works**: Uses `sudo -A` with a GUI askpass program for password entry
- **Files**:
  - `src/tool/sudo.ts` - Sudo tool definition
  - `src/tool/registry.ts` - Tool registry
- **Prerequisites**: An askpass program must be installed (see below)

#### 5. Enhanced Configuration Loading
- **Modified**: `src/config/config.ts`
- **Supports**:
  - `~/.config/closecode/closecode.json`
  - `~/.config/closecode/closecode.jsonc`
  - `~/.config/opencode/opencode.json` (for compatibility)
  - `~/.config/opencode/opencode.jsonc`

#### 6. Model Naming to Avoid Conflicts
- **Problem**: Antigravity model IDs (e.g., `claude-opus-4-5-thinking`) conflicted with GitHub Copilot
- **Solution**: Renamed all Antigravity models with "AG" prefix
- **Examples**:
  - `claude-sonnet-4-5-thinking` → "AG Claude Sonnet 4.5 (Thinking)"
  - `gemini-3-flash` → "AG Gemini 3 Flash (Thinking)"

## Installation

### Prerequisites

#### For Sudo Tool (optional)
The sudo tool requires a GUI askpass program to prompt for your password. Install one of these:

```bash
# Arch Linux
sudo pacman -S seahorse        # GNOME (provides /usr/lib/seahorse/ssh-askpass)
# or
sudo pacman -S ksshaskpass     # KDE
# or
sudo pacman -S x11-ssh-askpass # X11 minimal

# Ubuntu/Debian
sudo apt install seahorse
# or
sudo apt install ssh-askpass-gnome

# Fedora
sudo dnf install seahorse
```

The sudo tool looks for `/usr/lib/seahorse/ssh-askpass` by default. If you use a different askpass, you can set `SUDO_ASKPASS` environment variable.

### Quick Start
```bash
# Clone the repository
git clone --depth 1 https://github.com/anomalyco/opencode ~/closecode

# Navigate to the package
cd ~/closecode/packages/opencode

# Run in development mode
bun install
bun run dev
```

### Using the Launcher
A launcher script is provided at `~/.local/bin/closecode`:

```bash
# Make sure PATH is set
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

# Run closecode
closecode
```

## Project Structure

```
~/closecode/
├── packages/
│   └── opencode/
│       ├── src/
│       │   ├── cli/
│       │   │   ├── cmd/
│       │   │   │   └── tui/
│       │   │   │       ├── routes/
│       │   │   │       │   └── session/
│       │   │   │           └── index.tsx  # Main session UI, thinking block parsing
│       │   │   └── tui/
│       │   │       ├── component/
│       │   │       │   ├── prompt/
│       │   │       │   │   └── autocomplete.tsx  # Command palette with /agthinking
│       │   │       ├── logo.tsx  # ASCII logo
│       │   │       └── ...
│       │   ├── config/
│       │   │   └── config.ts  # Enhanced config loading
│       │   └── tool/
│       │       ├── sudo.ts  # Sudo tool definition
│       │       └── registry.ts  # Tool registry (with sudo registered)
│       ├── global/
│       │   └── index.ts  # Paths: ~/.config/closecode/, ~/.local/share/closecode/
│       └── ...
├── .config/
│   ├── closecode.json  # Project config with Antigravity provider
│   ├── closecode.jsonc  # Alternate config format
│   └── ...
└── README.md  # This file
```

## Configuration

### Main Config File
`~/.config/closecode/closecode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "antigravity": {
      "npm": "@ai-sdk/anthropic",
      "name": "Antigravity (Free Claude/Gemini)",
      "options": {
        "baseURL": "http://localhost:8080/v1",
        "apiKey": "dummy"
      },
      "models": {
        "claude-sonnet-4-5-thinking": { "name": "AG Claude Sonnet 4.5 (Thinking)", ... },
        "claude-opus-4-5-thinking": { "name": "AG Claude Opus 4.5 (Thinking)", ... },
        "gemini-3-flash": { "name": "AG Gemini 3 Flash (Thinking)", ... },
        ...
      }
    }
  },
  "agent": {
    "frontend": {
      "mode": "subagent",
      "model": "antigravity/gemini-3-flash",
      "description": "Frontend development agent using Gemini",
      "prompt": "..."
    },
    "backend": {
      "mode": "subagent",
      "model": "antigravity/claude-sonnet-4-5-thinking",
      "description": "Backend development agent using Claude",
      "prompt": "..."
    }
  }
}
```

### Environment Variables
- `CLOSECODE_TEST_HOME` - Override home directory for testing
- `CLOSECODE_BIN_PATH` - Override binary path
- `CLOSECODE_CLIENT` - Override client identifier
- Supports all `OPENCODE_*` env vars for compatibility

## Antigravity Proxy Setup

### Installation
```bash
# Install the proxy globally
npm install -g antigravity-claude-proxy

# Add Google account
antigravity-claude-proxy accounts add

# Start the proxy (systemd service recommended)
antigravity-claude-proxy start

# Create systemd user service
cat > ~/.config/systemd/user/antigravity-proxy.service << 'EOF'
[Unit]
Description=Antigravity Claude Proxy

[Service]
Type=simple
ExecStart=/usr/bin/antigravity-claude-proxy start
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable antigravity-proxy.service
systemctl --user start antigravity-claude-proxy.service
```

### Checking Status
```bash
# Check if proxy is running
curl http://localhost:8080/health

# List available models
curl http://localhost:8080/v1/models

# Check account status
curl http://localhost:8080/account-limits
```

## Usage

### Basic Commands
```bash
closecode                    # Start TUI in current directory
closecode ~/project           # Start in specific project
closecode --help              # Show help
closecode --version           # Show version
closecode models              # List all available models
closecode models antigravity # List Antigravity models only
closecode models             # Select model from palette
```

### Session Commands
```
/new                        # Create new session
/clear                      # Clear current session
/export [sessionID]         # Export session to file
/import <file>               # Import session from file
/rename                      # Rename session
/fork                        # Fork from message
/session list                # List all sessions
```

### Slash Commands (in TUI)
```
/models                      # Open model selector
/agents                      # List available agents
/agthinking                   # Toggle Antigravity thinking blocks (NEW)
/thinking                    # Toggle all thinking visibility
/timeline                    # Jump to specific message
/edit                        # Open editor
/share                       # Share session
```

### Tool: Sudo
When the CloseCode agent needs to run sudo commands, it uses a GUI password dialog.

**Prerequisites**: An askpass program (seahorse, ksshaskpass, etc.) - see Installation section.

**How it works**:
1. Agent requests sudo permission
2. You approve in the TUI
3. A GUI password dialog appears (seahorse/ksshaskpass)
4. Enter your password and click OK
5. Command executes

**Example**:
```bash
sudo pacman -S neovim
sudo systemctl restart docker
```

## Development

### Building
```bash
cd ~/closecode/packages/opencode
bun install
bun run dev
```

### Adding New Providers/Models
Edit `~/.config/closecode/closecode.json` to add new providers.

### Modifying Thinking Display
Edit `~/closecode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` - The `TextPart` component.

## Key Differences from OpenCode

| Feature | OpenCode | CloseCode |
|---------|-----------|-------------|
| Binary name | `opencode` | `closecode` |
| Config dir | `~/.config/opencode/` | `~/.config/closecode/` |
| Data dir | `~/.local/share/opencode/` | `~/.local/share/closecode/` |
| Thinking display | Only SDK reasoning events | SDK reasoning + text-based `<thinking>` parsing |
| AG thinking toggle | No | `/agthinking` command |
| Sudo password | N/A | GUI askpass (seahorse) |

## Troubleshooting

### Issues

1. **Models not showing in `/models`**
   - Ensure antigravity-claude-proxy is running: `curl http://localhost:8080/health`
   - Check config path: `~/.config/closecode/closecode.json`

2. **Thinking blocks not appearing**
   - Check if `/agthinking` is enabled or disabled
   - Try toggling with `/thinking` for all thinking

3. **Build errors**
   - Clear bun cache: `rm -rf ~/.bun/.cache ~/closecode/.bun`
   - Reinstall dependencies: `bun install`

4. **Config not loading**
   - Restart closecode after changing config
   - Clear cache: `rm -rf ~/.cache/closecode`

## License

Based on OpenCode, which is licensed under MIT License.

## Credits

- **OpenCode**: [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
- **Antigravity Proxy**: [https://github.com/KhronosMirrorGroup/antigravity-claude-proxy](https://github.com/KhronosMirrorGroup/antigravity-claude-proxy)
