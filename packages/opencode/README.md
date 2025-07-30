# js

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Build

The publish script (`./script/publish.ts`) handles building and releasing opencode across multiple platforms.

### Target Platforms

The build process creates artifacts for the following platforms:

- **Linux**
  - `linux-arm64`
  - `linux-x64`
  - `linux-x64-baseline`
- **macOS (Darwin)**
  - `darwin-x64`
  - `darwin-arm64`
- **Windows**
  - `windows-x64`

### Options

- `--dry` - Perform a dry run without actually publishing packages or creating releases
- `--snapshot` - Create a snapshot release with timestamp-based version (format: `0.0.0-YYYYMMDDHHMM`)

### Usage

```bash
# Dry run to test the build process
./script/publish.ts --dry

# Create a snapshot release (dry run)
./script/publish.ts --snapshot --dry

# Create a snapshot release
./script/publish.ts --snapshot

# Create a full release (requires git tag)
./script/publish.ts
```

### Build Process

The script performs the following steps:

1. **Version determination**: Uses git tags for releases or timestamp for snapshots
2. **Cross-platform builds**: Builds for Linux, macOS, and Windows (x64/arm64)
3. **Package creation**: Creates platform-specific npm packages with optional dependencies
4. **Publishing**: Publishes to npm with appropriate tags (`latest` or `snapshot`)
5. **Release artifacts** (non-snapshot only):
   - Creates GitHub release with changelog
   - Updates AUR packages (`opencode` and `opencode-bin`)
   - Updates Homebrew formula in `sst/homebrew-tap`

### Requirements

- Bun runtime
- Go compiler (for TUI component)
- Git with appropriate permissions
- GitHub CLI (`gh`) for releases
- Environment variable `GITHUB_TOKEN` for Homebrew updates

This project was created using `bun init` in bun v1.2.12. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
