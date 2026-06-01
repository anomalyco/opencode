- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Personal Fork Operations

This repository is William's public personal fork of upstream `anomalyco/opencode`:

- Fork remote: `origin` -> `https://github.com/c0dn/opencode-personal.git`
- Upstream remote: `upstream` -> `https://github.com/anomalyco/opencode.git`
- Default branch: `dev`
- The fork should normally keep only the remote `dev` branch. Feature or sync branches are temporary and should be deleted after merge.
- Do not rename the binary. Personal releases still install and run as `opencode`.

### What makes this fork custom

The fork carries a small patch stack on top of upstream `dev`:

- CLI updater and installer use GitHub Releases from `c0dn/opencode-personal`.
- Package-manager upgrades (`npm`, `bun`, `pnpm`, `brew`, `scoop`, `choco`) are blocked for personal builds.
- Only GitHub-release/curl upgrades are supported.
- Personal release builds are limited to `linux-x64` and `linux-arm64`.
- `OPENCODE_BUILD_TARGETS` filters CLI build targets, for example `linux-x64,linux-arm64`.

Key files for the personal release channel:

- `packages/opencode/src/installation/index.ts` - updater source, latest-release lookup, blocked upgrade methods.
- `install` - installer download URLs and supported platform checks.
- `packages/opencode/script/build.ts` - `OPENCODE_BUILD_TARGETS` filtering and release asset upload.
- `packages/opencode/test/installation/installation.test.ts` - updater behavior tests.
- `.github/workflows/personal-release.yml` - manual personal release workflow.
- `.github/workflows/sync-upstream.yml` - upstream sync workflow.

### Upstream sync and release mirror flow

The fork syncs from `anomalyco/opencode:dev` using `.github/workflows/sync-upstream.yml`.

- Runs daily at `08:00 UTC` and can be triggered manually with `workflow_dispatch`.
- Checks out `dev` from this fork.
- Adds/fetches `upstream` from `https://github.com/anomalyco/opencode.git`.
- Merges `upstream/dev` into the local `dev` checkout.
- Runs:
  - `bun typecheck`
  - `bun turbo test:ci`
  - `bun --cwd packages/opencode test:httpapi`
- Pushes directly to this fork's `dev` only after those checks pass.
- Detects the latest upstream GitHub Release and, if its upstream tag is contained in `dev`, mirrors it as a personal release named `v<upstream-version>-c0dn.1`.
- The `-c0dn.1` suffix avoids colliding with upstream tags inherited by the fork while keeping the version tied to the official release.

If the upstream merge conflicts or validation fails, the workflow fails before pushing to `dev`. Resolve manually by merging `upstream/dev` into `dev` locally, preserving the personal release-channel patch.

Manual sync commands:

```bash
git checkout dev
git fetch upstream dev
git merge --no-edit upstream/dev
bun typecheck
bun turbo test:ci
bun --cwd packages/opencode test:httpapi
git push origin dev
```

### Personal release flow

Use `.github/workflows/personal-release.yml` to publish personal builds.

- Trigger manually from GitHub Actions.
- Use versions like `1.15.13-c0dn.1`, `1.15.13-c0dn.2`, etc. Automated upstream mirrors use `v<upstream-version>-c0dn.1`.
- The workflow creates a GitHub Release, builds Linux CLI artifacts, uploads:
  - `opencode-linux-x64.tar.gz`
  - `opencode-linux-arm64.tar.gz`
- It publishes the release after upload succeeds.
- It can also be called by `sync-upstream.yml` after a successful upstream sync.

Manual workflow trigger example:

```bash
gh workflow run personal-release.yml --repo c0dn/opencode-personal --ref dev -f version=1.15.13-c0dn.2
```

Local install/test command for the current personal release:

```fish
set tmp (mktemp -d)
curl -L -o "$tmp/opencode.tar.gz" "https://github.com/c0dn/opencode-personal/releases/download/v1.15.13-c0dn.1/opencode-linux-x64.tar.gz"
tar -xzf "$tmp/opencode.tar.gz" -C "$tmp"
mkdir -p "$HOME/.opencode/bin"
cp "$tmp/opencode" "$HOME/.opencode/bin/opencode"
chmod +x "$HOME/.opencode/bin/opencode"
rm -rf "$tmp"
fish_add_path "$HOME/.opencode/bin"
opencode --version
```

### Making personal features

Use normal short-lived branches for personal feature work:

```bash
git checkout dev
git pull --ff-only origin dev
git checkout -b feature/<short-name>
```

Guidelines:

- Keep personal patches small and isolated so upstream syncs stay easy.
- Prefer changes that do not overlap with upstream release/updater internals unless the feature requires it.
- Open a PR from the feature branch into `dev`, or merge locally only when William asks.
- Delete feature branches after merge to keep the fork clean.
- Before release, make sure `dev` is not behind upstream and the personal updater tests pass.

Useful validation for this fork:

```bash
bun --cwd packages/opencode typecheck
bun --cwd packages/opencode test test/installation/installation.test.ts
OPENCODE_VERSION=1.15.13-c0dn.0 OPENCODE_BUILD_TARGETS=linux-x64,linux-arm64 bun ./packages/opencode/script/build.ts --skip-embed-web-ui
```

Use the full upstream test/typecheck workflows when changing broad code paths, but for release-channel-only edits the targeted updater test plus opencode package typecheck is the minimum check.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
