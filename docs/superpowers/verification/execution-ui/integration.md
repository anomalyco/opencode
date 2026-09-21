# Execution UI Integration Verification (T18)

Task: T18 Exercise real bridge lifecycle and recovery end to end.
Spec coverage: AC06, AC07, AC08, AC11, AC19 (spec §9, §9.3, §12, §13, §14).
Branch: `execution-ui`. Host: Ubuntu 24.04.2 LTS, Bun 1.4.2, Playwright Chromium.

## 1. What was built

| File | Purpose |
|---|---|
| `packages/app/e2e/superpowers/execution-fixtures.ts` | Explicit disposable-target validation and `createExecutionTestHarness` (manifest + child-process handle + report/read/restart/plugin controls + page helpers). |
| `packages/app/e2e/superpowers/disposable-host.ts` | The disposable host process: real `@bearmanser/opencode-superpowers-execution` plugin setup over HTTP RPC, file-backed storage, SSE invalidations, synthetic native session API, and test-only controls. |
| `packages/app/e2e/superpowers/execution.spec.ts` | Guard tests plus 15 lifecycle/durability/scope/security cases. |
| `packages/app/e2e/superpowers/native-fixtures.json` | Sanitized native API responses captured from the running host, so T01's adapter mapping is checkable. |
| `packages/app/playwright.config.ts` | When `EXECUTION_E2E_TARGET` is set, the app under test targets that target's loopback host/port instead of the default local server. |

The host runs the real plugin entrypoint (`executionPlugin.setup`) with real reporting tools, the real
repository/reducer, and real RPC handlers, so reporting, idempotency, revision checks, ancestry validation
and storage round-trips are exercised as shipped. Native session data is synthetic (no paid model calls);
reports are produced by direct captured-tool invocation inside the isolated host.

## 2. Safety guards (spec §12)

`requireExplicitTestTarget(raw)`:

- Missing/empty/whitespace `EXECUTION_E2E_TARGET` returns `undefined`; the suite is then UNRUN (skipped) per test, never pointed at a discovered service.
- Requires `"disposable": true`; otherwise it throws `Execution E2E requires an explicitly disposable target`.
- Requires an absolute directory under `os.tmpdir()`, and refuses the filesystem root, `$HOME`, the repository cwd and its parent.
- Requires an explicit integer port in 1024-65535 and refuses the managed service port `4096` and the app dev port `3000`; there is no implicit default.
- Requires a loopback host (`127.0.0.1`/`localhost`); a non-loopback host is refused.
- Generates a disposable Basic-auth password when the target does not supply one. The password is passed to the host by environment only; it is never written to source, URLs, the manifest, or logs (asserted by a test).

The harness only ever creates and talks to the child process it spawned on the target port. It never runs
service discovery, never stops or restarts the user's managed service, and removes only its own
`mkdtemp` directory (under the target temp directory) on stop. `EXECUTION_E2E_KEEP=1` retains artifacts.

Manifest: `{ disposable, executable, script, host, port, serverURL, pid, process (child handle), directories { root, owner, worktree, data, logs } }`.

## 3. Coverage

| Requirement | Case |
|---|---|
| Representative: durable run + host restart + missed invalidation | `durable run survives isolated host restart and missed invalidation` |
| Real storage round-trip / RPC reads | `durable storage round-trips a run through a host restart` |
| Lost invalidation recovery | `a lost invalidation is recovered when the execution view becomes visible again` |
| Duplicate reporting / idempotency | `reporting the same operation twice is idempotent and does not advance the revision` |
| Forced network interruption keeps last snapshot | `a forced network interruption keeps the last snapshot instead of zeroing progress` |
| Schema mismatch is distinct | `an incompatible schema stays distinct and is not retried as an absent run` |
| Malformed reports | `malformed reports are rejected without changing durable state` |
| Second independent server, identical IDs | `two independent hosts with identical identities never share state` |
| Cross-worktree children | `a child in another worktree is accepted while the owner location is unchanged` |
| Root location migration | `a root whose recorded location changed is refused and keeps the stored run` |
| Terminal runs | `a cancelled run stays terminal and never reports completion` |
| Plugin unload/reload | `unloading and reloading the plugin returns to observer mode and recovers the stored run` |
| No credentials in logs/URLs | `host logs and page URLs never contain the disposable credential` |
| Reference-session ancestry rejection | `a report referencing a session outside the run is refused` |
| Sanitized native fixtures / T01 mapping | `sanitized native fixtures match the host's actual API responses` |
| Guard rejection of implicit production target | `disposable execution target guards` (3 cases) |

