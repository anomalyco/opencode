# FIX-REPORT — `session-diff-events` carve-out

> **HISTORICAL — this document does NOT describe current HEAD.** It was written for a
> pre-base round (commits `2eb15ce`/`dbcb903`/`3a39667`/`eb8746e`, all ancestors of the
> current base `857ce25bb8`). Claims below such as "No server, schema, core, TUI, or SDK
> file was modified" and the `opencode 3596 pass` gate apply **only** to that earlier
> App-only carve-out. The current branch changes server, schema, core, TUI, and SDK across
> the wave commits, so this file must not be read as a statement about the current tree.

This round stops adding route seven. It **removes** the App sync-lifetime rework that the seven prior
rounds kept patching, and ships the validated server fix with only a narrow App event-consumption
change. It is a net deletion: the App owner file and its test file shrink.

All work is confined to `packages/app/src/context/server-session.ts` and
`packages/app/src/context/server-session.test.ts`. The server-side feature (validated and frozen) is
untouched: `summarize` content-aware dedup, `message.diff.updated.1`, the `message_diff` store and
hydration, the FK cascades, the guarded O(1) migration, and the bounded-and-evicting cache are
byte-identical to the prior tree.

## Commits

```text
2eb15ce test(app): pin parent request-start and sibling retirement boundaries
dbcb903 refactor(app): restore base coalescing in the session diff owner
```

`dbcb903` contains the production carve-out and the deletion of the tests that only covered the
removed machinery; `2eb15ce` adds the missing section-4/5 coverage. Appended history only; no
rebase/reset/amend/stash/branch checkout. `FIX-REPORT.md` is intentionally untracked.

## Why (so route eight is not recreated)

The defect "a forced refresh can resolve without actually fetching a fresh page" was found and fixed
seven times by seven distinct routes. The root cause is that the client kept six partial descriptions
of "work is running" — `inflight`, `messageWork`, `messageLoads`, `meta.loading`, `queuedRefreshes`
and `generations` — and none owned admission, execution, completion and invalidation together. `sync`
observed a competitor instead of acquiring the right to run next, and `performMessageLoad` returned
the same successful `Promise<void>` for "fetched and applied" as for "did nothing because busy",
making a false freshness claim expressible everywhere. The base branch already had the observation
weakness; the write-amplification feature added an eager recovery path that depended on a stronger
contract. Correcting that requires a generation-owned coordinator with a monotonic freshness barrier
— a separate 3+ day PR. It must not block the database fix, so this round carves the rework out.

## What was removed (restoring base `dev`)

- `queuedRefreshes` and all queued-refresh continuation logic.
- `messageWork` and its registering `loadMessages` wrapper.
- The competing-load wait (`const competing = messageWork.get(sessionID); await competing`).
- The forced-refresh coalescing and settlement redesign, including the `Promise.allSettled` barrier.
- The fallback `sync(sessionID, { force: true })` in `message.diff.updated`. It is removed outright,
  not deferred behind a timer, microtask, or fire-and-forget queue.

`sync` is now byte-identical to `dev`; verified by extracting the function from both trees:

```text
$ git show dev:packages/app/src/context/server-session.ts | sed -n '/^  const sync = /,/^  }$/p' > base.txt
$ sed -n '/^  const sync = /,/^  }$/p' packages/app/src/context/server-session.ts > cur.txt
$ diff base.txt cur.txt && echo SYNC IDENTICAL TO BASE dev
SYNC IDENTICAL TO BASE dev
```

Diff size against `dev` shrank from **134 added / 19 removed** to **75 added / 7 removed** production
lines (`git diff dev --numstat` → `75 7`).

## What was kept (the feature)

- Dedicated `message.diff.updated` handling in the authoritative session store.
- Live updates to cached user-message diffs, preserved through in-flight reconciliation.
- Protection of diffs against already-running HTTP snapshots (request-lifetime buffer + overlay).
- Retry and parent-request freshness boundaries.
- Full-message replacement, removal and teardown cleanup.
- The narrow buffer lifecycle: `applyMessagePage` overlay, page-retry retirement
  (`beginPageAttempt`), parent-specific request-start retirement (`beginParentAttempt`),
  authoritative full-message retirement (`message.updated` / `message.removed`), and generation-safe
  cleanup of `pendingDiffs`.
