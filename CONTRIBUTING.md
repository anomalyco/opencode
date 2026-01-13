# Contributing to OpenCode

We want to make it easy for you to contribute to OpenCode. Here are the most common type of changes that get merged:

- Bug fixes
- Additional LSPs / Formatters
- Improvements to LLM performance
- Support for new providers
- Fixes for environment-specific quirks
- Missing standard behavior
- Documentation improvements

However, any UI or core product feature must go through a design review with the core team before implementation.

If you are unsure if a PR would be accepted, feel free to ask a maintainer or look for issues with any of the following labels:

- [`help wanted`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://github.com/anomalyco/opencode/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

> [!NOTE]
> PRs that ignore these guardrails will likely be closed.

Want to take on an issue? Leave a comment and a maintainer may assign it to you unless it is something we are already working on.

## Developing OpenCode

- Requirements: Bun 1.3+
- Install dependencies and start the dev server from the repo root:

  ```bash
  bun install
  bun dev
  ```

### Running against a different directory

By default, `bun dev` runs OpenCode in the `packages/opencode` directory. To run it against a different directory or repository:

```bash
bun dev <directory>
```

To run OpenCode in the root of the opencode repo itself:

```bash
bun dev .
```

### Building a "localcode"

To compile a standalone executable:

```bash
./packages/opencode/script/build.ts --single
```

Then run it with:

```bash
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`).

- Core pieces:
  - `packages/opencode`: OpenCode core business logic & server.
  - `packages/opencode/src/cli/cmd/tui/`: The TUI code, written in SolidJS with [opentui](https://github.com/sst/opentui)
  - `packages/app`: The shared web UI components, written in SolidJS
  - `packages/desktop`: The native desktop app, built with Tauri (wraps `packages/app`)
  - `packages/plugin`: Source for `@opencode-ai/plugin`

### Running the Web App

To test UI changes during development, run the web app:

```bash
bun run --cwd packages/app dev
```

This starts a local dev server at http://localhost:5173 (or similar port shown in output). Most UI changes can be tested here.

### Running the Desktop App

The desktop app is a native Tauri application that wraps the web UI.

To run the native desktop app:

```bash
bun run --cwd packages/desktop tauri dev
```

This starts the web dev server on http://localhost:1420 and opens the native window.

If you only want the web dev server (no native shell):

```bash
bun run --cwd packages/desktop dev
```

To create a production `dist/` and build the native app bundle:

```bash
bun run --cwd packages/desktop tauri build
```

This runs `bun run --cwd packages/desktop build` automatically via Tauri’s `beforeBuildCommand`.

> [!NOTE]
> Running the desktop app requires additional Tauri dependencies (Rust toolchain, platform-specific libraries). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup instructions.

> [!NOTE]
> If you make changes to the API or SDK (e.g. `packages/opencode/src/server/server.ts`), run `./script/generate.ts` to regenerate the SDK and related files.

Please try to follow the [style guide](./STYLE_GUIDE.md)

### Setting up a Debugger

Bun debugging is currently rough around the edges. We hope this guide helps you get set up and avoid some pain points.

The most reliable way to debug OpenCode is to run it manually in a terminal via `bun run --inspect=<url> dev ...` and attach
your debugger via that URL. Other methods can result in breakpoints being mapped incorrectly, at least in VSCode (YMMV).

Caveats:

- If you want to run the OpenCode TUI and have breakpoints triggered in the server code, you might need to run `bun dev spawn` instead of
  the usual `bun dev`. This is because `bun dev` runs the server in a worker thread and breakpoints might not work there.
- If `spawn` does not work for you, you can debug the server separately:
  - Debug server: `bun run --inspect=ws://localhost:6499/ ./src/index.ts serve --port 4096`,
    then attach TUI with `opencode attach http://localhost:4096`
  - Debug TUI: `bun run --inspect=ws://localhost:6499/ --conditions=browser ./src/index.ts`

Other tips and tricks:

- You might want to use `--inspect-wait` or `--inspect-brk` instead of `--inspect`, depending on your workflow
- Specifying `--inspect=ws://localhost:6499/` on every invocation can be tiresome, you may want to `export BUN_OPTIONS=--inspect=ws://localhost:6499/` instead

#### VSCode Setup

If you use VSCode, you can use our example configurations [.vscode/settings.example.json](.vscode/settings.example.json) and [.vscode/launch.example.json](.vscode/launch.example.json).

Some debug methods that can be problematic:

- Debug configurations with `"request": "launch"` can have breakpoints incorrectly mapped and thus unusable
- The same problem arises when running OpenCode in the VSCode `JavaScript Debug Terminal`

With that said, you may want to try these methods, as they might work for you.

## Pull Request Expectations

### Issue First Policy

**All PRs must reference an existing issue.** Before opening a PR, open an issue describing the bug or feature. This helps maintainers triage and prevents duplicate work. PRs without a linked issue may be closed without review.

- Use `Fixes #123` or `Closes #123` in your PR description to link the issue
- For small fixes, a brief issue is fine - just enough context for maintainers to understand the problem

### General Requirements

- Keep pull requests small and focused
- Explain the issue and why your change fixes it
- Before adding new functionality, ensure it doesn't already exist elsewhere in the codebase

### UI Changes

If your PR includes UI changes, please include screenshots or videos showing the before and after. This helps maintainers review faster and gives you quicker feedback.

### Logic Changes

For non-UI changes (bug fixes, new features, refactors), explain **how you verified it works**:

- What did you test?
- How can a reviewer reproduce/confirm the fix?

### No AI-Generated Walls of Text

Long, AI-generated PR descriptions and issues are not acceptable and may be ignored. Respect the maintainers' time:

- Write short, focused descriptions
- Explain what changed and why in your own words
- If you can't explain it briefly, your PR might be too large

### PR Titles

PR titles should follow conventional commit standards:

- `feat:` new feature or functionality
- `fix:` bug fix
- `docs:` documentation or README changes
- `chore:` maintenance tasks, dependency updates, etc.
- `refactor:` code refactoring without changing behavior
- `test:` adding or updating tests

You can optionally include a scope to indicate which package is affected:

- `feat(app):` feature in the app package
- `fix(desktop):` bug fix in the desktop package
- `chore(opencode):` maintenance in the opencode package

Examples:

- `docs: update contributing guidelines`
- `fix: resolve crash on startup`
- `feat: add dark mode support`
- `feat(app): add dark mode support`
- `fix(desktop): resolve crash on startup`
- `chore: bump dependency versions`

### Style Preferences

These are not strictly enforced, they are just general guidelines:

- **Functions:** Keep logic within a single function unless breaking it out adds clear reuse or composition benefits.
- **Destructuring:** Do not do unnecessary destructuring of variables.
- **Control flow:** Avoid `else` statements.
- **Error handling:** Prefer `.catch(...)` instead of `try`/`catch` when possible.
- **Types:** Reach for precise types and avoid `any`.
- **Variables:** Stick to immutable patterns and avoid `let`.
- **Naming:** Choose concise single-word identifiers when they remain descriptive.
- **Runtime APIs:** Use Bun helpers such as `Bun.file()` when they fit the use case.

## Feature Requests

For net-new functionality, start with a design conversation. Open an issue describing the problem, your proposed approach (optional), and why it belongs in OpenCode. The core team will help decide whether it should move forward; please wait for that approval instead of opening a feature PR directly.
