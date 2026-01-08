# OpenCode Build and Run Guide

This document provides comprehensive instructions for building and running OpenCode in all its different interfaces: Desktop GUI, TUI, CLI, and Web Interface.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Interface Overview](#interface-overview)
- [Building and Running](#building-and-running)
  - [Desktop GUI Application](#desktop-gui-application)
  - [Terminal User Interface (TUI)](#terminal-user-interface-tui)
  - [Command Line Interface (CLI)](#command-line-interface-cli)
  - [Web Interface](#web-interface)
- [Development Workflow](#development-workflow)
- [Windows-Specific Builds](#windows-specific-builds)
- [Troubleshooting](#troubleshooting)
- [Key Files Reference](#key-files-reference)

## Prerequisites

Before building or running OpenCode, ensure you have the following installed:

### Required Tools

- **Bun** (v1.3.5 or compatible) - Package manager and runtime
- **Node.js** (v18+ or compatible)
- **Rust** (for Tauri desktop builds)
- **PowerShell** (Windows builds only)

### Optional Tools

- **Nix** - For advanced package management
- **Git** - For version control operations

### Installation Commands

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install Rust (for Tauri builds)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows PowerShell (usually pre-installed on Windows 10/11)
# For older Windows versions, install Windows PowerShell 5.1+
```

## Project Structure

OpenCode is organized as a monorepo with the following key packages:

```
opencode/
├── packages/
│   ├── desktop/          # Tauri-based desktop application
│   ├── opencode/         # Core CLI/TUI application
│   ├── web/              # Web interface
│   ├── ui/               # Shared UI components
│   └── ...
├── nix/                  # Windows build scripts and Nix configurations
├── scripts/              # Build and utility scripts
└── package.json          # Workspace configuration
```

## Interface Overview

OpenCode provides four main interfaces:

1. **Desktop GUI** - Native desktop application with Tauri
2. **TUI** - Terminal User Interface (default when running `opencode`)
3. **CLI** - Command Line Interface for programmatic access
4. **Web Interface** - Browser-based interface

## Building and Running

### Desktop GUI Application

The desktop application is built using Tauri (Rust + Web frontend).

#### Prerequisites for Desktop Build

```bash
# Install Tauri CLI
cargo install tauri-cli

# Or use the package.json script
bun run --cwd packages/desktop tauri
```

#### Development Mode

```bash
# Start desktop app in development mode
cd packages/desktop
bun run tauri dev
```

This command:
- Starts the Vite development server
- Launches the Tauri development window
- Enables hot reload for both frontend and backend
- Runs on `http://localhost:1421` by default

#### Production Build

```bash
# Build desktop application for production
cd packages/desktop
bun run tauri build
```

Build outputs are generated in:
- **Windows**: `packages/desktop/src-tauri/target/release/bundle/`
- **macOS**: `packages/desktop/src-tauri/target/release/bundle/`
- **Linux**: `packages/desktop/src-tauri/target/release/bundle/`

#### Frontend Build Only

```bash
# Build just the frontend (React/Solid.js components)
cd packages/desktop
bun run build
```

#### Desktop Build Options

```bash
# Build for specific platform
cd packages/desktop

# Windows
bun run tauri build --target x86_64-pc-windows-msvc

# macOS (Apple Silicon)
bun run tauri build --target aarch64-apple-darwin

# macOS (Intel)
bun run tauri build --target x86_64-apple-darwin

# Linux
bun run tauri build --target x86_64-unknown-linux-gnu
```

### Terminal User Interface (TUI)

The TUI is the default interface when running OpenCode commands.

#### Development Mode

```bash
# From project root
bun run dev

# Or directly from opencode package
cd packages/opencode
bun run dev
```

#### Production Usage

```bash
# Install and run globally
npm install -g @opencode-ai/opencode
opencode

# Or run from source
cd packages/opencode
bun run build
node dist/index.js
```

#### TUI Features

- Interactive terminal interface
- File browsing and editing
- AI-powered code assistance
- Built-in terminal integration
- Syntax highlighting and themes

### Command Line Interface (CLI)

OpenCode provides several CLI commands for programmatic access.

#### Available Commands

```bash
# Run a prompt directly
opencode run "analyze this codebase"

# Start server mode
opencode serve

# Web interface
opencode web

# Help and usage
opencode --help
opencode <command> --help
```

#### CLI Development

```bash
# Build CLI components
cd packages/opencode
bun run build

# Test CLI functionality
cd packages/opencode
node dist/index.js --help
```

### Web Interface

The web interface provides browser-based access to OpenCode.

#### Development Mode

```bash
# Start web interface in development mode
cd packages/web
bun run dev

# Or from project root
bun run --cwd packages/web dev
```

The web interface will be available at `http://localhost:3000` (or similar port).

#### Production Build

```bash
# Build web interface
cd packages/web
bun run build

# Preview production build
cd packages/web
bun run preview
```

## Development Workflow

### Setting Up Development Environment

1. **Clone and Setup**
   ```bash
   git clone <repository-url>
   cd opencode
   bun install
   ```

2. **Build All Packages**
   ```bash
   # Build all packages
   bun run build
   
   # Or build specific packages
   bun run --cwd packages/desktop build
   bun run --cwd packages/opencode build
   ```

3. **Run Development Servers**
   ```bash
   # Terminal UI (default)
   bun run dev
   
   # Desktop app
   cd packages/desktop && bun run tauri dev
   
   # Web interface
   cd packages/web && bun run dev
   ```

### Building for Different Platforms

#### Cross-Platform Desktop Build

```bash
# Build for multiple platforms
cd packages/desktop

# All platforms (requires proper toolchains)
bun run tauri build

# Specific platform
bun run tauri build --target <target-triple>
```

#### Platform-Specific Requirements

**Windows:**
- Visual Studio Build Tools
- Windows SDK
- Rust target: `x86_64-pc-windows-msvc`

**macOS:**
- Xcode Command Line Tools
- Rust target: `aarch64-apple-darwin` (Apple Silicon) or `x86_64-apple-darwin` (Intel)

**Linux:**
- GCC and related build tools
- Rust target: `x86_64-unknown-linux-gnu`

## Windows-Specific Builds

OpenCode includes specialized Windows build scripts and compatibility features.

### Windows Build Scripts

```bash
# Full Windows build using PowerShell
.\nix\build-windows.ps1

# Run Windows compatibility tests
.\nix\test-windows-build.ps1

# Windows integration tests
.\nix\test-windows-integration.ps1
```

### Windows Build Options

```bash
# Build for specific Windows architecture
.\nix\build-windows.ps1 -Target "x86_64-windows"
.\nix\build-windows.ps1 -Target "aarch64-windows" -Verbose

# Debug mode
.\nix\build-windows.ps1 -Debug
```

### Windows Development Setup

1. **Enable PowerShell Scripts**
   ```powershell
   Set-ExecutionPolicy RemoteSigned
   ```

2. **Install Windows Build Tools**
   ```powershell
   # Using chocolatey
   choco install visualstudio2019buildtools
   choco install windows-sdk-10-version-2004-all
   
   # Or using scoop
   scoop install visualstudio2019-workload-vctools
   ```

3. **Set Environment Variables**
   ```powershell
   $env:NIX_STORE = "C:/nix/store"
   $env:BUN_INSTALL_CACHE_DIR = "$env:TEMP/opencode-bun-cache"
   ```

### Windows Troubleshooting

Common Windows-specific issues and solutions:

**PowerShell Execution Policy:**
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Nix Store Issues:**
```powershell
# Clear Nix store cache
nix-store --gc

# Rebuild Nix environment
nix-env -iA nixpkgs.bun
```

**Rust Toolchain Issues:**
```powershell
rustup target add x86_64-pc-windows-msvc
rustup target add aarch64-pc-windows-msvc
```

## Troubleshooting

### Common Build Issues

#### Bun Installation Issues

```bash
# Clear Bun cache
bun cache clean

# Reinstall dependencies
rm -rf node_modules bun.lockb
bun install

# Fix Bun version issues
bun install --frozen-lockfile
```

#### Desktop Build Failures

```bash
# Clean Tauri build
cd packages/desktop
rm -rf src-tauri/target
cargo clean

# Update Tauri dependencies
cargo update

# Reinstall frontend dependencies
rm -rf node_modules package-lock.json
bun install
```

#### Rust/Cargo Issues

```bash
# Update Rust toolchain
rustup update

# Clean Cargo cache
cargo clean

# Update dependencies
cargo update
```

### Runtime Issues

#### Port Conflicts

```bash
# Check if ports are in use
netstat -an | grep :1421  # Tauri dev server
netstat -an | grep :3000  # Web dev server

# Kill processes using specific ports
kill -9 $(lsof -ti:1421)
```

#### Permission Issues

```bash
# Make scripts executable (Unix/macOS)
chmod +x scripts/*.ts
chmod +x install

# Fix file permissions (Linux)
sudo chown -R $USER:$USER .
```

### Performance Issues

#### Large Project Performance

OpenCode includes optimizations for large codebases:

```typescript
// Performance test for large files
node test-large-file-performance.ts

# Run performance analysis
bun run analyze:contributors
bun run analyze:issues
```

#### Memory Usage

```bash
# Monitor memory usage during development
# Desktop app: Use Task Manager (Windows) or Activity Monitor (macOS)
# TUI/Web: Use browser dev tools or terminal monitoring
```

## Key Files Reference

### Desktop Application Files

- **Configuration**: `packages/desktop/src-tauri/tauri.conf.json`
- **Main Entry**: `packages/desktop/src/index.tsx`
- **Rust Backend**: `packages/desktop/src-tauri/src/lib.rs`
- **Main.rs**: `packages/desktop/src-tauri/src/main.rs`
- **Build Script**: `packages/desktop/src-tauri/build.rs`

### Core Application Files

- **TUI Entry**: `packages/opencode/src/index.ts`
- **Server**: `packages/opencode/src/server/server.ts`
- **Session Management**: `packages/opencode/src/session/index.ts`
- **Tool Registry**: `packages/opencode/src/tool/registry.ts`

### Build and Configuration Files

- **Root Config**: `package.json` (workspace configuration)
- **Desktop Config**: `packages/desktop/package.json`
- **OpenCode Config**: `packages/opencode/package.json`
- **TypeScript Config**: `tsconfig.json`
- **Bun Config**: `bunfig.toml`

### Windows-Specific Files

- **Windows Build Script**: `nix/build-windows.ps1`
- **Windows Test Script**: `nix/test-windows-build.ps1`
- **Windows Config**: `nix/windows-opencode.nix`
- **Windows Commands**: `nix/windows-commands.psm1`

### Utility and Script Files

- **Installation Script**: `install`
- **Build Scripts**: `scripts/build-desktop-windows.ts`
- **Setup Scripts**: `scripts/setup-hooks.ts`
- **Release Scripts**: `script/release`

### Documentation Files

- **Main README**: `README.md`
- **Contributing Guide**: `CONTRIBUTING.md`
- **Style Guide**: `STYLE_GUIDE.md`
- **Agents Documentation**: `AGENTS.md`
- **Windows README**: `nix/WINDOWS_README.md`

### Development Tools

- **VS Code Settings**: `.vscode/settings.example.json`
- **Git Ignore**: `.gitignore`
- **Editor Config**: `.editorconfig`
- **Prettier Config**: `.prettierignore`

## Additional Resources

- **Official Documentation**: [opencode.ai/docs](https://opencode.ai/docs)
- **GitHub Repository**: [github.com/sst/opencode](https://github.com/sst/opencode)
- **Discord Community**: [discord.gg/opencode](https://discord.gg/opencode)
- **Tauri Documentation**: [tauri.app](https://tauri.app)
- **Bun Documentation**: [bun.sh](https://bun.sh)

---

*This guide covers the most common build and run scenarios for OpenCode. For specific issues or advanced configuration, refer to the individual package documentation or reach out to the community.*