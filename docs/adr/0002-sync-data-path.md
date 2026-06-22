# ADR-0002: Sync data path — workspace-scoped, snapshot import, always-runs

**Status:** Accepted (grilling round 2, 2026-06-22)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude (grill-with-docs session)
**Depends on:** ADR-0001

## Context

ADR-0001 placed the new feature at workspace scope (`IssueTable` keyed by `directory`). It also stipulated that Linear is an _add-on_: a sub-panel inside the new `Todos` sidebar section. Round 2 of the grilling surfaced three problems in the existing sync code that fall out of that decision:

1. **The UI handler is a simulation.** `sidebar-linear.tsx:53-72` and `32-51` — `handleSync` and `handlePull` animate a 3-second `requestAnimationFrame` and then call `record({ count: 1, status: "success" })`. The "1" is a hardcoded literal. The user reported "Pull from Linear" returning "Already up to date (1 already synced)" — that string is the user's reading of the fake success toast, not a kernel response.
2. **The kernel API is the wrong shape.** `sync-pull.ts:191` declares `pull({ sessionID })` and writes to `TodoTable` via `todoSvc.create({ sessionID, todo })`. After ADR-0001, the table and the scope are both wrong.
3. **"Already up to date" is undefined.** The user's mental model was "set-based diff: nothing new, skip." The kernel's actual behaviour is "per-issue dedup by `linear_issue_id` in one session" — different model, and a model that produces duplicates when two sessions in the same workspace both pull.

This ADR fixes all three.

## Decision

### D5 — Pull is a snapshot import; existing locals are left alone

`Issue.SyncPull.pull({ directory })` does the following:

1. Read the active `Config.Info.linear.{projectId, teamId, syncMode}`. If `projectId` or `teamId` is missing, fail with `SyncPull.Error` and a human-readable message. **The UI surfaces this as an error toast, not a no-op.**
2. Read all rows from `IssueTable` where `directory = input.directory`. Build a set `localLinkedIds = { t.linear_issue_id for t where t.linear_issue_id is not null }`.
3. Page through `list_issues` (Linear MCP `list_issues`, paginated 50/page) for the configured `projectId`. Stop on Linear `state.type ∈ {unstarted, started}` (the **active set**).
4. For each active issue:
   - If `localLinkedIds.has(issue.id)` → record in `result.skipped`, do not touch the local row.
   - Otherwise → map to a new `Issue.Info` and insert into `IssueTable` with `directory = input.directory`, `linear_issue_id = issue.id`. Increment `result.pulled` and append the id to `result.ids`.
5. Return `Result { pulled, skipped, failed, ids, errors }`.

**The pull never updates fields on an existing local row.** Status, priority, labels, etc. that the user has changed locally stay local. If the user wants Linear's current state, they can edit the row manually or use a future "reconcile" operation. This is intentional — the user's edits are first-class.

Status mapping (kernel → local): `unstarted` → `Backlog`, `started` → `In Progress`, `completed` → `Done`, `canceled` / `cancelled` → `Canceled`, default → `Todo`. The status enum is the Linear-aligned set, not the in-session `pending/in_progress/completed/cancelled` quartet. The new `Issue.Info.status` is `Backlog | Todo | InProgress | InReview | Done | Canceled` (snake_case in the DB, camelCase or kebab-case at the API edge — pending a small style call).

Priority mapping (Linear number → local): `1` → `Urgent`, `2` → `High`, `3` → `Medium`, `4` → `Low`, default → `NoPriority`.

### D6 — Pull always runs; no "already up to date" skip

There is no watermark and no set-equality shortcut. The pull is a _fetch + insert-if-new_, not a _diff_. Reasons:

- Linear does not expose a "since" cursor cheaply; the `updatedAt` filter exists but is per-issue, not per-project.
- A "nothing to do" optimisation would hide real changes (a Linear issue that was completed since the last pull, a Linear issue that was deleted). Both should be visible — completion by reading the row, deletion by an explicit "remove from local" action that lands in a follow-up ADR.
- The user's mental model of "Already up to date (1 already synced)" was the bug. The fix is to remove the label entirely and let the result speak: `{ pulled: 0, skipped: 1 }` reads as "1 issue was already linked; 0 new" — honest, specific, no euphemism.

**The UI text rule**: never say "Already up to date" or "Up to date" anywhere in the sidebar. Say "Pulled 0 · Skipped N" or, if `pulled > 0`, "Pulled N · Skipped M" — the user reads the counts and the timestamps.

### D7 — Kernel API shape: `pull({ directory })` and `push({ directory })`

The new routes take `directory` only. No `sessionID` parameter. Specifically:

- `POST /issue/sync/pull` body `{ directory: string }` → `SyncPull.Result`
- `POST /issue/sync/push` body `{ directory: string }` → `SyncPush.Result`
- (Routes live under the instance-scoped router; the directory is matched to the instance the request is going to. The kernel resolves `directory` from the request context, not from the body — but the body carries the directory so the SDK can generate a typed request.)

