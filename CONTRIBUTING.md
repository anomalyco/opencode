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

> [!NOTE]
> PRs that ignore these guardrails will likely be closed.

Want to take on an issue? Leave a comment and a maintainer may assign it to you unless it is something we are already working on.

## Developing OpenCode

- Requirements: Bun 1.3+, Go 1.24.x.
- Install dependencies and start the dev server from the repo root:

  ```bash
  bun install
  bun dev
  ```

- Core pieces:
  - `packages/opencode`: OpenCode core business logic & server.
  - `packages/tui`: The TUI code, written in Go (will be removed soon in favor of [opentui](https://github.com/sst/opentui))
  - `packages/plugin`: Source for `@opencode-ai/plugin`

> [!NOTE]
> After touching `packages/opencode/src/server/server.ts`, the OpenCode team must regenerate the Stainless SDK before any client updates merge.

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
