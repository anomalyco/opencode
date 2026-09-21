# Execution UI Integration Verification (T18)

Task: T18 Exercise real bridge lifecycle and recovery end to end.
Spec coverage: AC06, AC07, AC08, AC11 (plugin/bridge/host integration). **T18 claims no AC19 coverage.**
AC19's "built companion package loads outside the monorepo on the tested host" is UNRUN here and deferred to
T20, which owns packaging and the real-host package-load gate; AC20 (Windows Desktop smoke) is likewise T20's.
The stand-in host below checks lifecycle behavior at the plugin/bridge/app integration boundary only and is
not AC19 evidence.
Branch: `execution-ui`. Host: Ubuntu 24.04.2 LTS, Bun 1.4.2, Playwright Chromium.

## 1. What was built, and what the host is not

| File | Purpose |
|---|---|
| `packages/app/e2e/superpowers/execution-target.ts` | Shared strict disposable-target parser used by both `playwright.config.ts` and the fixtures. |
| `packages/app/e2e/superpowers/credential-reporter.ts` | Post-run `onEnd` scan of retained `test-results`/`playwright-report` artifacts for the password and its encoded form. |
| `packages/app/e2e/superpowers/execution-fixtures.ts` | `requireExplicitTestTarget` + `createExecutionTestHarness` (nonce-verified manifest, owned child-process handle, controls, page helpers). |
| `packages/app/e2e/superpowers/disposable-host.ts` | The disposable stand-in host: real `@bearmanser/opencode-superpowers-execution` plugin **source** setup over HTTP RPC, file-backed storage, SSE invalidations, synthetic native sessions, test-only controls. |
| `packages/app/e2e/superpowers/native-host-fixtures.json` | Sanitized native API responses captured from a **real** disposable OpenCode 2.0.11 server. |
| `packages/app/e2e/superpowers/execution.spec.ts` | Guard tests plus 17 lifecycle/durability/scope/security cases. |
| `packages/app/playwright.config.ts` | Parses `EXECUTION_E2E_TARGET` with the shared parser (throws before applying host/port) and points the app under test at that loopback target. |

**The disposable host is a stand-in, not the built companion package and not AC19 evidence.** It imports the
plugin entrypoint from source (`@bearmanser/opencode-superpowers-execution/plugin` → `src/plugin.ts`) and
therefore does not exercise `index.js` → `dist/plugin.js`, package staging, or a real OpenCode server
plugin-loader. Those are T20's explicit gates. The stand-in is used to drive the real bridge, the real app,
and the real plugin repository/reducer over real HTTP.

## 2. Safety guards (spec §12)

`parseExecutionTarget(raw)` (shared by the config and the fixtures):

- Missing/empty/whitespace `EXECUTION_E2E_TARGET` returns `undefined`; the suite is then UNRUN (skipped) per test.
- Requires `"disposable": true`; otherwise throws.
- Requires an absolute directory under `os.tmpdir()`, refusing the filesystem root, `$HOME`, the repo cwd and its parent.
- Requires an explicit integer port in 1024-65535; refuses the managed service port `4096` and the app dev port `3000`.
- Requires a loopback host; refuses non-loopback.
- Generates a disposable Basic-auth password when none is supplied.
- `playwright.config.ts` calls the parser at load time, so an invalid target throws before any host/port override is applied.

The harness spawns its own child process with a random startup nonce. Readiness accepts a health response only
when `{ ok, pid, nonce, pluginLoaded }` matches the spawned child; a response from another process, an early
child exit, or a port occupied by another service fails immediately with the conflicting pid. The harness never
runs service discovery, never stops/restarts the user's service, and removes only its own `mkdtemp` directory.

## 3. Credential handling (spec §12)

Authentication is injected as a request header on the browser context
(`context.setExtraHTTPHeaders({ authorization })`); no `?auth_token=` or other credential appears in any
navigation URL. The password is generated per run, cached in `EXECUTION_E2E_PASSWORD` so the config, the
worker, and the reporter agree, and passed to the child by environment only.

Two layers cover the credential:

- In-test assertions (no artifact scanning): every request URL and the page URL are checked against the
  plaintext password and its `opencode:<password>` base64 form, the child log is checked, and a page
  screenshot is attached so this run retains a real artifact for the post-run scan.
