# T02 Verification: Recursive native agent adapter

Task: T02 Build the recursive native agent adapter.
Worktree: `/root/git/opencode/.worktrees/execution-ui`
Branch: `execution-ui`
Base: `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11), after T01 `eddf5519f7`.
Recorded: 2026-09-20

## Files

Created (only these staged):

- `packages/app/src/superpowers/agent-tree.ts`
- `packages/app/src/superpowers/native-adapter.ts`
- `packages/app/src/superpowers/agent-tree.test.ts`
- `packages/app/src/superpowers/native-adapter.test.ts`
- `packages/app/src/superpowers/fixtures.ts`
- `docs/superpowers/verification/execution-ui/task-2.md`

Referenced without changing behavior: `session/requests/session-request-tree.ts` (BFS
descendant traversal shape), `session/requests/model.ts`, `runtime/server/current.tsx`,
`runtime/server/registry.tsx` (`ServerConnection.key`), `shell/routes/session.ts` (`sessionHref`).

No Core, native Protocol/HttpApi, or generated client file changed. No new code comments added.

## Interfaces produced

- `projectAgentTree(selectedSessionID, sessions)` -> `{ rootSessionID?, nodes, complete, missingParentID? }`.
- `nativeState(record)` -> `"needs_input" | "error" | "running" | "idle" | "unknown"` (plan anchor).
- `nativeRecord(info, status, needsInput)`.
- `createNativeBoundary({ api })` mapping T01's verified calls to a `NativeBoundary`.
- `createNativeExecutionAdapter({ target, boundary, signal })` with `snapshot()`, `hydrate()`,
  `openSession(id)`, `dispose()`.
- `nativeFixture()` with ordered ids `["root", "child", "idle-child", "grandchild"]`.

## Native calls and paging

`createNativeBoundary` maps only T01's generated V2 endpoints:

- Detail: `api.session.get({ sessionID }, { signal })` (complete), plus
  `api.permission.list({ sessionID }, { signal })` and
  `api.session.form.list({ sessionID }, { signal })` for attention. Attention is a non-empty
  permission list or a form whose `metadata.kind` is `"question"` or `"websearch.provider"`
  (same predicate as `sessionFormRequest`).
- Descendant page: `api.session.list({ parentID, order: "desc", cursor }, { signal })`, following
  `response.cursor.next` until exhausted. This is the T01 finding: the stock store adapter's
  `session.sync(id, { children: true })` reads one page and does not follow the cursor.
- Running snapshot: `api.session.active({ signal })`.

Adapter behavior:

1. Walk `parentID` upward with a visited set; fetch each unknown ancestor (bounded by that set).
   A failed/unknown lookup marks the tree incomplete with `missingParentID` and never treats the
   selected child as a root.
2. Breadth-first descendant enumeration from the resolved root, paging every child page.
3. Deduplicate detail requests by session ID and cap concurrent native requests at four
   (shared semaphore over detail, child pages, and the active snapshot).
4. Preserve provisional records from a child page as `status: "unknown"` placeholders while their
   detail loads; a failed detail keeps an `error` placeholder.
5. `status` is `"running"` only when `session.active()` lists the id, `"idle"` after a successful
   hydration otherwise, and `"unknown"` while un-hydrated. Idle is not completion; `complete`
   requires all reachable records hydrated, error-free, and no unknown status.
6. Scope identity is the tuple `(serverKey, ownerDirectory, selectedSessionID)`. A target change
   bumps a generation, clears cached records, and discards late responses; `dispose()` aborts.
7. `openSession(id)` returns `sessionHref(ServerConnection.key, id)` so navigation stays on the
   selected server.

## TDD evidence

RED (before implementation), command from the brief:

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/agent-tree.test.ts ./src/superpowers/native-adapter.test.ts
error: Cannot find module './agent-tree' from '.../src/superpowers/agent-tree.test.ts'
error: Cannot find module './native-adapter' from '.../src/superpowers/native-adapter.test.ts'
 0 pass
 2 fail
 2 errors
Ran 2 tests across 2 files.
```

GREEN (after implementation), same command:

