# Contributing to OpenCode

OpenCode is an opinionated tool, so any fundamental feature must go through a design review with the core team before implementation.

> [!IMPORTANT]
> We do not accept PRs for core features.

We still merge lots of changes when they stay within scope:

- Bug fixes
- Additional LSPs / Formatters
- Improvements to LLM performance
- Support for new providers
- Fixes for environment-specific quirks
- Missing standard behavior
- Documentation improvements

Take a look at recent git history to understand what usually lands.

If you are unsure if a PR would be accepted, feel free to ask a maintainer or look for issues with either of the following labels:

- `help wanted`
- `bug`

> [!NOTE]
> PRs that ignore these guardrails will likely be closed.

> [!NOTE]
> Want to take an issue? Leave a comment and a maintainer may assign it to you unless it is something we are already working on.

## Developing OpenCode

- Requirements: Bun 1.3+, Go 1.24.x.
- Install dependencies and start the dev server from the repo root:

  ```bash
  bun install
  bun dev
  ```

- Core pieces:
  - `packages/opencode`: opencode core business logic & server.
  - `packages/tui`: the tui code, written in Go (will be removed soon in favor of [opentui](https://github.com/sst/opentui))
  - `packages/plugin`: source of `@opencode-ai/plugin`

> [!NOTE]
> After touching `packages/opencode/src/server/server.ts`, the OpenCode team must regenerate the Stainless SDK before any client updates merge.

## Pull Request Expectations

- Try to keep pull requests small and focused.
- Link relevant issue(s) in the description
- Explain the issue and why your change fixes it
- Avoid having verbose LLM generated PR descriptions
- Before adding new functions or functionality, ensure that such behavior doesn't already exist elsewhere in the codebase.

Style Preferences (not strictly enforced, just general guidelines):

- Try to keep things in one function unless composable or reusable
- DO NOT do unnecessary destructuring of variables
- DO NOT use `else` statements unless necessary
- DO NOT use `try`/`catch` if it can be avoided
- AVOID `try`/`catch` where possible
- AVOID `else` statements
- AVOID using `any` type
- AVOID `let` statements
- PREFER single word variable names where possible
- Use as many bun apis as possible like Bun.file()

## Feature Requests

For net-new functionality, start with a design conversation. Open an issue describing the problem, your proposed approach (optional), and why it belongs in OpenCode. The core team will help decide whether it should move forward; please wait for that approval instead of opening a feature PR directly.