- `beginParentAttempt` keeps exactly: **before the parent request → superseded; during the parent
  request → preserved.**

## The exact contract for `message.diff.updated`

- Cached user message → update its diffs immediately and preserve them through existing in-flight
  reconciliation.
- Uncached while a message load is active → retain in the existing request-lifetime buffer and
  overlay if that load materializes the message.
- **Uncached with NO active load → do nothing. Do not start message work.**
- Removed message → ignore. Do not resurrect the parent.

### Accepted user-visible consequence (deliberate)

A diff-only event for an **absent turn no longer eagerly discovers that turn**. The turn appears
with its hydrated diffs on the next actual fetch that includes it, such as history pagination; merely
navigating back may not fetch. This is a deliberate, limited reduction in recovery behavior, **not**
loss of persisted diff data — the server store, hydration and event remain intact. The new test
`ignores an uncached diff when no message load is active` pins both halves: the event starts no
request, and a subsequent `sync` materializes the turn with its persisted diff. This trade is taken
because the eager recovery path is exactly where route eight would reappear.

## v9 finding disposition

| Finding | Sev | Disposition | Evidence |
| --- | --- | --- | --- |
| **astra F1** in-flight parent diff must win the snapshot and survive a sibling fetch | MAJOR | **Kept; coverage added.** The per-identity `beginParentAttempt` boundary survives the carve-out. Added `preserves a diff delivered during a parent request over its older response` (during → preserved) and `retires only the fetched parent's pre-request buffer and preserves siblings` (identity-selective; page buffer survives). | Axes 10–11; AX11 kills F/I/J plus the new sibling test. |
| **astra F2** a dequeued refresh waiting for history can start new message work AFTER session deletion | MAJOR | **Removed with the machinery.** `queuedRefreshes` and its continuation are gone; a diff event can no longer start message work, so nothing can be dequeued after teardown. | `grep -nE 'queuedRefreshes\|messageWork\|competing' server-session.ts` → no matches; `sync` byte-identical to base. |
| **astra F3** rejected competing history bypasses the settlement barrier and abandons the already-started info request | MAJOR | **Removed with the machinery.** The `await competing` / `Promise.allSettled` barrier no longer exists; base `sync` awaits `Promise.all([resolve, loadMessages])`, so info and page settle together with no barrier to bypass. | same grep; base `sync` diff. |
| **astra F4** registry cleanup ownership (identity check at `:891-892`) | NIT/coverage | **Removed with the machinery.** The `messageWork.get(sessionID) === run` identity check lived in the deleted `loadMessages` wrapper. The consultant confirmed it was present and correct; there is nothing left to own, and its tests were deleted with the wrapper. | grep shows no `messageWork`; deleted tests list below. |
| **astra F5** parent retirement boundary | NIT/coverage | **Kept; missing coverage added.** This was an undetected mutation, not broken handling. Added the two parent-boundary tests above; AX10 kills the during-preserved direction and AX11 kills sibling identity. | Axes 10–11. |
| **deepseek F1** registry cleanup ownership (same identity check) | NIT/coverage | **Removed with the machinery.** Same as astra F4: the registration identity check is gone with the wrapper that hosted it. | grep; deleted tests list. |

## Deleted tests (only existed to cover the removed machinery)

11 tests were deleted from `server-session.test.ts`; the owner file went from 96 tests to 86 at
`dbcb903` (88 after the three additions). The App suite dropped from 672 pass to 662 at `dbcb903`.

1. `loads an uncached diff when the message cache is empty` — asserted the eager fallback load.
2. `force-refreshes a cached page when a diff targets an uncached message` — asserted the eager
   fallback refresh.
3. `refreshes messages when a diff arrives while session info is still resolving` — asserted the
   queued `sync(..., { force: true })` continuation.
4. `a second forced caller waits for the queued refresh` — `queuedRefreshes` coalescing.
5. `runs a queued forced refresh when the in-flight sync rejects` — `queuedRefreshes` continuation.
6. `a forced refresh waits for an in-flight message load when session info rejects` — the
   `Promise.allSettled` settlement barrier.
7. `rejects a sync whose session info fails` — pinned the barrier's info rethrow.
8. `rejects a sync whose initial message page fails` — pinned the barrier's page rethrow.
9. `a queued forced refresh waits for an in-flight history load before fetching a fresh page` —
   `messageWork` competing wait + queued refresh.
