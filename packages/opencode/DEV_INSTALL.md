# Development Installation

This guide explains how to build and install the development version of OpenCode for local testing.

## Quick Start

```bash
# From packages/opencode directory
bun run dev-install
```

This will:

1. Build the current platform's binary with version `dev0.0.1-netdrop-dodged`
2. Install it to your system's binary directory
3. Show instructions to add it to PATH (if needed)

## Installation Locations

### macOS / Linux

Binary installed to: `~/.local/bin/opencode`

Add to PATH by adding this to `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Windows

Binary installed to: `%LOCALAPPDATA%\opencode\bin\opencode.exe`

Add to PATH with PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File script/dev-install-path.ps1
```

Or manually:

1. Press `Win+X`, then `A` to open PowerShell as Admin
2. Run: `setx PATH "%LOCALAPPDATA%\opencode\bin;%PATH%"`
3. Restart your terminal

## Verification

After installation, verify it works:

```bash
opencode --version
# Output: dev0.0.1-netdrop-dodged
```

## Development Workflow

### Build Only (without installing)

```bash
bun run build -- --single
```

### Build with Different Version

```bash
OPENCODE_VERSION=dev0.0.2-my-feature bun run script/dev-install.ts
```

### Rebuild After Code Changes

```bash
bun run dev-install
```

The dev version uses `OPENCODE_CHANNEL=local`, which means:

- Updates are checked from the `*` tag on npm (latest dev version)
- Version display shows `local` channel

## Network Silence Retry Feature

The current dev version includes the network silence retry feature:

- Detects immediate network failures (ECONNREFUSED, ENOTFOUND, etc.)
- Retries every 500ms with the exact same request (cache-friendly)
- Shows toast notifications for each retry attempt
- Continues until connection self-remediates or user aborts

Version: `dev0.0.1-netdrop-dodged`

## Troubleshooting

### "opencode: command not found"

- Verify the binary exists: `ls ~/.local/bin/opencode` (macOS/Linux) or `dir %LOCALAPPDATA%\opencode\bin` (Windows)
- Verify PATH is updated: `echo $PATH` (macOS/Linux) or `echo %PATH%` (Windows)
- Restart your terminal after updating PATH

### Binary not executable (macOS/Linux)

```bash
chmod +x ~/.local/bin/opencode
```

### Build fails

- Ensure Bun is installed and up to date: `bun upgrade`
- Check Node.js version compatibility
- Run from the `packages/opencode` directory

## Uninstall

Remove the development binary:

```bash
# macOS/Linux
rm ~/.local/bin/opencode

# Windows
del "%LOCALAPPDATA%\opencode\bin\opencode.exe"
```
