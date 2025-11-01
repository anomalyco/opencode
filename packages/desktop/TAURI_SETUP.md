# OpenCode Desktop - Tauri Setup

This package wraps the OpenCode web interface in a native Tauri application.

## Architecture

```
Tauri App (Native)
    ↓
Starts OpenCode Server (Port 4096)
    ↓
Loads Web UI → http://localhost:4096
    ↓
Connects to same sessions as CLI
```

## Prerequisites

1. **Rust**: Install from https://rustup.rs
2. **OpenCode CLI**: Must be installed and in PATH
   ```bash
   opencode --version
   ```

## Development

### Start in Dev Mode
```bash
bun run tauri:dev
```

This will:
1. Start the OpenCode server on port 4096
2. Open a native window with the web interface
3. Enable hot reload for UI changes

### Build for Production
```bash
bun run tauri:build
```

Creates native installers in `src-tauri/target/release/bundle/`

## Port Management

- **Default Port**: 4096 (same as CLI)
- **Port Conflict**: Automatically finds next available port (4097-4106)
- **Shared Server**: Can connect to existing CLI server on port 4096

## Features

✅ Native desktop application (macOS, Windows, Linux)
✅ Automatic server startup and management
✅ Port conflict detection
✅ Shared session storage with CLI
✅ System tray integration (future)
✅ Native notifications (future)

## Troubleshooting

### "opencode: command not found"
Ensure OpenCode CLI is installed:
```bash
npm install -g @opencode-ai/cli
# or
bun install -g @opencode-ai/cli
```

### Port 4096 already in use
The app will automatically use the next available port. If you have an existing OpenCode server running, it will connect to that instead.

### Build fails
Install Tauri dependencies:
```bash
# macOS
xcode-select --install

# Linux (Debian/Ubuntu)
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

## File Structure

```
desktop/
├── src/                    # Web UI source (SolidJS)
├── src-tauri/             # Tauri native wrapper
│   ├── src/
│   │   └── lib.rs         # Rust server management
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
├── index.html             # Entry point with Tauri integration
└── package.json           # Node dependencies & scripts
```

## Next Steps

- [ ] Add application icons
- [ ] Implement system tray
- [ ] Add native notifications
- [ ] Auto-updater integration
- [ ] Deep linking support