10. `a skipped prefetch cannot displace an active history load registration` — the wrapper's
    skip guard.
11. `does not start queued work after session teardown` — `queuedRefreshes` teardown guard.

Three tests were added: `ignores an uncached diff when no message load is active`,
`preserves a diff delivered during a parent request over its older response`, and
`retires only the fetched parent's pre-request buffer and preserves siblings`.

## Mutation evidence

Protocol: apply the mutant to the tracked production source, run the focused owner file with the
pinning test(s) **excluded** (Bun `-t` negative lookahead) to show the mutant survives, run the
pinning test(s) to show the mutant is killed, restore the source from a byte-identical backup, and
show the full suite green. Axes 1–9 ran on the 86-test tree (after deletion, before the three
additions); axes 10–11 ran on the final 88-test tree. All commands ran from `packages/app`.

### Axis 1 — cached user diff update (M1: drop the cached branch) — kills A

```text
OUT1 (mutant, A excluded):  85 pass, 1 filtered out, 0 fail, 158 expect
OUT2 (mutant, A only):      Expected "PATCH-CONTENT", Received undefined  -> 1 fail
OUT3 (reverted, full):      86 pass, 0 fail, 160 expect
```

### Axis 2 — uncached buffering (M2: delete the buffer write) — kills B, F, H, I, J, K

```text
OUT1 (mutant, 6 pins excluded): 80 pass, 6 filtered out, 0 fail, 148 expect
OUT2 (mutant, 6 pins only):
  (fail) buffers an uncached diff delivered during the first message load
  (fail) keeps a buffered page diff when an unrelated parent backfill starts
  (fail) an obsolete load retry cannot clear a replacement load's buffered diff
  (fail) retires a failed parent attempt's buffered diff while keeping the page's buffered diff
  (fail) retires a parent's pre-request buffered diff in favor of its first fetch
  (fail) an obsolete parent retry cannot clear a replacement load's buffered diff
  0 pass, 6 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

### Axis 3 — removed-message ignore + no-op contract — kills C, N

Guard removal alone survives (the removal tombstone independently prevents resurrection):
`86 pass, 0 fail`. Two mutants were therefore used.

Route-eight mutant (reintroduce the fallback `sync(..., { force: true })`):

```text
OUT1 (mutant, C+N excluded): 84 pass, 2 filtered out, 0 fail, 156 expect
OUT2 (mutant, C+N only):
  (fail) ignores an uncached diff when no message load is active
  1 pass, 1 fail                     # C still passes because the removed-message guard short-circuits
```

Combined mutant (fallback reintroduced AND removed-message guard deleted):

```text
OUT1 (mutant, C+N excluded): 84 pass, 2 filtered out, 0 fail, 156 expect
OUT2 (mutant, C+N only):
  (fail) ignores a diff for a removed message without requesting a load
  (fail) ignores an uncached diff when no message load is active
  0 pass, 2 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

Disclosed coverage gap: removing only the `removedMessages` guard is not observable in the current
suite, because the removal tombstone already prevents resurrection in every reachable snapshot path.
The guard is retained as defense-in-depth and is load-bearing as soon as any recovery path exists
(the combined mutant above is its kill).

### Axis 4 — page-retry retirement (M4: drop `attempt > 1` delete) — kills D, G

```text
OUT1 (mutant, D+G excluded): 84 pass, 2 filtered out, 0 fail, 158 expect
OUT2 (mutant, D+G only):
  (fail) a successful retry supersedes an older buffered durable diff
  (fail) a third request cannot replay the second attempt's buffered diff
  0 pass, 2 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

### Axis 5 — terminal-load cleanup (M5: drop `pendingDiffs.delete` in `finally`) — kills E

```text
OUT1 (mutant, E excluded): 85 pass, 1 filtered out, 0 fail, 159 expect
OUT2 (mutant, E only): (fail) a fresh sync after a terminal load failure ignores the failed buffer -> 1 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

### Axis 6 — parent request-start retirement (M6: drop the `beginParentAttempt` call) — kills I, J

