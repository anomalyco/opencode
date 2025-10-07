# Local Installation Guide

This guide shows how to install OpenCode from source for development or when you want to use the latest features that haven't been released yet.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Node.js and npm (for global installation)

## Quick Install

1. **Clone and build**:
   ```bash
   git clone git@github.com:sst/opencode.git # Currently only available at this fork: 
   cd opencode
   bun install
   ```

2. **Build for your platform**:
   ```bash
   cd packages/opencode
   bun build --compile --target=bun-darwin-arm64 --outfile=bin/opencode ./src/index.ts
   ```
   
   > **Note**: Replace `bun-darwin-arm64` with your platform:
   > - `bun-darwin-arm64` (macOS Apple Silicon)
   > - `bun-darwin-x64` (macOS Intel)  
   > - `bun-linux-x64` (Linux)
   > - `bun-windows-x64` (Windows)

3. **Install globally**:
   ```bash
   npm install -g .
   ```

4. **Verify installation**:
   ```bash
   opencode --version  # Should show "dev"
   opencode --help     # Shows all available commands
   ```

## Development Mode

For active development, you can run OpenCode directly without installing:

```bash
cd packages/opencode
bun dev  # Runs the TUI in development mode
```

## Updating

To get the latest changes:

```bash
cd opencode
git pull origin dev
bun install
cd packages/opencode
bun build --compile --target=bun-darwin-arm64 --outfile=bin/opencode ./src/index.ts
npm install -g .
```

## Uninstalling

To remove the local installation:

```bash
npm uninstall -g opencode-ai
```

---

**Need help?** Join our [Discord community](https://discord.gg/opencode) or check the [main documentation](https://opencode.ai/docs).