`native-fixtures.json` records `session`, `sessionList` (by `parentID`), `active`, `form` and `inbox`
responses with owner/worktree directories replaced by `<owner>`/`<worktree>`. The test normalizes the live
host directories and deep-equals the recorded shapes, so a change to the pinned native session contract
fails here. `time.updated` fixtures are deterministic functions of the fixed synthetic session IDs.

## 4. Gates (actual outcomes)

RED before implementation (fixtures absent):

```text
$ cd packages/app && bun run test:e2e e2e/superpowers/execution.spec.ts
Error: Cannot find module '.../packages/app/e2e/superpowers/execution-fixtures'
Error: No tests found.
error: script "test:e2e" exited with code 1
```

GREEN with an explicitly supplied disposable target (loopback port, owned temp directory):

```text
$ cd packages/app && EXECUTION_E2E_TARGET='{"disposable":true,"directory":"/tmp/opencode/execution-e2e","port":4601}' \
    bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
  18 passed (2.8m)
```

UNRUN form without a target (the brief's literal command), recorded honestly — the lifecycle cases are
skipped with a reason; only the target guards run:

```text
$ cd packages/app && env -u EXECUTION_E2E_TARGET bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
  15 skipped
  3 passed (2.3s)
```

Typechecks:

```text
$ cd packages/app && bun run typecheck       # tsgo -b
exit 0

$ cd packages/app && bun run typecheck:e2e   # tsgo -p e2e/tsconfig.json
e2e/performance/terminals/probe.ts(54,24): error TS2345 ...
e2e/performance/timeline/session-timeline-stream-probe.ts(139,32): error TS2345 ...
e2e/regression/session-queue.spec.ts(78,46): error TS2322 ...
```

The three `typecheck:e2e` errors are pre-existing: re-running the command with this task's new files moved
aside and `playwright.config.ts` stashed produces the identical three errors, none in
`e2e/superpowers/**`.

Lint: `bun x oxlint packages/app/e2e/superpowers packages/app/playwright.config.ts` → `Found 0 warnings and 0 errors.`

## 5. Environment notes / unrun items

- The target above was supplied by the executor for verification. The harness refuses non-temp directories,
  ports `4096`/`3000`, and non-loopback hosts, so this does not touch the user's managed service even if a
  target is misconfigured. No service-discovery command is executed by the suite.
- The disposable host emulates the plugin host surface (RPC transport, storage port, session lookup) but is
  not the full OpenCode server. Loading the packaged companion directory into a real OpenCode server
  process, and the Windows Desktop smoke, remain T20 gates.
- The root-location migration case asserts the plugin's refusal and that the stored run is retained; the
  spec §7.1 "tracking paused by location change" UI wording is not implemented in this fork and is not
  claimed here.
- The brief's illustrative `execution.connection()` text ("Connected") is adapted to the shipped UI: the
  panel's `data-mode` (`ready`/`stale`/`incompatible`/`observer`/`unavailable`) and the status badge are
  the observable connection states; the product has no literal "Connected" copy (its tooltip reads
  "Connection: live"). The invariant (reconnected and showing a current snapshot) is unchanged.

## 6. Files changed

- `packages/app/e2e/superpowers/execution.spec.ts` (new)
- `packages/app/e2e/superpowers/execution-fixtures.ts` (new)
- `packages/app/e2e/superpowers/disposable-host.ts` (new)
- `packages/app/e2e/superpowers/native-fixtures.json` (new)
- `packages/app/playwright.config.ts` (disposable-target host/port override)
- `docs/superpowers/verification/execution-ui/integration.md` (this record)

No code comments were added (R-F3). No `any`. Core, Protocol, HttpApi and generated clients were not touched.