```text
OUT1 (mutant, I+J excluded): 84 pass, 2 filtered out, 0 fail, 154 expect
OUT2 (mutant, I+J only):
  (fail) retires a failed parent attempt's buffered diff while keeping the page's buffered diff
  (fail) retires a parent's pre-request buffered diff in favor of its first fetch
  0 pass, 2 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

### Axis 7 — parent retire scope (M7: retire the whole session buffer) — kills F, I, J

```text
OUT1 (mutant, F+I+J excluded): 83 pass, 3 filtered out, 0 fail, 152 expect
OUT2 (mutant, F+I+J only):
  (fail) keeps a buffered page diff when an unrelated parent backfill starts
  (fail) retires a failed parent attempt's buffered diff while keeping the page's buffered diff
  (fail) retires a parent's pre-request buffered diff in favor of its first fetch
  0 pass, 3 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

### Axis 8 — page attempt ownership (M8: drop the `messageLoads.get === load` predicate) — kills H

```text
OUT1 (mutant, H excluded): 85 pass, 1 filtered out, 0 fail, 159 expect
OUT2 (mutant, H only): (fail) an obsolete load retry cannot clear a replacement load's buffered diff -> 1 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

### Axis 9 — parent attempt ownership (M9: drop the `messageLoads.get === load` predicate) — kills K

```text
OUT1 (mutant, K excluded): 85 pass, 1 filtered out, 0 fail, 159 expect
OUT2 (mutant, K only): (fail) an obsolete parent retry cannot clear a replacement load's buffered diff -> 1 fail
OUT3 (reverted, full): 86 pass, 0 fail, 160 expect
```

### Axis 10 — during-parent preservation (M10: retire the parent buffer after its response) — kills new test 1

```text
OUT1 (mutant, 2 new tests excluded): 86 pass, 2 filtered out, 0 fail, 160 expect
OUT2 (mutant, during-preserved only):
  (fail) preserves a diff delivered during a parent request over its older response
  0 pass, 1 fail
OUT3 (reverted, full): 88 pass, 0 fail, 164 expect
```

### Axis 11 — sibling identity (M7 on the final tree) — kills new test 2

```text
OUT1 (mutant, F+I+J+new excluded): 84 pass, 4 filtered out, 0 fail, 153 expect
OUT2 (mutant, new sibling test only):
  (fail) retires only the fetched parent's pre-request buffer and preserves siblings
  0 pass, 1 fail
