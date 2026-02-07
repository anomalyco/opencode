# Lash Release Engineering

> `bun run release`

Lash uses a specialized release pipeline designed to exist alongside the upstream OpenCode project without modifying upstream source files. This ensures easier merges and cleaner separation of concerns.

## Release Scripts

The release process is driven by **Lash-specific scripts** that exist in parallel to the upstream scripts.

### 1. `script/release-lash.ts`

**The Entry Point.**

1.  **Run the Release Script**:
1.  **Publish (with Build)**:

    ```bash
    bun run publish
    ```

    This will build the artifacts and then **interactively prompt** for your NPM OTP to publish them.

    **Skip Build:** If you have already built artifacts (e.g. via `bun run build`) and just want to publish:

    ```bash
    bun run publish --skip-build
    ```

1.  **NPM Publishing (Interactive)**:
    - The script will pause and ask for your NPM 2FA/OTP code.
    - Enter the code. The script will attempt to publish all packages.
    - If the OTP expires, the script will pause and ask for a new code.
    - You can Ctrl+C to skip remaining packages if needed.

### 2. `packages/opencode/script/publish-lash.ts`

**The Build & Asset Transformer.**
This script is invoked by `release-lash.ts`. It:

1.  Imports `build-lash.ts` to build `lash` binaries directly.
2.  **Patches** the wrapper script (`bin/opencode` -> `bin/lash`) to use Lash branding and paths.
3.  **Packages** `lashcode` for NPM.
4.  **Updates** `lacymorrow/homebrew-tap` with a new `lash.rb` formula.

### 3. `packages/opencode/script/build-lash.ts`

**Lash-Specific Builder.**
A dedicated build script that outputs `lash` binaries directly, removing the need for renaming artifacts post-build.

### 3. Helper Scripts

- **`script/changelog-lash.ts`**: Fetches commits/releases from `lacymorrow/lash` instead of upstream.
- **`packages/opencode/script/postinstall-lash.mjs`**: A modified postinstall script that creates the correct symlinks for `lash` binaries.

## Prerequisites

To run a release, you need:

- **Bun** (v1.3.x+)
- **NPM Access** to `lashcode` package.
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
