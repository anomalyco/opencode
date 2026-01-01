# Eidorail Browser Extension

A multi-platform AI chat sidebar with OpenCode integration for Chrome and Firefox.

## Features

- **Multi-Platform Support**: Switch between OpenCode, Claude, ChatGPT, Gemini, and more
- **OpenCode Integration**: Seamless connection to local or remote OpenCode servers
- **Customizable**: Add, remove, and reorder AI platforms
- **Compact Mode**: Optimized UI for narrow sidebar widths

## Installation

### From Source

```bash
# Development (hot reload)
bun run dev              # Chrome
bun run dev:firefox      # Firefox

# Production build
bun run build            # Chrome
bun run build:firefox    # Firefox
```

### Loading in Browser

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select: `packages/extension/.output/chrome-mv3/`

## OpenCode Integration

When OpenCode isn't running, the extension shows installation instructions using the **official OpenCode install methods**:

### Why Official Install Scripts?

We intentionally use OpenCode's official installation commands rather than custom protocol handlers or bundled installers because:

1. **Consistency**: Users get the same installation experience documented in OpenCode's official docs
2. **Maintainability**: No custom code to maintain as OpenCode's installation methods evolve
3. **Trust**: Users can verify the commands match official documentation
4. **Cross-platform**: Official scripts handle all platform-specific requirements

### Supported Installation Methods

| Platform    | Command                                          |
| ----------- | ------------------------------------------------ |
| Windows     | `winget install sst.opencode`                    |
| macOS/Linux | `curl -fsSL https://opencode.ai/install \| bash` |

Alternative methods (documented in [OpenCode README](https://github.com/sst/opencode)):

- **Homebrew**: `brew install opencode`
- **Chocolatey**: `choco install opencode`
- **Scoop**: `scoop install extras/opencode`
- **npm**: `npm i -g opencode-ai@latest`

### Starting the Server

After installation, users run:

```bash
opencode serve --port 4096
```

The extension detects when OpenCode is running and automatically connects.

## Architecture

```
packages/extension/
├── entrypoints/
│   ├── background.ts           # Service worker
│   ├── opencode-compact.content.ts  # Compact mode injection
│   └── sidepanel/
│       ├── main.tsx            # SolidJS app
│       └── style.css           # Dark theme
├── utils/
│   ├── opencode-status.ts      # Connection detection
│   └── terminal-launcher.ts    # Platform utilities
├── public/
│   └── iframe-rules.json       # Header modification rules
└── wxt.config.ts               # Extension config
```

## Configuration

### Connection Settings

- **Local Mode**: Connect to `localhost:{port}` (default: 4096)
- **Remote Mode**: Connect to a remote URL (Tailscale, Cloudflare Tunnel, etc.)
- **Port Scanning**: Auto-detect OpenCode port in 44000-47000 range

### Platform Management

- Add/remove AI platforms from the sidebar
- Reorder platforms via settings
- Hide platforms without removing them

## Development

Built with:

- [WXT](https://wxt.dev) - Extension framework
- [SolidJS](https://solidjs.com) - Reactive UI
- [TypeScript](https://typescriptlang.org) - Type safety

See [AGENTS.md](./AGENTS.md) for detailed development guidelines.
