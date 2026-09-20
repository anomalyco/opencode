# Task 6 verification: portable run and reporting contract

## Environment

| Item | Value |
|---|---|
| Bun | 1.4.2 |
| Branch | execution-ui |
| Base commit | a32ba6eee75c215e94c2686153b2635218350348 |
| Package | `packages/superpowers-execution` (`@bearmanser/opencode-superpowers-execution` 0.1.0) |
| Portable schema choice | Zod 4.1.8 (`catalog:`) |
| Fixture size | 24 focused tests, 184 `expect()` calls in `test/schema.test.ts` |

## Step 2: RED

```text
$ cd packages/superpowers-execution && bun test ./test/schema.test.ts
bun test v1.4.2 (744846f84)

test/schema.test.ts:
# Unhandled error between tests
error: Cannot find module '../src/schema' from '.../test/schema.test.ts'
 0 pass
 1 fail
 1 error
```

## Step 4: GREEN

```text
$ cd packages/superpowers-execution && bun test ./test/schema.test.ts
bun test v1.4.2 (744846f84)

 24 pass
 0 fail
 184 expect() calls
Ran 24 tests across 1 file. [92.00ms]
```

```text
$ cd packages/superpowers-execution && bun run typecheck
$ tsgo --noEmit
(exit 0)
```

```text
$ oxlint packages/superpowers-execution
Found 0 warnings and 0 errors.
Finished in 88ms on 5 files with 1 rules using 12 threads.
```

## Browser-import evidence

`contract load performs no storage, process, or network work` asserts:

- importing `src/contract.ts` leaves `globalThis.fetch` and `process.listenerCount("uncaughtException")` unchanged;
- the statically reachable module graph (`contract.ts` -> `schema.ts`, `progress.ts`) contains no
  `node:`/`bun:` builtins, no `Bun.`/`process.`/`fetch(`/`require(`/timers/`WebSocket`/`XMLHttpRequest`,
  and only `zod` and `@opencode/schema/rpc` as external specifiers;
- `packages/schema/src/rpc.ts`, the only OpenCode module in that graph, has no runtime value imports.

## Workspace and lockfile

```text
$ bun install
Resolving dependencies
Resolved, downloaded and extracted [30]
Saved lockfile
Checked 2526 installs across 2956 packages (no changes) [1.88s]
```

`bun.lock` gained only the new workspace entry (`packages/superpowers-execution`) and its
`@bearmanser/opencode-superpowers-execution@workspace:...` package link.

## Unrun gates

| Gate | Exact command | Outcome |
|---|---|---|
| Package build | `bun run build` (packages/superpowers-execution) | UNRUN: `script/build.ts` is owned by T20; the script is declared but the file does not exist yet. |
| Root canonical check | `bun run check` (repo root) | UNRUN: not required by the T06 brief; package `typecheck` and `oxlint` ran directly. |
| Full workspace test | `bun test` from package after T07+ | UNRUN: only T06's focused suite exists. |
| Real browser/Desktop smoke | T20 `package:smoke` | UNRUN: later task. |
