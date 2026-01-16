# Development Setup Guide

**Last Updated:** 2026-01-15

This guide covers setting up the OpenWork development environment from scratch.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Development Workflows](#development-workflows)
- [Package-Specific Setup](#package-specific-setup)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Bun** | 1.3.5+ | Package manager and runtime |
| **Node.js** | 22+ | Some tooling compatibility |
| **Rust** | 2024 Edition | Tauri backend |
| **Git** | 2.x | Version control |

### Platform-Specific Requirements

#### macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

#### Windows
```powershell
# Install Rust via rustup
winget install Rustlang.Rustup

# Install Bun
powershell -c "irm bun.sh/install.ps1 | iex"

# Install Visual Studio Build Tools (required for Tauri)
winget install Microsoft.VisualStudio.2022.BuildTools
```

#### Linux (Ubuntu/Debian)
```bash
# Install system dependencies
sudo apt update
sudo apt install -y build-essential curl wget file libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

---

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/anomalyco/opencode.git openwork
cd openwork

# Initialize submodules (for tauri-plugin-mcp)
git submodule update --init --recursive
```

### 2. Install Dependencies

```bash
# Install all workspace dependencies
bun install
```

### 3. Verify Setup

```bash
# Run type checking across all packages
bun run typecheck

# Verify Rust toolchain
cargo --version
rustc --version
```

---

## Development Workflows

### Running the CLI

```bash
# Run the OpenCode CLI in development mode
bun run dev
```

### Running the Desktop App

```bash
# Navigate to desktop package and run Tauri dev
cd packages/desktop
bun run tauri dev
```

Or from root:
```bash
bun run --cwd packages/desktop tauri dev
```

### Running the Web App

```bash
cd packages/app
bun run dev
```

### Running Multiple Services

For full development, you may need multiple terminal windows:

```bash
# Terminal 1: CLI/Backend
bun run dev

# Terminal 2: Desktop App
bun run --cwd packages/desktop tauri dev

# Terminal 3: Watch for type errors
bun run typecheck --watch
```

---

## Package-Specific Setup

### Desktop App (`packages/desktop`)

The desktop app requires Tauri CLI:

```bash
# Install Tauri CLI (if not installed via bun)
cargo install tauri-cli

# Development
cd packages/desktop
bun run tauri dev

# Build for production
bun run tauri build
```

#### Desktop Icons
Icons are located in:
- `packages/desktop/src-tauri/icons/dev/` - Development icons
- `packages/desktop/src-tauri/icons/prod/` - Production icons

### SDK Package (`packages/sdk/js`)

The SDK is auto-generated from OpenAPI:

```bash
cd packages/sdk/js

# Regenerate SDK from OpenAPI spec
bun run generate

# Build the SDK
bun run build
```

### UI Package (`packages/ui`)

```bash
cd packages/ui

# Development with hot reload
bun run dev

# Build components
bun run build
```

### OpenCode CLI (`packages/opencode`)

```bash
cd packages/opencode

# Run CLI
bun run src/index.ts

# Run tests
bun test
```

---

## Environment Variables

### Global Environment Variables

Create a `.env` file in the root directory for global settings:

```bash
# API Keys (for AI providers)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Server Configuration
OPENCODE_PORT=4096
OPENCODE_HOSTNAME=127.0.0.1
```

### Package-Specific Environment Variables

#### Desktop (`packages/desktop`)
```bash
# Optional: Custom server URL
OPENCODE_SERVER_URL=http://localhost:4096
```

#### Slack (`packages/slack`)
```bash
# See packages/slack/.env.example
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
```

#### Console Packages (`packages/console/*`)
```bash
# Database
DATABASE_URL=mysql://...
DATABASE_HOST=...

# Authentication
AUTH_SECRET=...
AUTH_URL=...

# AWS (for console/core)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=...
```

### Configuration Files

#### Project Configuration (`opencode.jsonc`)
Create in your project directory:

```jsonc
{
  // MCP server configurations
  "mcp": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"],
      "enabled": true
    }
  },

  // Provider configurations
  "provider": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },

  // Custom instructions
  "instructions": [
    "Always use TypeScript",
    "Follow project conventions"
  ]
}
```

---

## Monorepo Structure

### Turborepo Configuration

The project uses Turborepo for task orchestration:

```json
// turbo.json
{
  "tasks": {
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    }
  }
}
```

### Running Turbo Tasks

```bash
# Run typecheck for all packages
bun turbo typecheck

# Run build for specific package
bun turbo build --filter=@opencode-ai/app

# Run with dependency graph
bun turbo build --graph
```

### Workspace Dependencies

Internal packages use `workspace:*` protocol:

```json
{
  "dependencies": {
    "@opencode-ai/ui": "workspace:*",
    "@opencode-ai/sdk": "workspace:*",
    "@opencode-ai/util": "workspace:*"
  }
}
```

---

## IDE Setup

### VS Code

Recommended extensions:
- **Solid** - Solid.js syntax highlighting
- **Tailwind CSS IntelliSense** - Tailwind autocomplete
- **rust-analyzer** - Rust language support
- **Tauri** - Tauri development tools
- **Prettier** - Code formatting

Settings (`.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "tailwindCSS.experimental.classRegex": [
    ["class\\s*=\\s*['\"`]([^'\"`]*)['\"`]", ""]
  ]
}
```

### Cursor/Neovim

For Cursor or Neovim, ensure you have:
- TypeScript LSP configured
- rust-analyzer installed
- Tailwind CSS LSP for autocomplete

---

## Troubleshooting

### Common Issues

#### Bun Installation Fails
```bash
# Try installing specific version
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.5"

# Or use npm as fallback
npm install -g bun
```

#### Tauri Build Fails

**macOS:**
```bash
# Ensure Xcode tools are updated
xcode-select --install
sudo xcode-select --reset
```

**Linux:**
```bash
# Install missing webkit dependencies
sudo apt install -y libwebkit2gtk-4.1-dev
```

**Windows:**
```powershell
# Ensure Visual Studio Build Tools are installed
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"
```

#### Submodule Issues
```bash
# Reset submodules
git submodule deinit -f .
git submodule update --init --recursive
```

#### Type Errors After Pull
```bash
# Clean and reinstall
rm -rf node_modules
rm bun.lock
bun install

# Rebuild TypeScript
bun turbo typecheck --force
```

#### Port Already in Use
```bash
# Find process using port 4096
lsof -i :4096

# Kill the process
kill -9 <PID>
```

### Getting Help

1. Check existing issues: https://github.com/anomalyco/opencode/issues
2. Review the documentation in `/docs`
3. Ask in team communication channels

---

## Development Tips

### Hot Reload
- Desktop app: Tauri provides hot reload for frontend changes
- CLI: Use `bun --watch` for auto-restart
- Web app: Vite provides instant HMR

### Debugging
```bash
# Enable debug logging
DEBUG=* bun run dev

# Rust logging
RUST_LOG=debug bun run --cwd packages/desktop tauri dev
```

### Performance Profiling
```bash
# Profile Bun scripts
bun --profile run dev

# Profile Tauri app
RUST_LOG=tauri::perf=trace bun run --cwd packages/desktop tauri dev
```

### Quick Iteration
```bash
# Run specific test file
bun test packages/app/src/addons/serialize.test.ts

# Type check single package
bun --cwd packages/app tsc --noEmit
```