Auto-progress is fully decoupled from any session. It runs in the workspace layer: `Issue.AutoProgress.tick({ directory })` is invoked by a subscriber to `Issue.Updated` events filtered by `directory`. The subscriber lives in `Issue.AutoProgress.subscribeLayer` and is provided in the same layer that owns the `Issue.Service` (per `packages/opencode/AGENTS.md`'s "use `Effect.forkScoped` inside the layer's closure" rule).

`Issue.Progressed` is published on the bus with `{ directory, from, to, reason }`. Any session in that workspace (zero, one, or many) can subscribe; the bus is fan-out. The TUI's `feature-plugins/sidebar/linear.tsx` can subscribe to show "current L1 in progress" without coupling to a session.

### D8 — `SyncPush.push({ directory })` is the inverse, with the same "leave local alone" rule

The push walks the local `IssueTable` rows where `linear_issue_id IS NOT NULL`, and for each one that has been updated locally since the last push (a `last_pushed_at` per row, or a single `directory.last_pushed_at` watermark — pending a follow-up ADR), writes the changed fields to Linear via `update_issue`. It does not create new Linear issues; new issues are created explicitly by the user via a "Publish to Linear" action on a single row. (Bulk-publish on first push is allowed; see D10.)

The push never reads from Linear. If the local row says `status = Done` but Linear's `state.type = started`, the push will set Linear to `Done`. The pull will not undo this (per D5). The user's local truth wins for _pushed_ fields, until a future "reconcile from Linear" operation.

### D9 — The fake handlers are deleted, not fixed

`sidebar-linear.tsx`'s `handleSync` and `handlePull` are removed. The buttons are re-bound to:

- `globalSDK.client.issue.syncPull({ directory })` for Pull.
- `globalSDK.client.issue.syncPush({ directory })` for Sync.
- The result `{ pulled, skipped, failed }` is read; the toast text is derived from it ("Pulled N · Skipped M" or "Pull failed: <message>"); the `LinearSyncHistory` entry is recorded with the real counts and `status: success | error`.

The 3-second `requestAnimationFrame` shim is gone. The `progress` state in `useSyncHistory` is wired to the real request: `0` → request starts, `100` → response received. If the request takes 80ms, the progress bar shows a flash. If it takes 4s, it shows a 4s progress bar. The fake duration is replaced by reality.

### D10 — A no-op handler is a defect, not a stub

Code-review rule, formalised in `CONTRIBUTING.md` (or a new `docs/contracts/no-fake-handlers.md`):

> Any UI handler that simulates an effect — animates a progress bar, sets a hardcoded count, calls a function that does not contact the kernel — is a **defect**, not a placeholder. The handler must either call the real API or be deleted. Do not land code that "looks like it works" but does not.

The reasoning is the user's bug report: a fake handler with a hardcoded `count: 1` is indistinguishable from a working handler with a real count of 1. The user cannot tell. We treat the two as the same bug.

A CI lint could check for `requestAnimationFrame` inside event handlers bound to async-sounding buttons. That's a nice-to-have, not a blocker for this ADR.

## Consequences

### Positive

- The pull result is always a true count. The user can trust "Pulled 0 · Skipped 1" because it really is 0 and 1.
- Two sessions in the same workspace no longer race on dedup; `localLinkedIds` is per-`directory`, not per-session, so a concurrent pull sees the same set.
- The kernel API matches the data model from ADR-0001. The shape is consistent end-to-end: directory → table, directory → route, directory → bus event.
- Removing the fake handler shrinks the diff against `dev` and removes the only path through which the user could see a confidently-wrong answer.

### Negative / costs

- A pulled issue that has since been edited in Linear will not auto-update locally. Users who want the latest from Linear must delete and re-pull, or wait for a future "reconcile" operation. This is the cost of (a) being honest about what pull does.
- The push requires a per-row `last_pushed_at` (or a per-directory watermark) to know what's changed. Adds a column. Migration needed.
- The kernel routes need to be added (`packages/opencode/src/server/instance/issue.ts`), the OpenAPI metadata added, and the SDK regenerated. Standard cost; documented in CLAUDE.md.

### Neutral

- The new `Issue.Info.status` enum is wider than `TodoTable.status`. The TUI sidebar that reads `TodoTable` (in-session) is unaffected.

## Open Questions

1. **Status casing in code** — `InProgress` vs `In_Progress` vs `in_progress` in the TypeScript types. Drizzle columns are snake_case; the zod schema can pick the JS shape. Recommendation: `InProgress`, `InReview`, `NoPriority` (camelCase / PascalCase, no underscores); Drizzle column still `in_progress`, etc. **Owner: user, blocking D5 implementation.**
2. **Per-row `last_pushed_at` vs per-directory watermark** — the push dedup is the only thing that needs it. Per-row is more correct (a row that hasn't changed is not pushed even if others have); per-directory is one column vs N. Recommendation: per-row. **Owner: implementation.**
3. **What does "Publish to Linear" do for an issue with no `linear_issue_id`?** — `create_issue` via the Linear MCP. D10 keeps this as an explicit row action, not part of the bulk `push`. **Owner: implementation, no decision needed.**

## Notes

The shape described here is the minimum to close round 2. The follow-ups (reconcile, bulk-publish, per-row history) are deferred but should land before the feature is considered "1.0" — track them as Linear issues once the kernel table is in place.
