# Amendment 2026-07-19 — Archived Issue Management Realignment

**Supersedes:** ADR-0001 §5.6 "Archived issues are read-only" and the
former `IssueArchivedError` guard.
**Affects:** ADR-0002 §D10 (IssueNotArchivedError on delete — retained).

## Context

The original design treated `IssueArchivedError` as a permission-level
block: `Issue.update` and `Issue.reorder` rejected all writes to issues
whose `status` was in `ARCHIVED_STATUSES = {Done, Canceled, Duplicate}`.

User clarification (2026-07-19):

> 已归档的 Issues，在 UI 层上已经对用户禁用，但是在权限上，用户和 Agent
> 都应有能力管理这些已归档的 Issues。在 Todo Sidebar Feature 的本地归档中，
> 归档语义为 Agent 在 auto-progress 过程中应该不再将这些 Issues 纳入任务，
> 同时从 Agent 视角和用户视角看，已归档的 Issues 都被视为已终结，这只是
> Issues 管理上的显式禁用，不代表用户和 Agent 失去管理这些已归档的 Issues
> 的权限。

Translation: "Archive" is a **UI-level disablement** and an **agent
planning hint** — not a permission-level block. Users and agents retain
full management capability over archived issues.

## Decision

1. **Remove `IssueArchivedError` guard** from `Issue.update` and
   `Issue.reorder`. Both methods now accept archived issues as inputs.
2. **Delete `Issue.patchStatus` service** — it was a workaround for the
   guard (raw `db.update` bypassing it). With the guard gone, the
   regular `Issue.update({ patch: { status } })` path covers status
   transitions on archived issues. The service is removed cleanly:
   - Deleted `patchStatus` from `Interface`
   - Deleted `patchStatus` implementation
   - Deleted `patchStatus` from `Service.of({...})` return
3. **Delete `IssueArchivedError` class** — no remaining references
   after guard removal.
4. **Add `status` parameter** to Agent tool `issue_update`. Agents
   can now transition any issue between the 7 Linear statuses
   (Backlog/Todo/In Progress/In Review/Done/Canceled/Duplicate),
   including un-archiving (e.g., Done → Backlog).
5. **Retain `IssueNotArchivedError`** on `Issue.delete` — delete is
   still gated on "must be archived first" (spec §5.4, business rule
   for safe deletion, not a UI disablement).

## Files Changed

| File                                                                     | Change                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/issue/issue.ts`                                   | Removed `IssueArchivedError` class; removed guard in `update`; removed guard in `reorder`; deleted `patchStatus` service (interface + impl + return); updated `Interface` signatures                     |
| `packages/opencode/src/tool/issue_update.ts`                             | Added `status` parameter to `Parameters` schema; added `if (params.status !== undefined) patch.status = params.status` to patch assembly; removed `Effect.catchTag("Issue.ArchivedError", ...)` fallback |
| `packages/opencode/src/tool/issue_reorder.ts`                            | Removed `Effect.catchTag("Issue.ArchivedError", ...)` fallback and the archived-list failure branch                                                                                                      |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/issue.ts` | Removed `Effect.catchTag("Issue.ArchivedError", ...)` from `update` and `reorder` handlers; retained on `remove` (for `IssueNotArchivedError`)                                                           |
| `packages/opencode/src/issue/sync-push.ts`                               | Updated CREATE-path comment (was "bypass archive guard", now "avoid bus event fan-out")                                                                                                                  |
| `packages/opencode/src/issue/sync-pull.ts`                               | Updated INSERT and UPDATE path comments (same reason)                                                                                                                                                    |
| `packages/opencode/test/issue/issue.test.ts`                             | Rewrote "archive protection" tests as "archived issue management" tests: now assert that update/reorder/status-transition on archived issues succeed                                                     |

## Verification

- `bun --cwd packages/opencode typecheck` — passed
- `bun --cwd packages/opencode test test/issue` — 22 pass (15 unit + 7 E2E,
  one E2E initially flaky due to LLM nondeterminism, passed on retry)
- `bun --cwd packages/opencode test test/tool` — 338 pass, 0 fail

## Impact on UI

UI's `cycleStatus` ([sidebar-todo.tsx:478-489](../../../packages/app/src/pages/layout/sidebar-todo.tsx#L478-L489))
previously failed silently when cycling status on an archived issue
(`Issue.update` returned 400 BadRequest via `IssueArchivedError`). Now
the same `client.issue.update({ patch: { status } })` call succeeds for
archived issues — no UI change needed.

The UI's `isArchived(issue)` checks in `sidebar-todo.tsx` continue to
disable certain row interactions visually (e.g., the row is grayed
out), but the underlying API calls are no longer blocked.