- Post-run: `e2e/superpowers/credential-reporter.ts` runs in `onEnd`, after Playwright finalizes the run's
  artifacts and the HTML report, and recursively scans `e2e/test-results` and `e2e/playwright-report` for the
  plaintext password and its encoded form, throwing (failing the run) on any hit and failing if it found no
  retained artifact to verify.

The execution suite sets `trace: "off"` and is not run with retries, so no interactive trace is retained for
authenticated requests: a Playwright trace records request headers verbatim, including the `Authorization`
header, and must therefore not be retained for an authenticated session. Removing the credential from the URL
is what makes the retained video/screenshot/report artifacts credential-free.

## 4. Real disposable OpenCode host — recorded UNRUN (deferred to T20)

A genuine attempt was made to run the real server with the companion configured:

```text
$ mkdir -p /tmp/opencode/t18-real/config3/opencode
$ cat /tmp/opencode/t18-real/config3/opencode/opencode.json
{ "plugins": ["/root/git/opencode/.worktrees/execution-ui/packages/superpowers-execution"] }
$ cd /root/git/opencode/.worktrees/execution-ui
$ XDG_DATA_HOME=/tmp/opencode/t18-real/data3 XDG_CONFIG_HOME=/tmp/opencode/t18-real/config3 \
  XDG_CACHE_HOME=/tmp/opencode/t18-real/cache3 XDG_STATE_HOME=/tmp/opencode/t18-real/state3 \
  OPENCODE_PASSWORD=<disposable> bun run dev serve --port 4611 --hostname 127.0.0.1
server listening on http://127.0.0.1:4611

$ curl -u opencode:<disposable> -X POST http://127.0.0.1:4611/api/rpc/superpowers.execution.v1/capabilities \
    -H 'content-type: application/json' -d '{"input":{}}'
{"_tag":"RpcError","type":"rpc.unavailable","message":"RPC is unavailable: superpowers.execution.v1"}
```

Server log (`/tmp/opencode/t18-real/data3/opencode/log/opencode-local.log`):

```text
msg="loading plugin" id=.../packages/superpowers-execution entrypoint=file:///.../packages/superpowers-execution/index.js
level=WARN message="failed to load plugin" target=.../packages/superpowers-execution
  cause="Cause([Die(ResolveMessage: Cannot find module './dist/plugin.js' imported from .../packages/superpowers-execution/index.js)])"
```

The server starts and serves the native API, but the companion cannot load because the built
`dist/plugin.js` does not exist yet. Building and staging the package is exactly T20's packaging gate, so this
lifecycle/native-integration gate is recorded **UNRUN** here and deferred to T20 rather than worked around.

## 5. Real native API capture (feasible, captured)

Because the real server's native API works without the companion, native responses were captured from it and
sanitized into `native-host-fixtures.json`:

```text
$ curl -u opencode:<disposable> -X POST http://127.0.0.1:4611/api/session \
    -H 'content-type: application/json' -d '{"id":"ses_exec_root","title":"Execution root"}'
$ curl -u opencode:<disposable> http://127.0.0.1:4611/api/session/ses_exec_root
$ curl -u opencode:<disposable> http://127.0.0.1:4611/api/session
$ curl -u opencode:<disposable> http://127.0.0.1:4611/api/session/active
$ curl -u opencode:<disposable> http://127.0.0.1:4611/api/session/ses_exec_root/form
$ curl -u opencode:<disposable> http://127.0.0.1:4611/api/session/ses_exec_root/inbox
```

The recorded shapes (directories → `<owner>`/`<worktree>`, project ids and cursors masked, timestamps fixed)
include the fields T01's adapter reads: session `id`/`title`/`time`/`location.directory`, a `data` array plus
`cursor` for lists, a status map for `active`, and arrays for `form`/`inbox`. The suite asserts the recorded
contract and the stand-in host responses against the same field checks, so the stand-in stays a faithful
substitute for the fields the adapter consumes.

## 6. Coverage

