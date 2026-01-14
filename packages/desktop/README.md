# OpenCode Desktop

Native OpenCode desktop app, built with Tauri v2.

## Development

### Environment Setup

Before running the desktop app, you must set the `RUST_TARGET` environment variable based on your platform:

**macOS:**

```bash
# Apple Silicon (M1/M2/M3)
export RUST_TARGET=aarch64-apple-darwin

# Intel
export RUST_TARGET=x86_64-apple-darwin
```

**Windows:**

```bash
export RUST_TARGET=x86_64-pc-windows-msvc
```

**Linux:**

```bash
# x64
export RUST_TARGET=x86_64-unknown-linux-gnu

# ARM64
export RUST_TARGET=aarch64-unknown-linux-gnu
```

### Running the App

From the repo root:

```bash
bun install
bun run --cwd packages/desktop tauri dev
```

This starts the Vite dev server on http://localhost:1420 and opens the native window.

If you only want the web dev server (no native shell):

```bash
export RUST_TARGET=<your-target>  # Set based on your platform
bun run --cwd packages/desktop dev
```

### Development Scripts

- `bun run --cwd packages/desktop dev` - Start web dev server only
- `bun run --cwd packages/desktop tauri dev` - Start native desktop app with hot reload
- `bun run --cwd packages/desktop tauri build` - Build production desktop app

## Build

To create a production `dist/` and build the native app bundle:

```bash
export RUST_TARGET=<your-target>  # Set based on your platform
bun run --cwd packages/desktop tauri build
```

The built app will be available in `src-tauri/target/release/bundle/`.

## Project Structure

- `src/` - React frontend source code
- `src-tauri/` - Tauri Rust backend configuration
- `src-tauri/sidecars/` - OpenCode CLI binary for desktop integration
- `scripts/` - Build and development scripts

## Sidecar Integration

The desktop app includes a sidecar binary that provides CLI functionality within the desktop environment. The binary is automatically built and copied during development.

Supported platforms:

- macOS (Intel and Apple Silicon)
- Windows (x64)
- Linux (x64 and ARM64)

## Prerequisites

Running the desktop app requires additional Tauri dependencies:

### Required Tools

- **Rust toolchain** - Install from [rustup.rs](https://rustup.rs/)
- **Platform-specific libraries** - See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### macOS Dependencies

```bash
# Install Xcode Command Line Tools
xcode-select --install
```

### Linux Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

### Windows Dependencies

- Microsoft Visual Studio C++ Build Tools
- WebView2 Runtime (usually included with Windows 10/11)

## Troubleshooting

### "RUST_TARGET not set" Error

Make sure to export the appropriate `RUST_TARGET` environment variable for your platform before running any development commands.

### Build Issues

- Ensure you have the latest Rust toolchain: `rustup update`
- Clear Tauri cache: `rm -rf packages/desktop/src-tauri/target`
- Reinstall dependencies: `bun install`
