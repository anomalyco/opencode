# Lash Release Engineering

Lash uses a specialized release pipeline designed to exist alongside the upstream OpenCode project without modifying upstream source files. This ensures easier merges and cleaner separation of concerns.

## Release Scripts

The release process is driven by **Lash-specific scripts** that exist in parallel to the upstream scripts.

### 1. `script/release-lash.ts`
**The Entry Point.**
Run this script to start a release.
```bash
bun run script/release-lash.ts
```
It handles:
- Version bumping (syncs `package.json` versions).
- Changelog generation (from `lacymorrow/lash` history).
- Triggering the build/publish process.
- Creating the GitHub Release.

### 2. `packages/opencode/script/publish-lash.ts`
**The Build & Asset Transformer.**
This script is invoked by `release-lash.ts`. It:
1.  Imports `build.ts` to build standard `opencode` binaries.
2.  **Renames** artifacts from `opencode` to `lash` (e.g., `opencode-darwin-arm64` -> `lash-cli-darwin-arm64`).
3.  **Patches** the wrapper script (`bin/opencode` -> `bin/lash`) to use Lash branding and paths.
4.  **Publishes** `lash-cli` packages to NPM.
5.  **Updates** `lacymorrow/homebrew-tap` with a new `lash.rb` formula.

### 3. Helper Scripts
- **`script/changelog-lash.ts`**: Fetches commits/releases from `lacymorrow/lash` instead of upstream.
- **`packages/opencode/script/postinstall-lash.mjs`**: A modified postinstall script that creates the correct symlinks for `lash` binaries.

## Prerequisites

To run a release, you need:
- **Bun** (v1.3.x+)
- **NPM Access** to `lash-cli` package.
- **GitHub Token** with permissions for `lacymorrow/lash` and `lacymorrow/homebrew-tap`.
- **AUR Key** (optional, for Arch Linux releases).

## Directory Structure

Items marked with `(*)` are Lash-specific additions.

```text
root/
├── script/
│   ├── release-lash.ts (*)      # MAIN ENTRY POINT
│   ├── changelog-lash.ts (*)    # Lash history logic
│   └── ...
└── packages/
    └── opencode/
        └── script/
            ├── publish-lash.ts (*)      # Build/Rename/Publish logic
            ├── postinstall-lash.mjs (*) # Runtime binary finder
            ├── build.ts                 # Upstream builder (used by us)
            └── publish.ts               # Upstream publisher (ignored)
```
