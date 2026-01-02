# OpenCode Package

The core OpenCode CLI package built with Bun and TypeScript.

## Prerequisites

- [Bun](https://bun.sh) v1.2.12 or later

## Development Setup

### 1. Install Dependencies

From the **repo root**:

```bash
bun install
```

## Running OpenCode Locally

There are three ways to run OpenCode during development:

### Option A: Direct Source Execution (Fastest for Development)

From the `packages/opencode` directory:

```bash
bun dev
```

**What this does:**

- Runs OpenCode directly from TypeScript source files
- No build step required
- Fastest iteration cycle for development
- Uses: `bun run --conditions=browser ./src/index.ts`

**Use this when:** You're actively developing and want instant feedback

---

### Option B: Compiled Binary (Test Build Output)

#### Step 1: Build the binary

From the `packages/opencode` directory:

```bash
bun run build --single
```

**What this does:**

- Compiles a native binary for your current platform only
- Output: `dist/opencode-{platform}-{arch}/bin/opencode`
- Example: `dist/opencode-darwin-arm64/bin/opencode` on Apple Silicon Mac

#### Step 2: Run the binary

From the `packages/opencode` directory:

```bash
./bin/opencode
```

**What happens:**

- The `bin/opencode` wrapper script checks `dist/` folder first
- If found, it runs your locally compiled binary
- Otherwise, it falls back to installed npm packages

**Use this when:** You want to test the actual compiled binary behavior

---

### Option C: Global Install (Test as End User)

#### Step 1: Build for current platform

```bash
bun run build --single
```

#### Step 2: Link globally (from `packages/opencode`)

```bash
npm link
```

#### Step 3: Run from anywhere

```bash
opencode
```

**What this does:**

- Installs the `opencode` command globally
- Points to your local development version
- Behaves exactly like a user installation

**Use this when:** You want to test the end-user experience

**To unlink:**

```bash
npm unlink -g opencode
```

---

### Build All Platforms

Build binaries for all supported platforms (Linux, macOS, Windows):

```bash
bun run build
```

**Use this when:** Preparing for release or testing cross-platform builds

## Testing

Run all tests:

```bash
bun test
```

Run a specific test file:

```bash
bun test test/tool/tool.test.ts
```

## Type Checking

```bash
bun run typecheck
```

## Project Structure

- `src/` - TypeScript source code
- `bin/opencode` - CLI wrapper script (ESM module)
- `script/build.ts` - Build script for compiling native binaries
- `dist/` - Compiled binaries (gitignored)

## Architecture Notes

- **Runtime**: Bun with TypeScript ESM modules
- **UI**: Built with [@opentui](https://github.com/opentui/opentui)
- **Build**: Uses Bun's compile API to create standalone binaries
- **Server/Client**: OpenCode uses a client/server architecture (TUI client communicates with TypeScript server)
