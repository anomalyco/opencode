# Agent Foundry Build Studio - Quick Start Guide

> **Status**: Week 2 MVP - Preview functionality ready for testing
> **Last Updated**: 2026-01-15

## Overview

Agent Foundry Build Studio is a desktop application for building web applications with AI-powered assistance. It features a dual-panel interface with chat on the left and a live workspace preview on the right.

## Prerequisites

Before you begin, make sure you have the following installed:

### Required Software

1. **Rust** (latest stable)
   ```bash
   # Install via rustup
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Bun** (v1.3+)
   ```bash
   # macOS/Linux
   curl -fsSL https://bun.sh/install | bash

   # Windows
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

3. **pnpm** (v8+)
   ```bash
   npm install -g pnpm
   ```

4. **Node.js** (v20+) - Required for workspace projects
   - Download from https://nodejs.org/

### System Requirements

- **macOS**: 10.15+ (Catalina or later)
- **Windows**: Windows 10/11 (64-bit)
- **Linux**: Ubuntu 20.04+ or equivalent

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode/packages/console
```

### 2. Install Dependencies

```bash
# Install frontend dependencies
bun install

# Install Rust dependencies (done automatically during build)
```

### 3. Build and Run

#### Development Mode

```bash
# Run in development mode with hot reload
bun run tauri dev
```

This will:
- Start the Vite dev server for the frontend
- Build and launch the Tauri application
- Enable hot module replacement (HMR)

#### Production Build

```bash
# Build for production
bun run tauri build
```

The compiled app will be in `src-tauri/target/release/bundle/`.

## Testing the Application

### Basic Functionality Test

1. **Launch the Application**
   ```bash
   bun run tauri dev
   ```

2. **Open a Workspace**
   - Click the "Open Workspace" button in the top-right
   - Select a directory containing a web project with:
     - `package.json` with a `dev` script
     - `node_modules/` installed (run `pnpm install` first)

3. **Start Dev Server**
   - Navigate to the "Preview" tab (right panel)
   - Click "Start Dev Server"
   - Approve the security warning dialog
   - Wait for the server to start (2-3 seconds)

4. **View Live Preview**
   - The iframe will load your app at `http://localhost:3000-4000`
   - Any changes to your code will trigger HMR
   - View logs by clicking "Show Logs"

5. **Stop Dev Server**
   - Click "Stop" to terminate the dev server
   - Port is automatically released

### Testing with a Sample Project

Create a test Vite + React project:

```bash
# Create a new React + Vite project
pnpm create vite test-app --template react-ts

# Navigate to the project
cd test-app

# Install dependencies
pnpm install

# Open this directory in Build Studio
```

## Features Available (Week 2)

### ✅ Implemented

1. **Workspace Management**
   - Open folder dialog
   - Display workspace name in header
   - Track workspace state

2. **Dev Server Control**
   - Start dev server (auto port allocation 3000-4000)
   - Stop dev server
   - Restart dev server
   - Security permission dialog

3. **Live Preview**
   - Iframe-based preview
   - Real-time updates via HMR
   - Status indicator (Starting/Running/Error)
   - Log streaming (stdout/stderr)
   - Show/hide logs panel

4. **Build System**
   - Run `pnpm build` command
   - Error reporting

### 🚧 Coming Soon (Week 3+)

- OpenCode Server integration
- AI chat functionality
- Code editor with syntax highlighting
- File tree navigation
- Deploy to Agent Foundry
- Export workspace
- Copy workspace

## Troubleshooting

### Issue: "package.json not found"

**Solution**: Make sure you opened a directory that contains a valid `package.json` file.

### Issue: "node_modules not found"

**Solution**: Run `pnpm install` in your project directory before starting the dev server.

### Issue: "Failed to start dev server"

**Possible causes**:
1. Port already in use → Try closing other dev servers
2. `pnpm` not installed → Install pnpm globally
3. No `dev` script in package.json → Add one:
   ```json
   {
     "scripts": {
       "dev": "vite"
     }
   }
   ```

### Issue: Dev server starts but preview shows blank

**Solution**:
1. Check the logs panel for errors
2. Verify the dev server is accessible: Open `http://localhost:<port>` in a browser
3. Check console for CORS errors

### Issue: Tauri build fails