```text
src/superpowers/agent-tree.test.ts:
(pass) a grandchild resolves to its real root and idle is not completion
(pass) an unknown ancestor is incomplete and is not treated as the selected child's root
(pass) a deleted child stays as an unknown placeholder and keeps the tree partial
(pass) malformed cyclic parent data terminates and stays incomplete
(pass) a selected session absent from the records is incomplete
(pass) a root with no children is complete
(pass) an unreachable record keeps the projection incomplete
src/superpowers/native-adapter.test.ts:
(pass) a grandchild hydrates its real root and keeps idle distinct from completion
(pass) every child page is enumerated instead of only the first
(pass) a running child absent from background tasks is still enumerated
(pass) a root with no children is complete
(pass) identical session IDs on another server do not leak across a scope change
(pass) aborting during a scope switch discards late responses
(pass) a child worktree directory never replaces the owner directory
(pass) a descendant is preserved as an unknown placeholder while its detail loads
(pass) an inaccessible child becomes an error placeholder instead of disappearing
(pass) malformed cyclic ancestry terminates without fetching forever
(pass) dispose stops applying late responses
(pass) detail requests are deduplicated across hydrations
(pass) detail hydration never exceeds four concurrent requests
(pass) openSession targets the selected server's native route
(pass) native state distinguishes needs input, error, running, idle, and unknown
(pass) the native boundary follows the session list cursor
(pass) attention comes only from permissions and question forms

 24 pass
 0 fail
 76 expect() calls
Ran 24 tests across 2 files.
```

The concurrency case asserts `max <= 4` and `max === 4` (six children), so the cap is exercised,
not merely satisfied by serial execution.

## Focused verification

| Command | Result |
|---|---|
| `bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/agent-tree.test.ts ./src/superpowers/native-adapter.test.ts` | PASS: 24 pass, 0 fail, 76 expect() calls |
| `bun test --conditions=solid --preload ./happydom.ts ./src/superpowers` | PASS: 29 pass, 0 fail, 92 expect() calls (includes T01 identity tests) |
| `bun run typecheck` (`tsgo -b`) | PASS (exit 0) |
| `bun run test:unit` | PASS: 890 pass, 1 skip, 0 fail, 131 files, 5.05s |
| `bun run lint` (oxlint, repo root) | PASS: 0 warnings, 0 errors, 4189 files |

The `test:unit` log contains expected negative-path `read ECONNRESET` output from existing
fixtures (documented in `baseline.md`); the run reports 0 failures.

## Unrun gates

| Gate | Exact command | Outcome |
|---|---|---|
| Root canonical `bun run check` | `bun run check` (repo root) | UNRUN for this task. Not required by the T02 brief; its constituents were run directly (`bun run lint` at root and `bun run typecheck` in `packages/app`). |
| Component/Playwright UI gates | `bun run test:components ...` | UNRUN. No T02 component surface exists; first needed in T03/T04. |
| Windows Desktop smoke | (Windows host required) | UNRUN; no Windows host. |

No threshold was changed and no result was fabricated.

## Self-review

- Diff is additive only; no existing production file modified.
- No new comments (`grep -nE "^\s*//|/\*"` on the new files returns none).
- No `any` type; the only `any` hit is the `AbortSignal.any` runtime API.
- Enumerates descendants via parent pages, independent of the client-side background summary that
  omits blocking/foreground children.
- Child worktree directories never replace the owner directory in the snapshot.
- Scope generation discards stale responses and dispose aborts in-flight work.
- Test fakes are injected boundaries; projections under test are the production functions
  (`projectAgentTree`, `nativeState`, adapter `hydrate`/`snapshot`, `createNativeBoundary`), not
  duplicated traversal in the tests.

## Concerns

- `session-request-tree.ts` was not modified (per the task file list), so the breadth-first
  traversal is mirrored in `agent-tree.ts` rather than imported. If the shared helper later gains a
  structural parameter, T02's traversal can be collapsed onto it.
- `complete` is false while any reachable record is `unknown`; consumers that want a "loading"
  distinction can read node status directly.
