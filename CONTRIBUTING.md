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

- [`help wanted`](https://github.com/sst/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://github.com/sst/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://github.com/sst/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://github.com/sst/opencode/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

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

- Core pieces:
  - `packages/opencode`: OpenCode core business logic & server.
  - `packages/opencode/src/cli/cmd/tui/`: The TUI code, written in SolidJS with [opentui](https://github.com/sst/opentui)
  - `packages/plugin`: Source for `@opencode-ai/plugin`

> [!NOTE]
> After touching `packages/opencode/src/server/server.ts`, run "./packages/sdk/js/script/build.ts" to regenerate the JS sdk.

### Setting up a Debugger

Bun debugging is currently rough around the edges. We hope this guide helps you get set up and avoid some pain points.

The most reliable way to debug OpenCode is to run it manually in a terminal via `bun run --inspect=<url> dev ...` and attach
your debugger via that URL. Other methods can result in breakpoints being mapped incorrectly, at least in VSCode (YMMV).

Caveats:

- `*.tsx` files won't have their breakpoints correctly mapped. This seems due to Bun currently not supporting source maps on code transformed
  via `BunPlugin`s (currently necessary due to our dependency on `@opentui/solid`). Currently, the best you can do in terms of debugging `*.tsx`
  files is writing a `debugger;` statement. Debugging facilities like stepping won't work, but at least you will be informed if a specific code
  is triggered.
- If you want to run the OpenCode TUI and have breakpoints triggered in the server code, you might need to run `bun dev spawn` instead of
  the usual `bun dev`. This is because `bun dev` runs the server in a worker thread and breakpoints might not work there.

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

- Try to keep pull requests small and focused.
- Link relevant issue(s) in the description
- Explain the issue and why your change fixes it
- Avoid having verbose LLM generated PR descriptions
- Before adding new functions or functionality, ensure that such behavior doesn't already exist elsewhere in the codebase.

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