OUT3 (reverted, full): 88 pass, 0 fail, 164 expect
```

Every kept and added test that covers section 4/5 behavior has at least one killing mutant:
A→1; B→2; C→3; N→3; D→4; G→4; E→5; I→6,7; J→6,7; F→2,7; H→2,8; K→2,9; during-preserved→10;
sibling→7,11.

## Defect-death evidence

Both branch defects lived in the removed waiting machinery, so removal eliminates them:

- `grep -nE 'queuedRefreshes|messageWork|performMessageLoad|allSettled|competing' server-session.ts`
  returns no matches.
- `diff` of the extracted `sync` function against `dev` is empty.
- No remaining code path starts a message load from an event: `loadMessages` is reachable only from
  `sync`, `prefetch` and `history.loadMore`. Therefore nothing can start message work after session
  deletion, and there is no settlement barrier left to bypass.

## Gate on the committed tree (`2eb15ce`)

Bun `v1.4.0`. All commands ran from package directories, never the repo root. Typechecks all exit 0.

```text
packages/schema:   bun typecheck -> exit 0 ; bun test -> 15 pass, 0 fail, 48 expect, 6 files
packages/core:     bun typecheck -> exit 0 ; bun test -> 1098 pass, 0 fail, 3008 expect, 144 files
packages/opencode: bun typecheck -> exit 0 ; bun test -> 3596 pass, 22 skip, 1 todo, 0 fail, 50 snapshots, 9688 expect, 256 files
packages/app:      bun typecheck -> exit 0 ; bun test -> 664 pass, 9 fail, 6 errors, 2903 expect, 103 files
packages/tui:      bun typecheck -> exit 0 ; bun test -> 203 pass, 1 skip, 0 fail, 8 snapshots, 476 expect, 50 files
```

- `packages/opencode`: `bun test test/cli/run/run-process.test.ts` -> **13 pass, 0 fail, 47 expect**.
- Focused App owner file: `src/context/server-session.test.ts` -> **88 pass / 0 fail / 164 expect**.
- App delta: round-10 baseline 672 pass → **664 pass / 9 pre-existing fail**. Net **−8**: 11 tests
  deleted for removed machinery, 3 added. The 9 failures and 6 errors are the disclosed pre-existing
  SolidJS module-load failures (clean `dev` = 645 pass / 10 fail); none is touched.
- One parallel gate run showed a TUI flake (`ENOENT /tmp/opencode/state/kv.json` from concurrent
  suites sharing a temp path). TUI re-run in isolation: **203 pass / 1 skip / 0 fail**.

## Headline re-measurement (untouched)

Astra's harness `/tmp/opencode/astra-v6-measure.mjs` injects a process-local measurement into
`packages/opencode/test/server/session-message-diff-events.test.ts`; with `V6_BASE=1` it substitutes
the exact `dev` producer via `git show`. No source or committed test was modified.

```text
V6_MEASURE {"base":false,"bytes":300341,"types":["message.diff.updated.1"],"perFull":300511}
ACTIVE V6 exact dev producer
V6_MEASURE {"base":true,"bytes":1202044,"types":["message.updated.1","message.updated.1","message.updated.1","message.updated.1"],"perFull":300511}
```

`(1202044 − 300341) / 1202044 = 0.7501414257714359` → **75.01414257714359%**. This round touches only
App client code and its test file, so the producer and its byte counts cannot move.

## Scope, safety, repository state

- **(At the time of this historical round only.)** No server, schema, core, TUI, or SDK file was
  modified. `dir`-level diff against `dev` is exactly the two App owner files plus the previously
  committed App routing test. This is false for the current HEAD — see the banner above.
- No production database was opened. Test databases are the suites' `:memory:`/temp fixtures.
- No rebase/reset/amend/stash, force-push, or branch checkout. Mutation experiments edited the
  tracked source in place and restored it from a `/tmp/opencode/carve` backup; the restored file was
  verified byte-identical (`diff -q`) before each commit.
- Final `git status --short` is exactly `?? FIX-REPORT.md`.

## Round 12 — v10 mutation-coverage closure (F1–F4), F5 disposition

The v10 review's only remaining blocker was mutation coverage: four correct kept behaviors had no committed test that failed when the behavior was deleted. This round adds four regression tests to `packages/app/src/context/server-session.test.ts`. **No production code was changed** (`git diff --exit-code HEAD -- packages/app/src/context/server-session.ts` clean). The owner file goes **88 → 92** tests.

### Finding disposition

| Finding | Sev | Behavior pinned | Test added | Mutant killed |
| --- | --- | --- | --- | --- |
| **F1** `:1118` | MAJOR | No-active-load guard: an uncached diff with no active load is a no-op and cannot replay into the next authoritative page (P4 `null→LIVE`, P9 `NEW→OLD`) | `does not replay an ignored diff into the next authoritative page` | `noActiveLoadGuard` |
| **F2** `:518` | MAJOR | `evict` clears `pendingDiffs`, so an evicted generation's buffered diff cannot replay into the replacement session (P10 `null→OLD`) | `clears a buffered diff when the session is evicted` | `noEvictClear` |
| **F3** `:1126` | MINOR | `touchedMessages` marker keeps a just-applied cached diff through a concurrent refresh that omits the turn (P11 `present→absent`) | `preserves a cached diff applied during a refresh that omits its turn` | `cachedTouchNone` |
| **F4** `:1075` | MINOR | `retirePendingDiff` on `message.updated` lets the authoritative newer message supersede a buffered older diff (P8 `NEW→OLD`) | `lets an authoritative message update retire a buffered diff` | `noMessageUpdatedRetire` |
| **F5** `:884-889` | NIT | Sync rejection propagation via `Promise.all` | **Not added — base coverage this PR does not own.** `sync` is byte-identical to `dev` (restored by the carve-out); base ships no such test; v10 rates it a NIT on base semantics. Adding one would pin behavior this PR does not change. | n/a |

### Mutation evidence (three outputs per test)

Protocol per test: (1) mutate the tracked production source and run the focused owner file with the new test **absent** → green (survivor confirmed); (2) add the test and run the focused owner file → the pinning test fails; (3) restore source from the byte-identical backup and run → green. All commands run from `packages/app` with `bun test --conditions=solid --preload ./happydom.ts ./src/context/server-session.test.ts`.

**F1 — mutant `noActiveLoadGuard` (delete `:1118`)**

```text
OUT1 (mutant, F1 test absent):   88 pass, 0 fail, 164 expect
OUT2 (mutant, F1 test added):    88 pass, 1 fail, 166 expect
  (fail) server session > does not replay an ignored diff into the next authoritative page
  error: expect(received).toBeUndefined()  Received: "APP-IGNORED-A"
