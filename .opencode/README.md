# OpenCode Custom Tools

Custom tools for this project.

## build-and-publish.sh

Builds a local Mac ARM binary and optionally publishes to npm.

### Usage

**Build local binary only:**
```bash
./.opencode/build-and-publish.sh --local-only
```

**Publish to npm only (requires existing build):**
```bash
./.opencode/build-and-publish.sh --publish-only
```

**Build and prompt for publish (default):**
```bash
./.opencode/build-and-publish.sh
```

### What it does

1. **Local Build (`--local-only`)**:
   - Runs `./script/build.ts --single` from `packages/opencode`
   - Builds only for Mac ARM64 (darwin-arm64)
   - Creates binary at `packages/opencode/dist/codesurf-ai-darwin-arm64/bin/codesurf`
   - Much faster than building all 7 platform targets

2. **Publish (`--publish-only`)**:
   - Runs `./script/publish.ts` from `packages/opencode`
   - Runs full build for all platforms
   - Publishes to npm
   - Creates GitHub release
   - Updates Homebrew formula and AUR packages

3. **Default (no flags)**:
   - Builds local binary
   - Prompts if you want to publish to npm
   - Interactive workflow

### Binary Location

After local build:
```
packages/opencode/dist/codesurf-ai-darwin-arm64/bin/codesurf
```

### Run Locally

```bash
./packages/opencode/dist/codesurf-ai-darwin-arm64/bin/codesurf
```

Or add to PATH:
```bash
export PATH="$PWD/packages/opencode/dist/codesurf-ai-darwin-arm64/bin:$PATH"
codesurf
```