| Requirement | Case |
|---|---|
| Representative: durable run + host restart + missed invalidation | `durable run survives isolated host restart and missed invalidation` |
| Real storage round-trip / RPC reads | `durable storage round-trips a run through a host restart` |
| Lost invalidation recovery | `a lost invalidation is recovered when the execution view becomes visible again` |
| Duplicate reporting / idempotency | `reporting the same operation twice is idempotent and does not advance the revision` |
| Forced network interruption keeps last snapshot | `a forced network interruption keeps the last snapshot instead of zeroing progress` |
| Schema mismatch is distinct | `an incompatible schema stays distinct and is not retried as an absent run` |
| Malformed reports | `malformed reports are rejected without changing durable state` |
| Two independent hosts, storage/RPC isolation | `two independent hosts with identical identities never share state` |
| App-level server switch with identical identities | `switching to an identical-identity server does not leak the primary run` |
| Cross-worktree children | `a child in another worktree is accepted while the owner location is unchanged` |
| Root location change pauses tracking (app + copy) | `a root location change pauses tracking through the app and retains the reported run` |
| Terminal runs | `a cancelled run stays terminal and never reports completion` |
| Plugin unload/reload | `unloading and reloading the plugin returns to observer mode and recovers the stored run` |
| Native child-session navigation | `a child session navigates on the same server and keeps the root run association` |
| No credentials in URLs/artifacts/logs | `no captured request URL or retained artifact contains the disposable credential` |
| Reference-session ancestry rejection | `a report referencing a session outside the run is refused` |
| Sanitized native fixtures / T01 mapping | `recorded native host fixtures expose the adapter contract the stand-in also serves` |
| Guard rejection of implicit production target | `disposable execution target guards` (3 cases) |

The location-change pause is additionally locked by a bridge unit test
(`a same-root owner location change pauses tracking and retains the snapshot`) in
`packages/app/src/superpowers/bridge-client.test.ts`.

## 7. Gates (actual outcomes)

```text
$ cd packages/app && EXECUTION_E2E_TARGET='{"disposable":true,"directory":"/tmp/opencode/execution-e2e","port":4601}' \
    bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
  execution credential artifact scan: clean (2 files)
  20 passed (56.4s)
```

```text
$ cd packages/app && env -u EXECUTION_E2E_TARGET bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
  17 skipped  3 passed
```

```text
$ cd packages/app && bun run typecheck        # tsgo -b
exit 0

$ cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
 179 pass / 0 fail

$ cd packages/app && bun run test:unit
 1040 pass / 1 skip / 0 fail

$ cd packages/app && bun run typecheck:e2e    # tsgo -p e2e/tsconfig.json
e2e/performance/terminals/probe.ts(54,24): error TS2345 ...
e2e/performance/timeline/session-timeline-stream-probe.ts(139,32): error TS2345 ...
e2e/regression/session-queue.spec.ts(78,46): error TS2322 ...

$ bun x oxlint <changed files>
Found 0 warnings and 0 errors.
```

The three `typecheck:e2e` errors are pre-existing: re-running with this task's files moved aside and
`playwright.config.ts` stashed produces the identical three errors, none in `e2e/superpowers/**`.

## 8. Environment notes / unrun items

- The stand-in host is not the built companion package and not a real OpenCode server plugin load; AC19's
  outside-monorepo package gate is UNRUN here (exact evidence in §4) and deferred to T20.
- The plugin lifecycle was verified against the plugin source, real HTTP transport, real file storage, and the
  real app bridge/UI; the real server process, when started, serves the native API and rejects the
  unbuilt companion exactly as recorded.
- Windows Desktop smoke (AC20) is unrun and remains T20.

## 9. Files changed

- `packages/app/e2e/superpowers/execution.spec.ts`
- `packages/app/e2e/superpowers/execution-fixtures.ts`
- `packages/app/e2e/superpowers/execution-target.ts`
- `packages/app/e2e/superpowers/credential-reporter.ts`
- `packages/app/e2e/superpowers/disposable-host.ts`
- `packages/app/e2e/superpowers/native-host-fixtures.json`
- `packages/app/playwright.config.ts`
- `packages/app/src/superpowers/bridge-client.ts`, `model.ts`, `panel.tsx`, `bridge-client.test.ts`
- `packages/app/src/session/screen.tsx`
- `packages/app/src/runtime/i18n/en.ts`
- `docs/superpowers/verification/execution-ui/integration.md`

No code comments were added (R-F3). No `any`. Core, Protocol, HttpApi and generated clients were not touched.