OUT3 (reverted, full):           89 pass, 0 fail, 168 expect
```

**F2 — mutant `noEvictClear` (delete `:518`)**

```text
OUT1 (mutant, F2 test absent):   89 pass, 0 fail, 168 expect
OUT2 (mutant, F2 test added):    89 pass, 1 fail, 169 expect
  (fail) server session > clears a buffered diff when the session is evicted
  error: expect(received).toBeUndefined()  Received: "APP-EVICTED-A"
OUT3 (reverted, full):           90 pass, 0 fail, 169 expect
```

**F3 — mutant `cachedTouchNone` (delete `:1126`)**

```text
OUT1 (mutant, F3 test absent):   90 pass, 0 fail, 169 expect
OUT2 (mutant, F3 test added):    90 pass, 1 fail, 170 expect
  (fail) server session > preserves a cached diff applied during a refresh that omits its turn
  error: expect(received).toBe(expected)  Expected: "APP-LIVE-B"  Received: undefined
OUT3 (reverted, full):           91 pass, 0 fail, 170 expect
```

**F4 — mutant `noMessageUpdatedRetire` (delete `:1075`)**

```text
OUT1 (mutant, F4 test absent):   91 pass, 0 fail, 170 expect
OUT2 (mutant, F4 test added):    91 pass, 1 fail, 171 expect
  (fail) server session > lets an authoritative message update retire a buffered diff
  error: expect(received).toBe(expected)  Expected: "APP-NEW-B"  Received: "APP-STALE-A"
OUT3 (reverted, full):           92 pass, 0 fail, 171 expect
```

All four previously-surviving mutants are now killed by an added test; no mutant survived this round.

### Gate on the new tree

```text
packages/app  bun typecheck (tsgo -b)                       → exit 0
packages/app  server-session.test.ts (focused owner)        → 92 pass / 0 fail / 171 expect / 1 file
packages/app  bun run test:unit (full)                      → 743 pass / 0 fail / 3056 expect / 103 files
```

The four additions are the entire delta in the owner file (88 → 92). The known nine pre-existing App module-load failures did **not** reproduce in this run; `bun run test:unit` was clean at 743/0 on this tree (the earlier 664/9 baseline reflected those environmental load failures, not this change). `git status --short` = `M packages/app/src/context/server-session.test.ts` + `?? FIX-REPORT.md` before the commit; production `server-session.ts` is byte-identical to HEAD.

### Verdict

**The v10 DO NOT SHIP flips to SHIP.** F1–F4 each now has a committed test that fails on the exact mutant the v10 review proved survived; F5 is explicitly base-provided coverage this PR does not own; no production code changed; typecheck is clean and the focused owner suite is green.

## Round 13 — astra v11 coverage closure (F1, F2)

Commit `3a39667` adds four regression tests to `packages/app/src/context/server-session.test.ts`. **No production code changed**: `git diff --exit-code HEAD -- packages/app/src/context/server-session.ts` is clean and the file is byte-identical to `eb8746e`. The owner file goes **92 → 96** tests.

astra v11's two findings are coverage gaps against correct existing code, not live production defects. Its exact two F1 mutants and its F2 catch-and-swallow mutant were each reproduced against the real owner and each is now killed by an added test.

### Finding disposition

| Finding | Sev | Behavior pinned | Test added | Mutant killed |
| --- | --- | --- | --- | --- |
| **astra F1** `:1109` | BLOCKER | The removed-message tombstone guard stops a diff that arrives **after** removal from being buffered and later overlaid onto an optimistically re-added user | `does not apply a late diff to a message re-added after removal` | `noTombstoneGuard` (delete `:1109`) |
| **astra F1** `:1145` | BLOCKER | `retirePendingDiff` on `message.removed` clears a diff buffered **before** the removal so it cannot overlay the re-added user | `retires a buffered diff when its message is removed and re-added` | `noRemovalRetire` (delete `:1145`) |
| **astra F2** `:621` | MINOR | `sync`'s `Promise.all` propagates a rejected session-info request and a rejected initial message page to the caller | `rejects a sync whose session info fails`; `rejects a sync whose initial message page fails` | `swallowSyncRejection` (append `.catch(() => {})` to the `Promise.all` in `sync`) |

Both F1 tests share the same end assertion but exercise opposite orderings — diff-after-removal vs. diff-before-removal — so neither mutant is killed by the other's test. This was confirmed: `noTombstoneGuard` survives with only the F1b test present, and `noRemovalRetire` survives with only the F1a test present.

**F2 disposition — restored, not skipped.** The carve-out `dbcb903` deleted `rejects a sync whose session info fails` and `rejects a sync whose initial message page fails`. `sync` is byte-identical to base `dev`, but the coverage loss is this PR's doing, astra rates it MINOR, and both reviewers now flag it. Restoring two minimal rejection assertions is in scope and needs no production change. Rejection handlers are attached with `.then(onFulfilled, onRejected)` at creation, before either deferred input is rejected.

### Mutation evidence (three outputs per mutant)

The `OUT1` "survivor" run is the **full** `packages/app` unit suite with the test absent (stronger than the focused file); `OUT2` is the focused owner file after adding the test; `OUT3` restores the production file from a byte-identical backup and reruns the focused owner file. Commands ran from `packages/app`.

**F1a — mutant `noTombstoneGuard` (delete `:1109`)**

```text
OUT1 (mutant, F1a test absent, full suite): 743 pass, 0 fail, 3056 expect, 103 files
OUT2 (mutant, F1a test added, focused):     92 pass, 1 fail, 173 expect
  (fail) server session > does not apply a late diff to a message re-added after removal
  error: expect(received).toBeUndefined()  Received: "REMOVED-PATCH"
