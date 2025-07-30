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
- `--rc` - Create a release candidate with current version + git commit hash (format: `0.0.5-rcabcd123`)

#### Snapshot Versions

Snapshot versions are temporary builds used for testing and development. They:

- Use timestamp-based versioning (e.g., `0.0.0-202412151430` for Dec 15, 2024 at 14:30)
- Are published to npm with the `snapshot` tag instead of `latest`
- Don't create GitHub releases, AUR packages, or Homebrew formula updates
- Are useful for testing builds before creating official releases
- Can be installed with `npm install opencode-ai@snapshot`

#### Release Candidate Versions

Release candidate versions are pre-release builds that use the current package version with an RC suffix:

- Use current version + RC + 7-character git commit hash (e.g., `0.0.5-rcabcd123`)
- Are published to npm with the `rc` tag instead of `latest`
- Don't create GitHub releases, AUR packages, or Homebrew formula updates
- Are useful for testing specific versions before full releases
- Can be installed with `npm install opencode-ai@rc`
- The git hash ensures the version corresponds to the exact code being built

### Usage

```bash
# Build and test locally (equivalent to: bun run publish --rc --dry)
bun run build

# Publish a release candidate
bun run publish --rc

# Publish a snapshot release
bun run publish --snapshot

# Publish a full release (requires git tag)
bun run publish
```

### Publishing

The build process uses two main commands:

- **`bun run build`** - This is a shorthand for `bun run publish --rc --dry`
  - `--rc`: Creates a release candidate with current version + git commit hash
  - `--dry`: Performs a dry run without actually publishing anything
- **`bun run publish`** - Actually publishes packages and creates releases.
  Short hand for `./script/publish.ts`.

This separation allows you to safely test the build process before publishing.

### Build Process

The script performs the following steps:

1. **Version determination**: Uses git tags for releases, timestamp for snapshots, or current version + git hash for RC
2. **Cross-platform builds**: Builds for Linux, macOS, and Windows (x64/arm64)
3. **Package creation**: Creates platform-specific npm packages with optional dependencies
4. **Publishing**: Publishes to npm with appropriate tags (`latest`, `snapshot`, or `rc`)
5. **Release artifacts** (non-snapshot and non-RC only):
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
