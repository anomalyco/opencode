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

## Verification notes (2026-06-29, post-implementation)

The live Linear MCP `list_issues` was probed with a real API key (`script/issue-linear-probe.ts`, capture in `packages/opencode/src/issue/__fixtures__/linear-list-issues-real.json`). The real response shape differs from the fabricated unit-test shape and from D5's prose:

- **Wrapper**: `content[0].text` decodes to a **flat top-level** `{ issues: [...], hasNextPage: boolean }`. There is **no** `data` wrapper and **no** `nodes`/`pageInfo` nesting. The original `parseIssues` looked for `data.issues.nodes` and returned `[]` for every real call — the root cause of "pull says synced but nothing appears." Fixed to read the flat shape (with the legacy `{data:{issues:{nodes}}}` kept defensively).
- **Field names**: per-issue state type is `statusType` (e.g. `"started"`, `"unstarted"`), **not** `state.type`. Priority is an object `{ value, name }`, not a bare number. Labels is a flat `string[]`, not `{ nodes: [{ name }] }`. The mapper now reads all three correctly (`readStateType`, `readPriorityValue`, `extractLabels`).

**Project scope is load-bearing (D5 step 3).** Pull queries `list_issues` with `project: cfg.projectId` and therefore only synchronizes issues that belong to the configured Linear project. A Linear issue with **no project assigned** (verified case: `BOR-12 "Test Issue 3"` in the user's workspace) is invisible to pull by design — it is not a kernel bug. A backlog-state issue (`statusType: "backlog"`) is also filtered by `ACTIVE_STATES = {unstarted, started}`. If the user expects all workspace issues to appear, that is a follow-up scope decision (add a "pull workspace-wide" mode that omits the `project` filter), not a defect in the current ADR.

**Config scaffolding.** Per ADR-0004, the Linear _team/project binding_ (`teamId`/`teamName`/`projectId`) is workspace-scoped, stored in `<workspace>/.opencode/linear-binding.json` and accessed via `LinearBinding.Service`. The Linear _MCP server_ registration (`Config.Info.mcp.linear = { type: "remote", url, headers }`) lives under the `mcp.linear` top-level key. A project dir that registers the MCP server but does not configure the workspace binding will have pull fail with `SyncPull.Error("Linear binding missing projectId or teamId")` — surfaced as an error toast, not a no-op (per D5 step 1).

## Amendment 2026-07-09 — D5 revised: pull reconciles cloud-side edits into linked local rows

**Status:** Accepted (2026-07-09)
**Supersedes:** the "The pull never updates fields on an existing local row" clause of D5.

### Context

D5's original contract ("existing locals are left alone") meant that once a Linear issue was linked locally, any subsequent cloud-side edit (title, description, status, priority, labels, due date, assignee) was silently invisible to pull — the row was skipped by `linear_issue_id` membership alone. The "Negative / costs" section of this ADR flagged this as a known limitation and deferred the fix to "a future reconcile operation."

The user reported the concrete symptom: editing an issue in Linear and pulling locally left the local copy stale. The requested idempotency model is that a pull reflects the current cloud state for Linear-sourced issues.

Investigation confirmed Linear MCP does **not** expose a per-field diff tool (the `get_diff`/`list_diffs`/`get_diff_threads` tools are Linear's code-review diff feature, unrelated to issue content). However, `list_issues` returns an `updatedAt` ISO-8601 timestamp on every issue node — a sufficient cloud-side change watermark for field-level reconcile.

### Decision

For issues with a `linear_issue_id` (Linear-sourced), pull now follows a **cloud-wins reconcile** model. The pull walks every Linear issue returned by `list_issues` for the configured project and applies one of three paths:

1. **Not linked locally** → INSERT a new row (unchanged from D5).
2. **Linked, stored `last_pulled_at` === cloud `updatedAt`** → SKIP (truly unchanged).
3. **Linked, `last_pulled_at` differs or is null** → UPDATE the local row's Linear-sourced fields from the cloud and refresh the stored watermark.

A new `IssueTable.last_pulled_at` column (integer Unix ms, nullable) stores the mirror of Linear's cloud-side `updatedAt` captured at the last pull. It is the change-detection watermark. It is null for local-only issues and for rows pulled before this amendment; a null watermark is treated as "needs reconcile" so the first post-migration pull seeds the watermark from the cloud.

**Fields overwritten from cloud on reconcile (Linear-sourced fields):** `title`, `content`, `description`, `status` (from `statusType`), `priority` (from `priority.value`), `labels`, `due_date`, `assignee_id`, and `last_pulled_at` itself.

**Fields NEVER overwritten by pull (local-only concerns):** `id`, `directory`, `parent_id`, `level`, `position`, `last_pushed_at`, `time_created`, `time_updated`. These are either immutable, locally-owned hierarchy/ordering, or push-tracking state that pull must not reset.

**Local-only issues (no `linear_issue_id`)** are never touched by a pull — unchanged from D5.

**Defensive skip:** if a Linear issue node does not report an `updatedAt`, the pull conservatively SKIPs rather than unconditionally overwriting on every pull (matches pre-amendment behaviour for servers that omit the field).

### Conflict resolution

Cloud-wins for Linear-sourced fields. If the user edited a linked issue locally without pushing, and the cloud also moved, the next pull overwrites the local edit with the cloud state. This is intentional: for issues that originate on Linear, Linear is the source of truth. Users who want to preserve local edits should not pull, or should push their local edits to Linear first. Local-only issues are unaffected.

### Result shape

`SyncPull.Result` gains an `updated: number` count alongside `pulled`/`skipped`/`failed`. The UI toast reads "Pulled N · Updated M · Skipped K" (i18n key `sidebar.linear.pullSuccess` updated in all locales).

### What this does NOT change

- D5's "active set" and project-scoping semantics (pull still fetches the configured project's issues).
- D6's "pull always runs; no 'already up to date' skip at the operation level" — the pull still always runs; per-issue SKIP is a legitimate "unchanged" outcome, not an operation-level shortcut.
- D8's push contract — push remains the inverse with its own `last_pushed_at` watermark; pull refreshing `last_pulled_at` does not reset `last_pushed_at`.

### Migration

`migration/20260708183506_add_issue_linear_updated_at/migration.sql` originally added the nullable `linear_updated_at` integer column to `issue`; `migration/20260717043303_rename_linear_updated_at_to_last_pulled_at/migration.sql` renames it to `last_pulled_at` (see Amendment 2026-07-17 — Column rename). Existing rows have `last_pulled_at = null` and are reconciled on the next pull.

## Amendment 2026-07-10 — Status system refactor: dynamic Linear workflow states + `status_type`

**Status:** Accepted (2026-07-10)
**Supersedes:** the "Status mapping (kernel → local)" clause of D5 and the "The new `Issue.Info.status` enum is wider than `TodoTable.status`" Neutral note.

### Context

D5 originally specified a 6-value status enum (`Backlog | Todo | InProgress | InReview | Done | Canceled`) with a fixed kernel→local state mapping (`unstarted → Backlog`, `started → In Progress`, etc.). Investigation of the live Linear MCP and the user's Linear workspace surfaced three problems:

1. **Linear's status set is wider and team-customizable.** The user's workspace exposes 7 default states: `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`. Teams may rename these or add custom states. A fixed 6-value enum cannot represent `Duplicate` and silently drops custom names.
2. **The state-type → status-name mapping was lossy and non-bijective.** Mapping `unstarted → Backlog` collapsed both `Backlog` and `Todo` (both `unstarted`) into one local value, destroying the distinction the user explicitly set. The reverse push then sent the wrong state name back to Linear.
3. **AutoProgress hardcoded state names.** The engine matched `"in_progress"` / `"done"` / `"todo"` literally, breaking for teams that rename states (e.g., a team that calls its started state "In QA").

### Decision

The local `Issue.Status` is now a **plain string** storing the Linear workflow state name verbatim (e.g., `"In Progress"`, `"Backlog"`, `"Duplicate"`). There is no enum and no mapping. A new `Issue.StatusType` enum (`unstarted | started | completed | canceled`) stores Linear's 4-value state classification, populated from the `statusType` field on each `list_issues` node. `Issue.DEFAULT_STATUS = "Backlog"` is the fallback for newly created issues — it does NOT trigger AutoProgress (only `Todo`, the other `unstarted` state, does).

**Dynamic status discovery.** A new `GET /issue/linear/statuses` route calls the Linear MCP `list_issue_statuses` tool and returns `[{ id, name, type, color? }]` for the configured team. The Todo add/edit dialog fetches this list and renders a dynamic `<Select>` selector. When Linear is not connected, the selector falls back to `["Backlog"]` (the default), so the user can still create a todo without triggering AutoProgress.

**AutoProgress classification.** The engine classifies state via `status_type` (not status name): `classifyState(issue)` returns the `status_type` or `"unknown"` for local-only issues. Rule 2 promotes the first L1 whose `status_type === "unstarted" && status !== DEFAULT_STATUS` (i.e., `Todo` triggers, `Backlog` does not). Target states use canonical Linear default names (`STARTED_STATUS = "In Progress"`, `COMPLETED_STATUS = "Done"`), which Linear's `save_issue` accepts as state names.

**Sync (push/pull) passthrough.** Both directions pass the status name through unchanged — no mapping. `save_issue.state` receives `issue.status` directly (Linear accepts a state name, type, or id). `list_issues.status` is read into `Issue.status` verbatim. The `cloud_shadow` snapshot now includes `status_type` alongside `status` so the shadow-diff dirty check catches AutoProgress `patchStatus` changes (which update `status` and `status_type` without bumping `time_updated`).

### Migration

`migration/<timestamp>_issue_status_type_refactor/migration.sql` adds the nullable `status_type` text column to `issue`. Existing rows have `status_type = null`; AutoProgress treats null-`status_type` rows with `status === "Backlog"` as `unstarted` and everything else as `unknown` (no auto-promotion). The next pull from Linear backfills `status_type` from each issue's `statusType` field.

### What this does NOT change

- D5's pull contract (cloud-wins reconcile, project-scoping, active set).
- D6's "pull always runs" rule.
- D8's push contract (field-level merge, `last_pushed_at` watermark).
- The `IssueTable.last_pulled_at` watermark from the 2026-07-09 amendment.

## Amendment 2026-07-11 — Remove `status_type`, AutoProgress uses Linear status names directly

**Status:** Accepted (2026-07-11)
**Supersedes:** Amendment 2026-07-10 in full (the `Issue.StatusType` enum, the `classifyState` engine, the `status_type` column, and the `status_type` inclusion in `cloud_shadow` and `SHADOW_FIELDS`).

### Context

The 2026-07-10 amendment introduced a 4-value `StatusType` enum (`unstarted | started | completed | canceled`) to classify Linear workflow states for AutoProgress, populated from the `statusType` field on each `list_issues` node. However, the live Linear MCP `list_issue_statuses` tool returns the `type` field as a lowercase state name (e.g. `"backlog"`, `"in_progress"`) — NOT a 4-value enum value. The kernel's `extractStatusType` normalizer could not reliably map these lowercase names to the 4-value enum, causing Zod validation failures when creating issues via the Todo dialog.

More fundamentally, the 4-value classification was an unnecessary indirection. Linear's 7 default status names (`Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`) already encode the full state classification needed by AutoProgress:

- **Active** (`In Progress`, `In Review`) — agent is working on the issue.
- **Completed** (`Done`) — work is finished.
- **Terminated** (`Canceled`, `Duplicate`) — work is abandoned.
- **Unstarted** (`Backlog`, `Todo`) — work has not started; `Todo` triggers AutoProgress, `Backlog` does not.

### Decision

1. **`status_type` is removed entirely.** The `Issue.StatusType` Zod enum, the `IssueTable.status_type` column, the `status_type` field in `Issue.Info` and `Issue.Interface.patchStatus`, and the `status_type` entry in `SHADOW_FIELDS` and `cloud_shadow` are all deleted. `Issue.Status` remains a plain string storing the Linear workflow state name verbatim.

2. **AutoProgress matches status names directly.** The engine uses `Set<string>` collections (`ACTIVE_STATUSES`, `COMPLETED_STATUSES`, `TERMINATED_STATUSES`, `DONE_OR_TERMINATED_STATUSES`) to classify states by matching against the 7 Linear default status names. No `classifyState` function or separate classification field is needed. Rule 1 (L1 active + all L2 done/terminated → L1 → Done) and Rule 2 (first L1 with `status === "Todo"` → `In Progress` + all L2 `Todo` → `In Progress`) are unchanged in intent.

3. **`patchStatus` updates only `status`.** The `Issue.Interface.patchStatus` method signature is `{ directory, id, status }` — no `status_type` parameter. The method sets the `status` column and bumps `time_updated` (so batch push detects the change via the standard `last_pushed_at < time_updated` dirty check; the shadow-diff workaround for `patchStatus` is no longer needed).

4. **`cloud_shadow` no longer includes `status_type`.** The shadow snapshot contains only `title`, `content`, `description`, `status`, `priority`, `labels`, `due_date`, `assignee_id` — the Linear-sourced content fields that `mapLinearFields` produces. Single-issue push and batch push use the shadow diff as before; the removal of `status_type` from the shadow means a `patchStatus`-only change is detected via the `status` field difference in the shadow (since `patchStatus` updates `status` and bumps `time_updated`, both the shadow diff and the watermark dirty check catch it).

5. **Server route `GET /issue/linear/statuses` returns `{ id, name, color? }`.** The `type` field is removed from the response schema and the `parseListStatusesResponse` function no longer calls `extractStatusType`. The Todo dialog fetches the list of Linear workflow states and stores the selected state name directly as `Issue.Status` — no classification step is needed.

6. **TUI and Desktop UI use status names directly.** The `statusIcon` function in `todo-item.tsx` and `issue.tsx` matches against `Done`, `Canceled`, `Duplicate`, `In Progress`, `In Review` to pick the icon. The `isActive` check matches `status === "In Progress" || status === "In Review"`. The sidebar's `StatusCheckbox` component and `statusClass` styling function key on the status name directly.

### Migration

`migration/20260710205322_remove_status_type/migration.sql` drops the `status_type` column from the `issue` table. Existing rows lose their `status_type` value; AutoProgress now classifies them by their `status` name directly. The next pull from Linear does NOT backfill `status_type` (the field no longer exists); it refreshes `status` and `cloud_shadow` as before.

### What this does NOT change

- D5's pull contract (cloud-wins reconcile, project-scoping, active set).
- D6's "pull always runs" rule.
- D8's push contract (field-level merge, `last_pushed_at` watermark).
- The `IssueTable.last_pulled_at` watermark from the 2026-07-09 amendment.
- The 7 Linear default status names and the `Issue.DEFAULT_STATUS = "Backlog"` fallback.

## Amendment 2026-07-11 — D8 修订：bulk push 会为 local-only issues 创建 Linear issue

**Status:** Accepted (2026-07-11)
**Supersedes:** D8 的 "It does not create new Linear issues; new issues are created explicitly by the user via a 'Publish to Linear' action on a single row" 句。

### Context

D8 原文说 bulk push 不会创建新的 Linear issue，只能通过单行的 "Publish to Linear" 操作创建。但 D10 又说 "Bulk-publish on first push is allowed"。实际实现中，bulk push（`SyncPush.push`）和单行 push（`SyncPush.pushOne`）都分为两个 cohort：

1. **Linked issues**（有 `linear_issue_id`）→ UPDATE 路径：field-level merge + `save_issue` with `id`
2. **Local-only issues**（无 `linear_issue_id`）→ CREATE 路径：`save_issue` without `id`，Linear 创建新 issue，返回的 `id`（人类可读标识符如 `BOR-17`）和 `projectId`/`teamId`（UUID）存入本地行

D8 的原文本与实际行为矛盾，需要修订以反映真实设计。

### Decision

D8 修订为：**bulk push 会为 local-only issues 创建 Linear issue。** 具体行为：

- `SyncPush.push({ directory })` 遍历所有 issue，按 `linear_issue_id` 是否为 null 分为 UPDATE 和 CREATE 两个 cohort
- CREATE cohort 调用 `save_issue` without `id`，Linear 创建新 issue
- 成功后，本地行存储 `linear_issue_id`（返回的标识符）、`linear_project_id`/`linear_team_id`（UUID，优先从 `save_issue` 响应解析，回退到 binding 配置的 UUID）、`last_pulled_at`（种子水印）、`last_pushed_at`
- `SyncPush.pushOne({ directory, id })` 同样支持 CREATE 路径（单行推送）
- D10 的 "Bulk-publish on first push is allowed" 不再是例外，而是标准行为

D8 原文中的 "It does not create new Linear issues" 句被删除。单行 "Publish to Linear" 操作仍然存在（`pushOne`），但它与 bulk push 的 CREATE 路径是同一逻辑的两种调用方式，不是互斥的设计。

### What this does NOT change

- D8 的 field-level merge 语义（UPDATE 路径只发送变化的字段）
- D8 的 `last_pushed_at` 水位线机制
- D8 的 "local truth wins for pushed fields" 原则
- CREATE 路径的 `verifyLinearIssue` 硬化（G1）：UPDATE 前验证 linked issue 仍属于配置的 project/team，防止意外跨项目写入

## Amendment 2026-07-12 — 移除 issue.progressed 事件

**Status:** Accepted (2026-07-12)
**Supersedes:** ADR-0002 中对 `Issue.Progressed` 事件的全部引用（D7 中 "Issue.Progressed 事件 payload 为 { directory, from, to, reason }" 的描述）。

### Context

`issue.progressed` 事件在内核中定义于 `Issue.Event.Progressed`，由 `Issue.Service.update`、`Issue.Service.patchStatus` 和 `AutoProgress.advance` 共 5 处 publish。前端 `event-reducer.ts` 的 `case "issue.progressed"` 与 `issue.updated` fall-through 共用，仅调用 `refreshTodo()`，不消费任何 progressed 专属字段（`from`/`to`/`reason`）。

`LinearSyncHistory` 组件曾有计划通过 `issue.progressed` 事件驱动同步进度百分比显示（TODO 注释 `plan-T17`），但该进度显示设计已被移除，`progress` signal 永远为 0%，从未被写入。

事件本身不携带前端需要的增量信息（前端通过 `issue.updated` 全量重拉即可获得最新状态），且 `auto-progress.ts` 中的 3 处 publish 与 `patchStatus` 内部的 publish 存在重复发布问题。

### Decision

**移除 `issue.progressed` 事件及其全部相关逻辑：**

- `issue.ts`：删除 `Progressed` 事件定义、`Event` 对象中的导出、`inventory` 中的引用、`update` 和 `patchStatus` 中的 2 处 publish
- `auto-progress.ts`：删除 3 处 publish（Rule 1 L1 完成、Rule 2 L1 提升、Rule 2 L2 并行提升），移除 `events` 参数和 `EventV2Bridge` 依赖
- `event-reducer.ts`：删除 `case "issue.progressed":`，保留 `issue.created/updated/deleted` 三个 case
- `linear-sync-history.tsx`：删除 `progress` signal、`setProgress`、进度显示 UI 和 `TODO plan-T17` 注释

### What this does NOT change

- `issue.created`/`issue.updated`/`issue.deleted` 三个事件保持不变
- `AutoProgress` 引擎的规则逻辑（Rule 1 + Rule 2）不变，只是不再发布独立的进度事件
- `patchStatus` 方法仍然存在并正常工作，状态变更通过 `issue.updated` 事件通知前端
- 前端 `refreshTodo()` 全量重拉机制不变

## Amendment 2026-07-17 — D6 revised: cloud-side deletion now implemented via Linear API

**Status:** Accepted (2026-07-17)
**Supersedes:** the "deletion by an explicit 'remove from local' action that lands in a follow-up ADR" clause of D6.

### Context

D6 originally deferred deletion handling to a follow-up ADR because the Linear MCP server did not expose an archive/delete Issue tool. The clause read: "deletion by an explicit 'remove from local' action that lands in a follow-up ADR." At the time, the only options were to ignore cloud-side deletions entirely or to design a separate "remove from local" UI action.

Investigation during implementation found that Linear's `list_issues` (Linear MCP) returns archived issues by default (`includeArchived` defaults to true) and marks them with a non-null `archivedAt` timestamp. Linear's "delete" is semantically "archive" — the issue is soft-deleted on the cloud side but still queryable. This is sufficient to detect cloud-side deletion without a dedicated MCP archive tool.

### Decision

**Cloud-side deletion is now implemented in `SyncPull.pull`, not deferred.** The pull reconciles cloud-side archives into local deletions:

- For each linked local issue (`linear_issue_id` is not null), check whether the issue still exists in the cloud active set (non-archived, `archivedAt` is null).
- If the issue is archived or absent on Linear, the local row is deleted via `Issue.delete` (which also cascades to L2 children whose `parent_id` points to the deleted issue).
- The count is reported in `SyncPull.Result.deleted`.
- This sync is skipped when the batch `list_issues` call failed, to avoid spurious local deletions from a partial cloud list.

Cloud-side deletion is **pull-only**. There is no push-side deletion (the kernel does not archive Linear issues when a local linked issue is deleted). Local deletion of a Linear-sourced issue removes the local row only; the Linear issue remains on the cloud. This is intentional — the user's local truth wins for the local row, and Linear's truth wins for the cloud row.

### What this does NOT change

- D5's pull reconcile (cloud-wins for field-level updates on linked issues) is unchanged.
- D6's "no 'already up to date' skip" rule is unchanged — the pull still always runs.
- D6's UI text rule is unchanged — the result speaks via counts, including `deleted`.
- The `SyncPull.Result.deleted` field already existed in the schema; it is now populated by real deletions instead of always being 0.

## Amendment 2026-07-17 — Column rename: `linear_updated_at` → `last_pulled_at`

**Status:** Accepted (2026-07-17)
**Supersedes:** All references to `IssueTable.linear_updated_at` as a column name in this ADR (semantics unchanged; only the name changes).

### Context

The `linear_updated_at` column was introduced in the 2026-07-09 amendment as the pull-side change-detection watermark. The name was inconsistent with the push-side counterpart `last_pushed_at`: the former followed a `<source>_<action>_at` pattern while the latter followed a `last_<action>_at` pattern. Round-2 code review flagged the asymmetry as a readability hazard — readers expected the two columns to mirror each other's naming, and the `linear_` prefix was redundant given the column already lives on the Linear-linked `IssueTable`.

### Decision

The column is renamed from `linear_updated_at` to `last_pulled_at`. This aligns with `last_pushed_at` semantically (`last_<action>_at` for both push and pull watermarks) and drops the redundant source-qualified prefix.

- Drizzle schema (`issue.sql.ts`): `linear_updated_at: integer()` → `last_pulled_at: integer()`
- Zod schema, row mapping, create/update methods, and comments in `issue.ts` updated
- `sync-pull.ts` (9 references in field names, comparisons, JSDoc) and `sync-push.ts` (2 references in post-push DB writes) updated
- HTTP API schemas (`Issue`, `IssuePartial`) in `server/routes/instance/httpapi/groups/issue.ts` updated
- SDK regenerated via `./script/generate.ts` (both `packages/sdk/openapi.json` and `packages/sdk/js/src/v2/gen/*.gen.ts`)
- Migration `20260717043303_rename_linear_updated_at_to_last_pulled_at` (both the active TS migration in `packages/core/src/database/migration/` and the Drizzle Kit snapshot in `packages/opencode/migration/`) executes `ALTER TABLE \`issue\` RENAME COLUMN \`linear_updated_at\` TO \`last_pulled_at\`;` — SQLite preserves data and nullability. The TS migration is **idempotent**: it checks `PRAGMA table_info(\`issue\`)` for the existence of `linear_updated_at` before renaming, so fresh installs that never had the old column are not affected.
- Base migration `20260621201623_add_issue_table` was amended to create `last_pulled_at` directly (instead of `linear_updated_at`), so fresh installs get the final column name without needing the rename.
- Historical migration `20260708183506_add_issue_linear_updated_at` is left untouched (immutable history); the new migration carries the rename forward for existing installs

### What this does NOT change

- The column's semantic role (pull-side change-detection watermark storing cloud-side `updatedAt` at the time of the last pull)
- The pull reconcile logic (cloud-wins for Linear-sourced fields, three-state decision: INSERT/SKIP/UPDATE)
- The push contract (`last_pushed_at` watermark, field-level merge)
- The historical migration file name `20260708183506_add_issue_linear_updated_at` (immutable history; only its effect is renamed by the new migration)