**Common solutions**:
```bash
# Update Rust
rustup update

# Clean build cache
cd src-tauri
cargo clean

# Rebuild
cd ..
bun run tauri build
```

## Project Structure

```
packages/console/
├── src/                      # Frontend source (React + TypeScript)
│   ├── main.tsx             # Entry point
│   ├── App.tsx              # Main app component
│   ├── components/
│   │   ├── ChatPanel.tsx    # Left panel (chat)
│   │   ├── WorkspacePanel.tsx  # Right panel (tabs)
│   │   ├── PreviewTab.tsx   # Preview iframe + controls
│   │   └── ActionsBar.tsx   # Top-right action buttons
│   └── types/
│       └── workspace.ts     # TypeScript types
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── main.rs          # Tauri entry point
│   │   └── workspace_runner.rs  # Dev server manager
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── vite.config.ts           # Vite configuration
├── tailwind.config.js       # Tailwind CSS config
└── package.json             # Node dependencies
```

## Development Workflow

### 1. Frontend Development

```bash
# Run Vite dev server only (for UI development)
bun run dev
```

### 2. Backend (Rust) Development

```bash
# Build Rust code
cd src-tauri
cargo build
```

### 3. Full Stack Development

```bash
# Run both frontend and Tauri
bun run tauri dev
```

## Available Commands

### Frontend

```bash
bun run dev          # Start Vite dev server
bun run build        # Build frontend for production
bun run preview      # Preview production build
```

### Tauri

```bash
bun run tauri dev    # Run in dev mode
bun run tauri build  # Build for production
bun run tauri info   # System information
```

### Rust Backend

```bash
cd src-tauri
cargo test           # Run Rust tests
cargo clippy         # Lint Rust code
cargo fmt            # Format Rust code
```

## Testing Commands

### Unit Tests (Coming Soon)

```bash
bun test             # Run frontend tests
cargo test           # Run Rust tests
```

### Integration Tests (Coming Soon)

```bash
bun run test:e2e     # Run end-to-end tests
```

## Configuration

### Tauri Configuration

Edit `src-tauri/tauri.conf.json` to customize:

```json
{
  "build": {
    "devPath": "http://localhost:5173",  // Vite dev server
    "distDir": "../dist"                  // Production build output
  },
  "tauri": {
    "windows": [
      {
        "title": "Agent Foundry Build Studio",
        "width": 1400,
        "height": 900,
        "minWidth": 1000,
        "minHeight": 600
      }
    ]
  }
}
```

### Permissions

The app requires these Tauri permissions (already configured):
- `dialog` - For folder picker
- `shell` - For running `pnpm` commands
- `fs` - For reading workspace files
- `process` - For managing dev server processes

## Known Limitations (Week 2)

1. **Single Workspace**: Only one workspace can be open at a time
2. **Single Dev Server**: Only one dev server per workspace
3. **No LSP**: Code editor (coming Week 4) won't have autocomplete yet
4. **No Session Persistence**: Workspace state is lost on app restart
5. **Windows Only**: Process management is currently Windows-optimized

## Next Steps

After testing Week 2 features, the roadmap includes:

- **Week 3**: OpenCode Server integration + Session management
- **Week 4**: Code editor (CodeMirror) + File tree
- **Week 5**: Deploy to Agent Foundry
- **Week 6**: Export and Copy workspace features

## Getting Help

- **GitHub Issues**: https://github.com/anomalyco/opencode/issues
- **Documentation**: `docs/devplan/BUILD-STUDIO-DESIGN.md`
- **Changelog**: `docs/devplan/BUILD-STUDIO-CHANGELOG.md`

## Contributing

See the main OpenCode [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT License - See [LICENSE](../../LICENSE) for details.

---

**Quick Test Checklist**:

- [ ] App launches without errors
- [ ] Can open a workspace via folder dialog
- [ ] Workspace name appears in header
- [ ] "Start Dev Server" button works
- [ ] Security dialog appears and can be approved
- [ ] Preview loads in iframe
- [ ] Logs panel shows output
- [ ] Can stop/restart dev server
- [ ] Port is released after stopping
- [ ] Multiple workspaces can be opened (sequentially)

**Report issues**: If any checklist item fails, please file a bug report with:
1. Your OS and version
2. Steps to reproduce
3. Error messages from logs
4. Screenshot (if applicable)
