# Execution UI release checklist (T20)

Task: T20 Package the companion, smoke-test Desktop, and finish the branch.
Spec coverage: AC01, AC19, AC20 (and the release audit for §12/§16).
Branch: `execution-ui`, base `v2` @ `c555559ac1`, base of this task `6a19173992`.
Host: Ubuntu 24.04.2 LTS under WSL, Bun 1.4.2, Playwright Chromium 1217. No Windows host.
Recorded: 2026-09-21.

## 1. Deliverables

| Item | Location |
|---|---|
| Package build | `packages/superpowers-execution/script/build.ts`, `tsconfig.build.json` |
| Package smoke helpers | `packages/superpowers-execution/script/package-smoke.ts` |
| Regression tests | `packages/superpowers-execution/test/package-smoke.test.ts` |
| Package install/rollback docs | `packages/superpowers-execution/README.md` |
| User-facing feature guide | `docs/superpowers/verification/execution-ui/feature-guide.md` |
| Spec coverage | `docs/superpowers/verification/execution-ui/spec-coverage.md` |
| Disposable host gate | `bun run package:host-smoke` (explicit XDG dirs + loopback port, never the user's service) |

## 2. Staged package (AC19, part 1)

`buildStagedPackage()` stages outside the monorepo at `/tmp/opencode-superpowers-execution-package`.
The staged layout:

```text
/tmp/opencode-superpowers-execution-package
├── LICENSE
├── README.md
├── index.js
├── package.json
├── dist/{plugin.js,plugin.d.ts,contract.js,contract.d.ts,principal.d.ts,progress.d.ts,reducer.d.ts,reporting.d.ts,repository.d.ts,schema.d.ts}
├── skills/superpowers-execution-reporting/SKILL.md
└── node_modules/{@opencode/plugin,@opencode/schema,zod}   # symlinked local workspace deps
```

Staged manifest (workspace/catalog references resolved to exact versions):

```json
{
  "name": "@bearmanser/opencode-superpowers-execution",
  "version": "0.1.0",
  "description": "Portable execution run and reporting contract for the Superpowers execution UI",
  "type": "module",
  "license": "MIT",
  "main": "./index.js",
  "exports": { ".": "./index.js", "./contract": "./dist/contract.js" },
  "files": ["index.js", "dist", "skills", "README.md", "LICENSE"],
  "dependencies": { "@opencode/plugin": "2.0.11", "@opencode/schema": "2.0.11", "zod": "4.1.8" }
}
```

The regression test asserts no staged dependency starts with `workspace:` or `catalog:`.
`index.js` (`export { default } from "./dist/plugin.js"`) leads to the built plugin
(`plugin.id === "superpowers-execution"`), and the reporting skill resolves through the
dist-relative `../skills` layout inside the staged directory.

## 3. Browser contract smoke (AC01)

`importStagedContractInBrowser()` bundles the staged `dist/contract.js` for `target: "browser"` and
imports it inside a real Playwright Chromium page.

```text
BROWSER {"rpcID":"superpowers.execution.v1","serverModulesLoaded":[]}
```

- `rpcID` is the shared contract id.
- `serverModulesLoaded` is derived from the browser bundle's metafile inputs and is empty: the
  contract graph contains no `plugin`, `repository`, `principal`, `reporting`, or `reducer` module
  and no node builtin (`node:*`, `crypto`, `path`, `fs`, `os`). The renderer contract therefore does
  not pull in server storage, filesystem modules, Core, or plugin setup.

## 4. Built plugin lifecycle smoke (AC19, part 2)

`bun run package:smoke` drives the **staged built** plugin (not the workspace source) through the
plugin harness:

```text
$ cd packages/superpowers-execution && bun run package:smoke
(pass) staged contract is browser-safe and package is self-contained [1418.79ms]
(pass) the staged package directory entry loads its built plugin and its dist-relative reporting skill [1107.53ms]
(pass) the staged built plugin installs, reports, serves getRun, unloads, reloads, and recovers stored state [1159.41ms]
(skip) the built package directory loads in a disposable 2.0.11 host and survives an isolated restart

 3 pass / 1 skip / 0 fail
 23 expect() calls
```

The lifecycle case installs (`setup`), reports (`execution_report` → revision 1), reads `getRun`,
unloads (RPC becomes `rpc.method_not_found`), reloads a second `setup` over the same storage, and
recovers the stored run plus its summary.

## 5. Disposable 2.0.11 host load and isolated restart (AC19, part 3)

```text
$ cd packages/superpowers-execution && bun run package:host-smoke
(pass) staged contract is browser-safe and package is self-contained [1343.30ms]
(pass) the staged package directory entry loads its built plugin and its dist-relative reporting skill [1184.90ms]
(pass) the staged built plugin installs, reports, serves getRun, unloads, reloads, and recovers stored state [1215.36ms]
(pass) the built package directory loads in a disposable 2.0.11 host and survives an isolated restart [8139.85ms]

 4 pass / 0 fail
```

Raw gate result:

```text
HOST {"directory":"/tmp/opencode-superpowers-execution-package","port":38446,
      "first":{"pluginVersion":"0.1.0","runCount":0},
      "restarted":{"pluginVersion":"0.1.0","runCount":0}}
```

Server log (two separate boots, same isolated XDG data directory; the host loads the staged
package directory entry, not workspace source):

```text
timestamp=... msg="loading plugin" id=/tmp/opencode-superpowers-execution-package entrypoint=file:///tmp/opencode-superpowers-execution-package/index.js
timestamp=... msg="loading plugin" id=/tmp/opencode-superpowers-execution-package entrypoint=file:///tmp/opencode-superpowers-execution-package/index.js
```

The gate starts its own `packages/cli` server on a freshly allocated loopback port with its own
`XDG_{CONFIG,DATA,CACHE,STATE}_HOME` under a `mkdtemp` directory, a per-run Basic-auth password, and
`{ "plugins": ["<staged dir>"] }`. It calls `capabilities` and `listRuns` over authenticated HTTP,
then kills and restarts the same isolated host and repeats. It never runs service discovery and
never stops, restarts, or replaces the user's service.

## 6. Browser/web smoke (AC20, non-Windows)

```text
$ cd packages/app
$ EXECUTION_E2E_TARGET='{"disposable":true,"directory":"/tmp/opencode/execution-e2e","port":4601}' \
    bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
 20 passed (3.3m)
 execution credential artifact scan: clean (2 files)
```

The target is explicitly selected and validated (disposable, absolute tmp directory, loopback,
non-production port). The disposable host is the T18 stand-in; the built-package real-host gate is
§5 above.

## 7. Desktop smoke (AC20, Windows gate)

**UNRUN — no Windows host in this environment.** Exact reason: the executor runs Ubuntu/WSL with no
Windows machine; Electron/Desktop cannot be launched against a Windows host here. This is an unrun
gate, not a pass.

Required manual Windows procedure (before calling the project done):

1. Start the explicitly selected test WSL server (not the production service) and note its URL and
   credential.
2. Launch the development or custom Desktop build against that test server.
3. Verify: Execution tab opens/closes and persists; native browser panes are hidden while Execution
   is active; permission/question navigation still reaches the session controls; child-session
   navigation stays on the same server and keeps the root run; reload restores the view.
4. Record the observed result with the server selection and build hash.

Non-Windows Desktop package checks that did run:

```text
$ cd packages/desktop
$ bun run typecheck     # tsgo -b
 exit 0
$ bun run build         # electron-vite build
 exit 0
$ bun run test          # bun test --timeout 30000
 187 pass / 2 skip / 2 fail
```

The two failures are environmental: `test/browser-native.test.ts` and `test/browser-idle.test.ts`
launch Electron, which aborts with
`FATAL: Running as root without --no-sandbox is not supported` (exit 133). They are not caused by
this task and are not claimed as passing.

## 8. Shared frontend and branch checks (actual outcomes)

| Command | Result |
|---|---|
| `packages/superpowers-execution`: `bun test` | 115 pass / 1 skip / 0 fail |
| `packages/superpowers-execution`: `bun run typecheck` | exit 0 |
| `packages/superpowers-execution`: `bun run build` | exit 0 (`dist/` + declarations) |
| `packages/superpowers-execution`: `bun run package:smoke` | 3 pass / 1 skip / 0 fail |
| `packages/superpowers-execution`: `bun run package:host-smoke` | 4 pass / 0 fail |
| `packages/app`: `bun run typecheck` | exit 0 |
| `packages/app`: `bun run test:unit` | 1051 pass / 1 skip / 0 fail |
| `packages/app`: `bun run test:browser` | 157 pass / 0 fail |
| `packages/app`: `bun run test:components component-tests/superpowers.spec.ts` | **FAILED**: 103 passed, 1 failed |
| `packages/app`: `bun run test:e2e e2e/superpowers/execution.spec.ts` (explicit target) | 20 passed, credential scan clean |
| `packages/app`: `bun run typecheck:e2e` | 3 pre-existing errors (below), none in `e2e/superpowers/**` |
| `packages/app`: `bun run build` | exit 0 |
| `packages/desktop`: `bun run typecheck` | exit 0 |
| `packages/desktop`: `bun run build` | exit 0 |
| `packages/desktop`: `bun run test` | 187 pass / 2 skip / 2 fail (Electron root sandbox) |
| repository root: `bun run check` | **FAILED** on `@opencode/posts#typecheck` (pre-existing, below) |
| `git diff --check` | clean |

### 8.1 Component suite failure (release blocker)

`production session owner loads native telemetry for agents` (`component-tests/superpowers.spec.ts:787`)
fails deterministically:

```text
Locator: getByRole('treeitem', { name: /Root controller/ }).getByTestId('execution-agent-usage')
Expected: "$1.50 · 1,750 tokens"
Error: element(s) not found
```

Root cause: commit `765aa01c24` (T19) gated native descendant hydration in
`packages/app/src/superpowers/session-execution.tsx` on
`layout.tabs().active() === SESSION_EXECUTION_TAB`. The `session-execution-agents` component fixture
mounts `SessionExecutionProvider` directly with `liveSession.layout.tabs()` fixed to
`{ active: "review" }`, so hydration never runs and no native usage telemetry is produced. The
fixture does not model the tab being active; in production the Agents view is only reachable while
the Execution tab is active.

Reproduced by counterfactual: with `packages/app/src/superpowers/session-execution.tsx` restored to
the T17 commit `943af10f7a`, the same single story passes (`1 passed (2.4m)`); with the current HEAD
version it fails. The branch file was restored unchanged after the check.

This task did not modify any `packages/app` file. It is recorded as an open blocker for the
controller to adjudicate (fixture vs. production gating), not fixed here because T20's file list
does not include app component fixtures.

### 8.2 Pre-existing failures

```text
packages/app typecheck:e2e (pre-existing, unrelated):
e2e/performance/terminals/probe.ts(54,24)
e2e/performance/timeline/session-timeline-stream-probe.ts(139,32)
e2e/regression/session-queue.spec.ts(78,46)

root bun run check:
@opencode/posts#typecheck: [GenerateContentTypesError] ... Tsconfig not found @tsconfig/bun/tsconfig.json
Tasks: 28 successful, 36 total   Failed: @opencode/posts#typecheck
turbo exited with code 1
```

Both are recorded, not called passing. `packages/app` and `packages/superpowers-execution`
typechecks exit 0.

## 9. Audit

- **Generated clients / Core / Protocol / Server / Schema**: no changes on the branch
  (`git diff --name-only v2..HEAD` shows only `packages/app`, `packages/storybook` mocks,
  `packages/superpowers-execution`, `docs/`, `bun.lock`).
- **New code comments (R-F3)**: none added; the new build/smoke scripts carry no comments.
- **Secrets**: no credential in source, docs, or artifacts. The host gate generates a per-run
  password in memory only; dedicated XDG dirs are under `/tmp` and are never the user's service.
- **Unrelated dependency upgrades**: none. The only dependency change is adding the already-cataloged
  `@playwright/test` (1.59.1) as a devDependency of the companion package so its browser smoke can
  run; `bun.lock` gained one line.
- **Production-service commands**: none. No push, publish, merge, service restart, or installer.
- **License notices**: the repository MIT `LICENSE` is preserved and copied into the staged package.
- **Installer/updater**: no private signed installer, branding, or auto-update channel is delivered.

## 10. Install and rollback summary

Installation and rollback are documented separately in
`packages/superpowers-execution/README.md` and
`docs/superpowers/verification/execution-ui/feature-guide.md`:

- The frontend feature is already in the fork; observer mode needs no companion.
- The companion is a single `plugins` entry merged into the existing server config, pointing at the
  built local package directory (`packages/superpowers-execution` after `bun run build`). Nothing is
  added to the user's config automatically.
- Rollback removes that one entry (or the copied directory); native sessions are untouched and
  ledger data is retained unless separately deleted. The UI returns to observer mode.
