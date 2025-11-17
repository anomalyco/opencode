# Building OpenCode Binary

## Quick Build (Current Platform Only)

Build for your current platform (fastest):

```bash
cd packages/opencode
bun run build --single
```

**Output:** `dist/opencode-{os}-{arch}/bin/opencode`

**Example on macOS ARM64:**
```
dist/opencode-darwin-arm64/bin/opencode
```

**Example on Linux x64:**
```
dist/opencode-linux-x64/bin/opencode
```

## Full Build (All Platforms)

Build for all supported platforms (takes longer):

```bash
cd packages/opencode
bun run build
```

**Platforms built:**
- Linux ARM64 (glibc)
- Linux x64 (glibc)
- Linux x64 baseline (no AVX2)
- Linux ARM64 (musl)
- Linux x64 (musl)
- Linux x64 musl baseline (no AVX2)
- macOS ARM64 (Apple Silicon)
- macOS x64 (Intel)
- macOS x64 baseline (no AVX2)
- Windows x64
- Windows x64 baseline (no AVX2)

## Testing the Binary

After building, test the binary:

```bash
# Macbook (ARM64)
./dist/opencode-darwin-arm64/bin/opencode --version

# Linux x64
./dist/opencode-linux-x64/bin/opencode --version

# Start OpenCode
./dist/opencode-darwin-arm64/bin/opencode
```

## Installing the Binary

### Option 1: Copy to PATH

```bash
# macOS/Linux
sudo cp dist/opencode-darwin-arm64/bin/opencode /usr/local/bin/

# Now you can run from anywhere
opencode --version
```

### Option 2: Symlink

```bash
# macOS/Linux
ln -s $(pwd)/dist/opencode-darwin-arm64/bin/opencode /usr/local/bin/opencode

# Now you can run from anywhere
opencode --version
```

### Option 3: Add to PATH

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export PATH="$HOME/Development/ai/opencode-auto/packages/opencode/dist/opencode-darwin-arm64/bin:$PATH"
```

Then reload:

```bash
source ~/.zshrc  # or ~/.bashrc
opencode --version
```

## Build Output Structure

```
dist/
├── opencode-darwin-arm64/
│   ├── bin/
│   │   └── opencode          ← Executable binary
│   └── package.json          ← Package metadata
├── opencode-linux-x64/
│   ├── bin/
│   │   └── opencode
│   └── package.json
└── ...
```

## Build Options

### Clean Build

Remove previous builds:

```bash
cd packages/opencode
rm -rf dist
bun run build --single
```

### Debug Build

The build includes source maps in `dist/*/bin/*.js.map` for debugging.

## Differences: `bun dev` vs `opencode` binary

| Feature | `bun dev` | `opencode` binary |
|---------|-----------|-------------------|
| **Speed** | Slower (interprets TypeScript) | Faster (compiled) |
| **Updates** | Instant (no rebuild) | Requires rebuild |
| **Distribution** | Cannot distribute | Single executable |
| **File size** | N/A | ~150MB (includes runtime) |
| **Use case** | Development | Production, distribution |

## Development Workflow

**During development:**
```bash
bun dev
```

**Before testing production behavior:**
```bash
bun run build --single
./dist/opencode-darwin-arm64/bin/opencode
```

**Before creating a release:**
```bash
bun run build  # All platforms
```

## Troubleshooting

### Build fails with "Module not found"

Run from the correct directory:
```bash
cd packages/opencode
bun run build --single
```

### Binary doesn't run

Check permissions:
```bash
chmod +x dist/opencode-darwin-arm64/bin/opencode
```

### "Cannot find module @opentui/core"

The build script handles this, but if you see it:
```bash
cd packages/opencode
bun install --os="*" --cpu="*"
bun run build --single
```

### TypeScript errors during build

Make sure all changes compile:
```bash
bun run typecheck
```

Fix any errors, then rebuild.

## Build Performance

**Single platform build:** ~30-60 seconds
**All platforms build:** ~5-10 minutes

## What Gets Compiled

The build compiles:
1. Main entry point: `src/index.ts`
2. Tree-sitter parser worker: `@opentui/core/parser.worker.js`
3. TUI worker: `src/cli/cmd/tui/worker.ts`

All dependencies are bundled into the single executable.

## Binary Size

Each binary is approximately:
- **150-180MB** (includes Bun runtime + all dependencies)
- Compressed distribution: ~60-80MB

This is normal for Bun-compiled binaries as they include the runtime.

## Platform-Specific Notes

### macOS
- ARM64 (M1/M2/M3): Use `opencode-darwin-arm64`
- Intel (x86_64): Use `opencode-darwin-x64`

### Linux
- **glibc** (Ubuntu, Debian, Fedora): Use `opencode-linux-x64`
- **musl** (Alpine): Use `opencode-linux-x64-musl`
- **baseline**: For older CPUs without AVX2

### Windows
- Use `opencode-windows-x64`
- Note: Binary is named `opencode.exe` on Windows

## CI/CD Integration

The build script is designed for CI/CD:

```yaml
# Example GitHub Actions
- name: Build OpenCode
  run: |
    cd packages/opencode
    bun install
    bun run build
    
- name: Upload artifacts
  uses: actions/upload-artifact@v3
  with:
    name: opencode-binaries
    path: packages/opencode/dist/*/bin/opencode*
```

## Related Commands

```bash
# Development
bun dev

# Build
bun run build --single

# Test
bun test

# Typecheck
bun run typecheck
```

## See Also

- Development guide: `CONTRIBUTING.md`
- Release process: `RELEASING.md`
- Plugin development: `docs/PLUGIN_DEVELOPMENT.md`
