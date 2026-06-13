# Contributing to Cedric

Thanks for working on Cedric. This fork is still close to OpenCode internally, so keep changes conservative and verify behavior against the actual package you touched.

## Development Setup

```bash
bun install
bun run dev:desktop
```

For app-only work:

```bash
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

cd ../app
bun dev -- --port 4444
```

## Validation

Tests do not run from the repo root. Run them from package directories.

```bash
cd packages/app
bun typecheck
bun test
bun run build

cd ../desktop
bun typecheck
bun run build
```

Use `bun typecheck`, not `tsc` directly, unless a package script already wraps `tsc`.

## Code Style

- Prefer the existing local patterns over new abstractions
- Avoid `any`; use concrete types or `unknown`
- Keep single-use logic inline unless a helper names a real concept
- Prefer `const`, early returns, and functional array methods
- Use Bun APIs where they fit
- Keep OpenCode-derived names only when they are still part of the underlying server, SDK, config, or package contract

## Commit Messages

Use conventional commit-style messages:

```text
type(scope): summary
```

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, such as `app`, `desktop`, `core`, `sdk`, or `plugin`.

Examples:

```text
fix(app): stabilize workspace tab activation
docs: clarify Kimi bridge startup
chore(desktop): update Cedric package metadata
```

## Pull Requests

- Explain the user-visible behavior or developer workflow changed
- Mention package-level validation that passed
- Call out known OpenCode/Cedric compatibility boundaries when relevant
- Keep unrelated rebrand, docs, and feature work out of focused fixes