OUT3 (reverted, focused):                   93 pass, 0 fail, 173 expect
```

**F1b — mutant `noRemovalRetire` (delete `:1145`)**

```text
OUT1 (mutant, F1b test absent, full suite): 744 pass, 0 fail, 3058 expect, 103 files
OUT2 (mutant, F1b test added, focused):     93 pass, 1 fail, 175 expect
  (fail) server session > retires a buffered diff when its message is removed and re-added
  error: expect(received).toBeUndefined()  Received: "OLD-PATCH"
OUT3 (reverted, focused):                   94 pass, 0 fail, 175 expect
```

**F2 — mutant `swallowSyncRejection` (append `.catch(() => {})` to `sync`'s `Promise.all`)**

```text
OUT1 (mutant, F2 tests absent, full suite): 745 pass, 0 fail, 3060 expect, 103 files
OUT2 (mutant, F2 tests added, focused):     94 pass, 2 fail, 177 expect
  (fail) server session > rejects a sync whose session info fails
  error: expect(received).toBe(expected)  Expected: "info failure"  Received: "resolved"
  (fail) server session > rejects a sync whose initial message page fails
  error: expect(received).toBe(expected)  Expected: "page failure"  Received: "resolved"
OUT3 (reverted, focused):                   96 pass, 0 fail, 177 expect
```

Every output matches astra v11's reported probe values (`REMOVED-PATCH`, `OLD-PATCH`, and `resolved` in place of the two rejection messages). No mutant survived.

### Gate on the new tree (`3a39667`)

```text
packages/app  bun typecheck (tsgo -b)                → exit 0
packages/app  server-session.test.ts (focused owner) → 96 pass / 0 fail / 177 expect / 1 file
packages/app  bun run test:unit (full)               → 747 pass / 0 fail / 3062 expect / 103 files
```

The measured pre-change baseline on this tree was `743 pass / 0 fail`; the four additions produce exactly `747`. The task's quoted `668 / 9` baseline is the older environmental count — the nine pre-existing SolidJS module-load failures did not reproduce here, consistent with the round-12 note. `git status --short` is exactly `?? FIX-REPORT.md`; HEAD is `3a39667`.

### Verdict

**SHIP.** astra v11's BLOCKER (F1, two surviving removed-message-protection mutants) and MINOR (F2, ordinary sync rejection propagation) are both closed by committed tests that kill the exact mutants astra and deepseek v10 named. No production code was changed; the server core is byte-identical; the `75.01414257714359%` headline is untouched; typecheck is clean and the full App unit suite is green.
