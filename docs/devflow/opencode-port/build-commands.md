# Build and Test Commands

Use this file as the command reference for OpenCode fork work. Update it when a
new verification command is discovered or when a command has an important
environment requirement.

## Environment

Required tools:

```bash
node --version
npm --version
bun --version
```

Current local setup:
- Bun installed with `brew install oven-sh/bun/bun`.
- Verified Bun version: `1.3.13`.
- OpenCode root: `/Users/jvanzyl/js/jopen/hojo-opencode`.

## Dependency Install

Run from the OpenCode root:

```bash
bun install
```

Known behavior:
- `bun install` can update `bun.lock` even when no source change is intended.
- After switching among OpenCode PR branches, stale `node_modules` can resolve an
  older `effect` version than `bun.lock`; rerun `bun install` before treating
  Effect import/type errors as code failures.
- On `devflow/pr-15224-session-start`, it added missing lock entries for the
  PR's demo workspace package.
- On `devflow/pr-16598-session-stopping`, it changed the `ghostty-web` resolved
  Git SHA.
- Treat lockfile drift as a separate review item. Do not silently include it in
  PR absorption unless it is required and documented.

## Narrow Package Checks

Run from package directories, not with `bun --cwd`; Bun 1.3.13 did not accept
the attempted `bun --cwd "packages/opencode" run typecheck` command form.

Plugin package:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode/packages/plugin
bun run typecheck
bun run build
```

OpenCode package:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode
bun run typecheck
bun run build
```

Observed results:
- `packages/plugin`: `bun run typecheck` runs `tsgo --noEmit`.
- `packages/plugin`: `bun run build` runs `tsc`.
- `packages/opencode`: `bun run typecheck` runs `tsgo --noEmit`.
- `packages/opencode`: `bun run build` runs `bun run script/build.ts` and builds
  target binaries.

## PR-Specific Tests

Session stopping PR `#16598`:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode
bun test test/plugin/session-stopping.test.ts
```

Observed result on 2026-05-03:
- 4 pass, 0 fail, 10 assertions.
- On `devflow/hojo`, the adapted Effect-path hook test has 2 pass, 0 fail,
  4 assertions.

Session start PR `#15224`:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode
bun test test/plugin/session-start.test.ts
```

Observed result on 2026-05-03:
- On `devflow/hojo`, the adapted Effect-path hook test has 1 pass, 0 fail,
  2 assertions.
- The test verifies plugin-provided context is injected into the first session
  model call and not injected into a later model call in the same session.

Parent agent context PR `#15412`:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode
bun test test/plugin/parent-agent.test.ts
```

Observed result on 2026-05-03:
- 5 pass, 0 fail, 5 assertions.

Permission ask PR `#19470`:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode/packages/opencode
bun test test/permission/next.test.ts
```

Observed result on 2026-05-03:
- 76 pass, 1 fail, 108 assertions.
- Failing test: `permission requests stay isolated by directory`.
- This PR must not be integrated into `devflow/hojo` until the failure is
  understood or fixed.

## Root Commands

Root typecheck:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode
bun run typecheck
```

Root test command is intentionally not useful:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode
bun test
```

The root `package.json` script says `test: echo 'do not run tests from root' &&
exit 1`. Use package-level or file-level tests instead.

## Git Hygiene

Before switching branches or integrating PRs:

```bash
cd /Users/jvanzyl/js/jopen/hojo-opencode
```

Current policy:
- `docs/devflow/opencode-port/` is our tracking documentation and should be
  carried on the devflow fork branch.
- Generated lockfile changes from dependency install should be reviewed
  separately and not mixed into a PR absorption without an entry in
  `verification-log.md` and `opencode-fork-prs.md`.
