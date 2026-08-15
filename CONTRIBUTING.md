# Contributing to OpenCode

The changes most likely to be accepted are:

- Bug fixes
- Additional LSPs and formatters
- LLM performance improvements
- Environment-specific fixes
- Missing standard behavior
- Documentation improvements

UI and core product features require design review before implementation. If you are unsure whether a change fits, ask a maintainer or choose an issue labeled [`help wanted`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted), [`good first issue`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22), [`bug`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug), or [`perf`](https://github.com/anomalyco/opencode/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22).

Want to take on an issue? Leave a comment and a maintainer may assign it unless it is already being worked on.

> [!NOTE]
> PRs that ignore these guardrails will likely be closed.

## Adding Providers

New providers should rarely require OpenCode changes. Add the provider to [models.dev](https://github.com/anomalyco/models.dev) first.

## Development

OpenCode requires Bun 1.3 or newer. From the repository root:

```bash
bun install
bun dev [directory]
```

`bun dev` runs the V2 CLI and TUI. Pass a directory to open another project, or `.` to open this repository.

To test a development TUI against your installed OpenCode V2 background service and live sessions:

```bash
bun run dev:live [directory]
```

For web development, run the backend and app in separate terminals. Other interfaces have root scripts:

```bash
bun dev serve --port 4096
bun run dev:web
bun run dev:desktop
bun run dev:www
```

### Packages

- `packages/schema`: shared wire and storage contracts
- `packages/core`: domain behavior and persistence
- `packages/protocol`: public API definitions
- `packages/server`: HTTP server and runtime composition
- `packages/client`: generated TypeScript clients
- `packages/cli`: command-line entrypoint and service lifecycle
- `packages/tui`: terminal interface
- `packages/app`: shared web interface
- `packages/desktop`: Electron desktop application
- `packages/plugin`: plugin API

### Verification

Run typechecks, and tests where defined, from the affected package rather than the repository root:

```bash
cd packages/core
bun run test
bun typecheck
```

Follow package-specific instructions in nearby `AGENTS.md` files. After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`; never edit generated client files directly.

Follow the repository [style guide](./AGENTS.md).

## Pull Requests

### Link Issues When Required

Bug fixes, chores, and tests must reference an existing issue. Documentation, refactor, and feature PRs are exempt from the automated linked-issue check. When required, use `Fixes #123` or `Closes #123` in the PR description.

Before implementing new functionality, open a feature request describing the problem, why it belongs in OpenCode, and your proposed approach if you have one. Wait for design approval before opening the implementation PR.

Base branches on `v2`, not `dev`, and complete the provided pull request template.

### Keep It Focused

- Keep PRs small and focused.
- Explain the problem and why the change fixes it.
- Check whether the functionality already exists.
- For UI changes, include before-and-after screenshots or video.
- For logic changes, explain what you tested and how a reviewer can verify it.

### Keep It Brief

Long, AI-generated PR descriptions and issues may be ignored. Write a short explanation in your own words. If the change cannot be explained briefly, the PR may be too large.

### Use Conventional Titles

Use `type(scope): summary`. Supported types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. The scope is optional.

Examples:

- `docs: update contributing guide`
- `fix(tui): restore scroll position`
- `feat(app): add workspace search`

## Issues

Bug reports and feature requests must use their issue templates. Blank issues are not allowed; ask support and how-to questions in the [Discord community](https://discord.gg/opencode).

Automated checks flag missing templates, placeholder text, AI-generated walls of text, and missing meaningful content. You have two hours to correct a flagged issue before it closes automatically. Ask a maintainer if an issue was flagged incorrectly.
