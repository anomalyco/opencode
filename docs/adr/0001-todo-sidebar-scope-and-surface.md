# ADR-0001: Todo sidebar — independent surface, new project-scoped store

**Status:** Accepted (grilling round 1, 2026-06-22)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude (grill-with-docs session)

## Context

The PRD calls for a Linear-style todo system in the OpenCode Desktop sidebar with the following requirements:

- **Two-level hierarchy** (L1 sequential, L2 parallel) — feature does not validate ordering.
- **Linear-aligned statuses** (`Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`) and **priorities** (`Urgent`, `High`, `Medium`, `Low`, `No priority`). See Amendment 2026-07-19 for the 7-status set rationale.
- **Project/workspace scope** — each OpenCode directory maps to one project; items persist across sessions in that workspace.
- **Linear MCP is an add-on**, not a prerequisite. The sidebar must be able to work standalone.

The implementation on the worktree branch (`feature/todo-sidebar-linear`) has nothing to do with the **existing per-session** `TodoTable` (in `packages/opencode/src/session/session.sql.ts`) with hierarchy and Linear fields, and the **desktop sidebar slot** holds a single `<SidebarLinear>` component that gates on Linear configuration.

> The existing in-session todo system … is a single-session flat list — it is **not** the new feature. The new feature lives at the project/workspace scope, persists independently, and supports parent/child links and the full Linear status set. Reuse the patterns … but add new tables; do not repurpose `TodoTable`.

## Decision

### D1 — Data model: new project-scoped table

The new feature owns a **separate** SQLite table keyed by `directory` (workspace), not by `session_id`. It does **not** share storage, types, or events with `TodoTable`. Concretely:

- **New file**: `packages/opencode/src/issue/issue.sql.ts` (or `workspace-todo.sql.ts` if we want to keep the word "todo"). Name pending — see Open Questions.
- **Schema**: `IssueTable { id, directory, parent_id, level, title, content, description, status, priority, labels, due_date, assignee_id, linear_issue_id, linear_team_id, linear_project_id, position, created_at, updated_at }`.
- **Service**: a new `Issue.Service` (Effect-based) with full CRUD, reorder, getTree, and `publish()` of `Issue.Updated` / `Issue.Created` / `Issue.Deleted` / `Issue.Progressed` events.
- **Migration**: a new Drizzle migration under `packages/opencode/migration/<ts>_issue_table/`. No data migration from `TodoTable` — the new system starts empty.

The existing in-session `TodoTable` is left untouched. The two systems can coexist; an agent in a session can read both, but a UI panel in the workspace sidebar only reads the new `IssueTable`.

### D2 — Sidebar surface: one section, two sub-panels

The desktop sidebar gets **one** section called `Todos` (or `Issues`, aligned with Linear) that:

- **Always renders** when a workspace is open, regardless of Linear configuration.
- Lists the workspace's items with status indicators, L1/L2 indentation, and per-row actions (status cycle, edit, delete, add child, drag-reorder).
- Has a header button group: **+ New**, **Auto-Progress on/off**, **Sync with Linear** (only visible when Linear is configured), **Configure Linear** (only when not configured), and the history toggle.

When Linear is configured, a **Linear sub-panel** sits inside the Todos section (collapsible), showing connection status, last sync time, and the sync history list. When not configured, the Linear sub-panel is hidden entirely — the user never sees a "Not configured" dead-end; they only see a "Connect Linear" affordance in the section header.

Concretely, the layout becomes:

```
┌─────────────────────────────────┐
│ ▼ Todos          [+ New] [⚙]    │  ← always visible
│   ◯ L1 Item A           ⋯       │
│     ◯ L2 child 1         ⋯      │
│     ◯ L2 child 2         ⋯      │
│   ● L1 Item B (in_progress) ⋯   │
│   ▶ Linear                  [▸] │  ← sub-panel, hidden if not configured
│     ● Connected · manual        │
│     [Sync ↑] [Pull ↓] [History] │
└─────────────────────────────────┘
```

### D3 — Affordance: full CRUD + auto-progress, no Linear required

The Todos section supports the full lifecycle on its own:

- **Read**: list of all items in the workspace, grouped/sorted with L1 above L2, status coloured.
- **Add**: "+ New" button opens a dialog (reuses the existing composer for title + rich description with file/skill references, per PRD §4).
- **Edit**: per-row menu or inline edit; status cycle (clicking the status icon), priority cycle, label editor, due date, assignee.
- **Delete**: per-row action with confirm.
- **Reorder**: drag-to-reorder within L1; nested L2 items can be reparented.
- **Status change**: manual override always wins over auto-progress.
- **Auto-progress on/off**: a single toggle in the section header. When on, the engine watches `Issue.Updated` and advances L1 items as their L2 children complete. The engine lives in the new `Issue` domain, not in `Session/AutoProgress`.

When Linear is configured, the section **additionally** exposes **Sync ↑ (push)** and **Pull ↓ (pull)** that call the real kernel routes (not animated fakes). These are _additive_ — the section does not require them to be useful.

### D4 — Sync architecture (deferred to round 2 ADR)

The fake `handleSync` / `handlePull` in `sidebar-linear.tsx` (the 3-second `requestAnimationFrame` + `record({ count: 1 })` shim) must be replaced with real calls to the kernel. The data path will be:

- Desktop UI → `globalSDK.client.issue.syncPull({ directory })` and `globalSDK.client.issue.syncPush({ directory })` (new SDK methods; the SDK is regenerated from the kernel's Hono routes).
- Kernel → `SyncPull.pull({ directory })` and `SyncPush.push({ directory })` (rewritten to take a `directory` and a `SessionID | null` for event emission).
- The kernel endpoints get added to the existing instance route surface under `packages/opencode/src/server/instance/issue.ts`.

The full design is in **ADR-0002** (next file in this round).

## Consequences

### Positive

- The PRD's "Linear is an add-on" principle is now literally true: removing the Linear sub-panel does not break the sidebar.
- The new system can evolve its schema (parent/child, statuses, priorities) without touching the in-session todo system that the agent loop depends on.
- The existing TUI sidebar (`sidebar-todo.tsx` for in-session + `feature-plugins/sidebar/linear.tsx` for Linear) does not need to be rewritten to match the Desktop UI; the TUI and Desktop are allowed to ship independent surfaces until TUI parity is scheduled.

### Negative / costs

- **Code to revert or migrate**: the worktree's `feat(todo): extend Todo.Info schema with hierarchy + Issue fields` commit and downstream work (auto-progress, granular tools, sync engines) is mostly reusable but must be **moved** to a new `Issue` module. `TodoTable` should be reverted to its pre-feature state.
- **Naming churn**: the existing UI strings say "Todo"; the new domain model might be called `Issue`. We have to pick one and either rename the UI strings or rename the new model. See Open Questions.
- **SDK regen**: adding new routes requires regenerating `packages/sdk/openapi.json` and the JS SDK. That's a one-time cost; the script (`./script/generate.ts`) is already wired.
- **Two sync semantics**: in-session todos are **not** the new feature. If the user later asks "where are my workspace todos?", we must be precise in the answer — they're in `IssueTable`, not in any session's `TodoTable`.

### Neutral

- Auto-progress moves from per-session to per-workspace. The PRD already implies this (auto-progress applies to the project's items, not a single session's plan).

## Open Questions

1. **Name of the new domain model** — `Issue` (mirrors Linear), `WorkspaceTodo` (clear scope), `Task`, or keep `Todo`? Recommendation: `Issue` in the kernel (the noun is cleaner and matches the Linear mapping), keep `Todo` in user-facing copy until the next i18n pass. **Owner: user, blocking D1 implementation.**
2. **Where to emit `Issue.Updated` from the auto-progress engine** — the engine in `Session/AutoProgress` was session-scoped; the new engine is workspace-scoped. We will move it to `Issue/AutoProgress`. **Owner: implementation, no decision needed.**
3. **How does an agent in a session create an `Issue`?** Either through a new `tool/issue.ts` (mirroring `tool/todo.ts` but for the new model) or by extending the existing `tool/todo.ts` to optionally write to `IssueTable` when called with a workspace flag. Recommendation: **new `tool/issue.ts`**, keep `tool/todo.ts` unchanged. **Owner: implementation, no decision needed but flagged for the agent-tooling grilling later.**

## Notes for the next round

Issue 2 — the "Already up to date (1 already synced)" phantom — is a downstream symptom of the same root cause. The fake handlers in `sidebar-linear.tsx` were the only thing the user could click. Once D4 (real kernel routes) lands, the phantom disappears naturally. The bug class to call out in ADR-0002 is: **any UI handler that simulates an effect rather than calling the kernel is a defect**, not a stub. We should add a lint rule or a "no-op handler" code-review checklist item to catch future instances.

## Amendment 2026-07-12 — Priority i18n keys 不需要中文翻译

**Status:** Accepted (2026-07-12)

### Context

`sidebar.issue.priority.*` (none/urgent/high/medium/low) 这 5 个 i18n key 被 `sidebar-todo.tsx` 和 `dialog-edit-todo.tsx` 通过 `language.t(\`sidebar.issue.priority.${p}\`)` 调用，但在所有 locale 文件中缺失，导致 UI 显示原始 key 字符串而非本地化文案。

### Decision

**Priority 值不需要中文翻译（也不需要其他语言翻译）。** 这些值是 Linear 标准术语，全球通用，直接显示英文即可。仅在 `en.ts` 中定义英文值作为 fallback，不添加到其他 locale 文件。

i18n key 定义（仅 en.ts）：

- `sidebar.issue.priority.none` = "None"
- `sidebar.issue.priority.urgent` = "Urgent"
- `sidebar.issue.priority.high` = "High"
- `sidebar.issue.priority.medium` = "Medium"
- `sidebar.issue.priority.low` = "Low"

### Rationale

Priority 值是 Linear App 原生使用的英文术语，在所有语言中保持一致。与 status（Linear 团队可自定义状态名，需动态获取）不同，priority 是固定的 5 个值，不需要本地化。

## Amendment 2026-07-17 — Linear GraphQL HTTP bypass for null-field clearing

**Status:** Accepted (2026-07-17)
**Supersedes:** the "Linear MCP is the integration point; the agent layer needs no code changes" clause in §Context, limited to the null-field-clearing case described below.

### Context

ADR-0001 §Context and §Decision state that "Linear MCP is the integration point" and that "code changes are confined to: kernel data model, server routes, SDK regeneration, and the Desktop UI sidebar slot." A direct Linear HTTP client in the kernel was therefore out of scope.

During implementation, a concrete limitation in the Linear MCP `save_issue` tool was discovered: its `inputSchema` declares `dueDate` as a pure `string` (no `null` in `anyOf`). This means:

- Passing `dueDate: null` is rejected by MCP-level Zod validation.
- Passing `dueDate: ""` is silently ignored by Linear (the field is not cleared).
- The underlying Linear GraphQL `issueUpdate` mutation DOES accept `dueDate: null` to clear the field.

As a result, users cannot clear a due date (or other fields with the same schema limitation) via the MCP path alone. The local row would show an empty due date, but the Linear issue would retain the old value, causing sync drift on the next pull.

### Decision

**A direct Linear GraphQL HTTP client is allowed in the kernel, but ONLY for clearing fields that the Linear MCP `save_issue` tool cannot clear due to its schema declaring the field as a non-nullable `string`.** The bypass:

- Lives in `packages/opencode/src/issue/sync-push.ts` as `clearDueDateViaGraphQL`.
- Uses `HttpClient.HttpClient` (Effect's HTTP client) — not raw `fetch`.
- Authenticates via the `LINEAR_API_KEY` environment variable.
- Calls `POST https://api.linear.app/graphql` with `mutation issueUpdate(id, input: { dueDate: null })`.
- Is invoked from the push path ONLY when `due_date` is in the dirty field set AND the local value is empty — the MCP `save_issue` call is still made for all other fields first.

This is a **narrow, justified exception** to the MCP-only integration rule. It does not open the door to arbitrary Linear HTTP calls. Any future field-clearing bypass must be documented here with the same justification (MCP schema rejects `null`, GraphQL accepts it).

### What this does NOT change

- The Linear MCP server remains the integration point for all create/update/read operations that the MCP schema supports.
- The agent layer still needs no code changes — agents discover Linear tools through the existing MCP system.
- The bypass is kernel-internal; the Desktop UI and SDK are unaware of it.
- All other Linear interactions (list, get, save_issue for non-null fields, list_users, list_issue_statuses) go through MCP.

## Amendment 2026-07-19 — Status set clarification and TodoPopover surface

**Status:** Accepted (2026-07-19)
**Supersedes:** §Context line listing 6 statuses (adds `Duplicate`); §D3 status-cycle bullet (clarifies the 7-status set).

### Context

ADR-0001 §Context and §D3 originally listed 6 Linear-aligned statuses: `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`. The implemented Linear MCP integration surfaced a 7th status, `Duplicate`, returned by `list_issue_statuses` for Linear teams that have it configured. A round-2 spec review flagged this as a drift between the ADR and the implementation. This amendment records the canonical 7-status set.

Additionally, the round-2 review flagged `packages/app/src/components/todo-popover.tsx` as a "scope-creep" component because no ADR mentioned it. The component is in fact the **session-header Todo panel entry point** — a popover-style mirror of the sidebar's Todo section, rendered inside `session-header.tsx` (used in both v1 and v2 layouts). It exists because the sidebar is collapsed by default in some layouts, and the session header needs a quick-access affordance to view/create/edit todos without switching panels. This amendment documents it so it is no longer an undocumented surface.

### Decision

#### Status set — 7 Linear-aligned statuses

The canonical status set is:

1. `Backlog`
2. `Todo`
3. `In Progress`
4. `In Review`
5. `Done`
6. `Canceled`
7. `Duplicate`

The kernel uses these literal strings directly (no state mapping), per the project memory constraint. `Duplicate` is treated as a terminal/archived status (same as `Done` / `Canceled`) — `isArchived(status)` returns `true` for it. ADR-0001 §Context and §D3 are updated in place to reflect this; the previous 6-status wording is superseded.

#### TodoPopover — session-header surface

`packages/app/src/components/todo-popover.tsx` is the documented session-header Todo surface. It:

- Renders inside `packages/app/src/components/session/session-header.tsx` via `<TodoPopover v2={false} />` (v1 layout) and `<TodoPopover v2={true} />` (v2 layout).
- Mirrors the sidebar's Todo panel content (same `useServerSync().todo` store, same Issue list, same add/edit/archive/delete affordances).
- Exists because the sidebar panel is collapsible and sometimes off-screen; the session header needs a quick-access entry point.
- Is NOT a separate feature — it is the same Todo surface rendered in a different location. All i18n keys, store bindings, and Issue API calls are shared with `sidebar-todo.tsx`.

The `v2` prop switches between v1 and v2 session-header styling (button shape, icon size, popover anchor). The underlying Issue list and actions are identical.

### What this does NOT change

- The sidebar Todo section (`packages/app/src/pages/layout/sidebar-todo.tsx`) remains the primary surface. The TodoPopover is a convenience mirror, not a replacement.
- The 7 statuses are passed through directly from Linear; the kernel does not validate or remap them.
- No new routes, no new SDK methods, no new migrations.

## Amendment 2026-07-20 — Agent layer now owns Linear routing (ADR-0005)

**Status:** Accepted (2026-07-20)
**Supersedes:**

- The "agent layer needs no code changes — agents discover Linear tools through the existing MCP system" bullet in Amendment 2026-07-17 §"What this does NOT change".
- The "narrow, justified exception" framing of the 2026-07-17 GraphQL bypass — the bypass is now the shared foundation for both user-side sync and the agent-side `linear_graphql` tool, not a one-off.

### Context

ADR-0005 (Agent-driven Linear MCP integration, 2026-07-20) records that the agent path previously had **no** Linear awareness: the 6 `issue_*` tools only wrote the local `IssueTable`, and sync was UI-driven only. This created 5 sync断層 (update / archive / delete / reorder / add) where agent edits to Linear-linked issues never reached Linear, and the local row drifted silently.

ADR-0005's 8 decisions (D1–D8) restructure the agent layer so that:

- Local `issue_update` / `issue_archive` / `issue_delete` **refuse** writes to Linear-linked issues (`IssueLinearLinkedError`).
- The agent uses Linear MCP `save_issue` for most edits, and `linear_graphql` for null-clearing and deletion — the same `LinearGraphqlClient.Service` the user-side sync path uses.
- A new `issue_sync` tool lets the agent trigger pull/push after editing Linear.
- Agent-facing tool outputs filter sync-internal bookkeeping (`last_pushed_at`, `last_pulled_at`, `cloud_shadow`) via `toAgentInfo`.

### Decision

The "agent layer needs no code changes" clause is **struck**. The agent layer now owns explicit Linear routing logic: 7 tools (`issue_list`, `issue_add`, `issue_update`, `issue_archive`, `issue_delete`, `issue_reorder`, `issue_sync`) plus `linear_graphql`, with `.txt` descriptions that guide the agent to MCP-first / GraphQL-fallback / `issue_sync`-reconcile.

The 2026-07-17 GraphQL bypass is no longer "narrow" — `LinearGraphqlClient.Service` is the shared transport for:

- User-side sync: `SyncPush.clearDueDateViaGraphQL` (clearing `dueDate` on push).
- Agent-side: the `linear_graphql` tool (clearing any field, deleting issues, arbitrary mutations MCP cannot express).

### What this does NOT change

- The Linear MCP server remains the integration point for all create/update/read operations that the MCP schema supports.
- The kernel still has no Linear-specific HTTP client outside `LinearGraphqlClient.Service`.
- The Desktop UI and SDK are unaware of the agent's Linear routing — the UI's Push/Pull buttons are unchanged.
- All other Linear interactions (list, get, save_issue for non-null fields, list_users, list_issue_statuses) go through MCP.

## Amendment 2026-07-20 (revised) — Agent and UI share the same edit-then-sync path (ADR-0005 D1/D2 superseded)

**Status:** Accepted (2026-07-20, same day as the previous amendment)
**Supersedes:** The previous "Amendment 2026-07-20 — Agent layer now owns Linear routing" above. That amendment was based on ADR-0005 D1/D2, which have since been superseded.

### Context

The previous amendment (accepted the same day) introduced `IssueLinearLinkedError` and the "agent must use Linear MCP for Linear-linked edits" routing. The user clarified later the same day that this was wrong: **the requirement is that both the user and the agent can directly operate on local Issues and Linear-linked Issues**. The refusal logic created an asymmetry where the user could edit Linear-linked issues locally (via UI) but the agent could not (it was forced into a two-call Linear MCP + `issue_sync pull` pattern).

### Decision

- The `IssueLinearLinkedError` class is deleted.
- The pre-check in `issue_update.ts` / `issue_archive.ts` / `issue_delete.ts` is removed.
- The agent and the UI now share the same edit path: write to the local `IssueTable`, then sync to Linear via Push (user clicks Push / agent calls `issue_sync push`).
- The `linear_graphql` agent tool is kept as an escape hatch (rare use: permanent Linear-side deletion).
- See ADR-0005 "Amendment 2026-07-20 — D1 and D2 are superseded" for the full rationale and affected files.

### What this keeps

- `LinearGraphqlClient.Service` remains the shared transport for `SyncPush.clearDueDateViaGraphQL` and the `linear_graphql` agent tool.
- `issue_sync` tool remains for agent-initiated push/pull.
- Agent-facing tool outputs still filter sync-internal bookkeeping (`last_pushed_at`, `last_pulled_at`, `cloud_shadow`) via `toAgentInfo`.
- The Linear MCP server remains the integration point for read/list operations.

## Amendment 2026-07-20 (round-2 review) — D1 getTree superseded, D2 persistent sidebar deferred

**Status:** Accepted (2026-07-20)
**Supersedes:**
- D1's "Service: … with full CRUD, reorder, getTree, and `publish()` …" — the `getTree` method is removed from the service contract.
- D2's "Always renders when a workspace is open" and the inline ASCII layout showing a persistent sidebar section — the persistent sidebar surface is deferred; only the toggle popover mounts in this iteration.

### Context

A round-2 spec review of the implemented feature flagged two drifts between ADR-0001 and the actual code:

1. **D1 `getTree`**: The ADR listed `getTree` as a service method. Subsequent amendments (see `2026-07-19-archived-issue-management-realignment.md` and the project memory entry "Linear二级Issue的树形组装在前端实现") moved tree assembly to the frontend. The kernel `Issue.Service` returns a flat list (`issue.get({ directory, include_archived })`); the desktop UI (`sidebar-todo.tsx`) assembles L1/L2 parent/child structure client-side. The `getTree` method was never implemented and is not needed.

2. **D2 persistent sidebar**: The ADR described a sidebar section that "always renders when a workspace is open" with an inline ASCII layout showing a `▼ Todos` panel. The implemented surface is a **toggle popover** (`packages/app/src/components/todo-popover.tsx`), mounted in the session header — not a persistent sidebar section. The user confirmed: "Todo Sidebar目前仅以 toggle popover 形式挂载，Sidebar in Layout 形态暂不实现。"

### Decision

- **D1 `getTree` is superseded.** The `Issue.Service` contract is: `create`, `get`, `update`, `delete`, `reorder`, `archive`. Tree assembly is a frontend concern. The ADR text "with full CRUD, reorder, getTree, and `publish()`" is corrected to "with full CRUD, reorder, and `publish()`".
- **D2 persistent sidebar is deferred.** The current iteration ships only the toggle popover surface (`todo-popover.tsx` mounted in `session-header.tsx`). The persistent sidebar section (the `▼ Todos` panel in the ASCII layout) is a follow-up, not in scope for this iteration. The ADR's "Always renders when a workspace is open" wording is corrected to "Renders on demand via a toggle popover in the session header; a persistent sidebar section is deferred to a follow-up iteration."
- **D3 composer reuse is confirmed complete** per Amendment 2026-07-19 (`2026-07-19-composer-reuse-refactor.md`). The Todo dialog reuses the shared `PromptPopover` presentational component plus the `AtOption` / `SlashCommand` types — the same dropdown the chat composer uses. The full `PromptInput` component is NOT reused (it is session-coupled and would require mocking ~10 contexts); this is a documented constraint, not a gap.

### What this does NOT change

- The data model (D1's `IssueTable` schema) is unchanged — only the `getTree` service method is removed from the contract.
- The Linear sub-panel (D2's collapsible panel inside the Todos section) is still deferred along with the persistent sidebar; the toggle popover surfaces Push/Pull via the popover's footer, not via a sidebar sub-panel.
- The 7 Linear statuses, priorities, and two-level hierarchy (L1/L2) are unchanged.
- Auto-progress has been removed entirely (see project memory: "Auto-progress engine is completely removed"); D3's "Auto-progress on/off" toggle is no longer part of the surface.

## Amendment 2026-07-20 (L2 reparenting + Configure Linear entry) — D3 reparent implemented, D2 Configure Linear entry not needed

**Status:** Accepted (2026-07-20)
**Supersedes:**
- D3's "Reorder: drag-to-reorder within L1; nested L2 items can be reparented" — the reparenting affordance is now implemented (previously only within-parent L2 reorder was wired; cross-parent reparent was deferred).
- The implicit assumption that a "Configure Linear" entry should be surfaced when Linear is not yet registered. This is **not needed**: the Linear sub-panel (`packages/app/src/pages/layout/sidebar-linear.tsx`) renders only when the Linear MCP server is connected (`mcpStatus() === true`), and the team/project configuration entry lives inside that sub-panel. There is no pre-registration configuration surface, and none is required.

### Context

A round-2 spec review flagged two items:

1. **D3 L2 reparenting**: The ADR listed "nested L2 items can be reparented" as a reorder affordance, but the initial implementation used nested `DragDropProvider`s per L1 — L2 drags were scoped to their parent's list and could not cross parent boundaries. The review flagged this as a spec gap.

2. **D2 Configure Linear entry**: The review suggested adding a configuration entry for when Linear is not yet registered. On inspection, this is unnecessary: the Linear sub-panel is already gated by MCP connection status (`Show when={mcpStatus()}`). When MCP is not connected (or the user has not completed OAuth), the sub-panel does not render, so there is no surface to host a "Configure Linear" entry. The configuration flow is: enable Linear MCP → OAuth → sub-panel appears → configure team/project inside the sub-panel.

### Decision

1. **D3 L2 reparenting — implemented.** The nested per-L1 `DragDropProvider`s are replaced with a single flat `DragDropProvider` covering both L1 and L2 rows. `makeTreeDragHandler` (in `sidebar-todo.tsx`) inspects the dragged and dropped ids, looks up their levels, and dispatches to one of:
   - L1 → L1: reorder within L1 (single `issue.reorder` call).
   - L2 → L2 same parent: reorder within parent (single `issue.reorder` call).
   - L2 → L2 different parent: reparent — `issue.update({ patch: { parent_id } })` then `issue.reorder` with the new parent's L2 id list.
   - L2 → L1: reparent — same two-step flow, appending the L2 to the target L1's L2 list.
   - L1 → L2: rejected (L1 cannot become an L2 child — ADR-0001 §3.2 two-level hierarchy).

   The server-side `Issue.update` already validates hierarchy on `parent_id` changes (target must be an L1 in the same directory, not self, not an L2), so no server changes were required.

2. **D2 Configure Linear entry — not needed.** No code changes. The existing `Show when={mcpStatus()}` gate in `sidebar-linear.tsx` (line 345) is the correct behavior: the Linear sub-panel only renders when MCP is connected and OAuth is complete. The team/project configuration entry lives inside the sub-panel (the settings-gear button at line 366-379). There is no pre-registration surface, and none is required.

### What this does NOT change

- The two-level hierarchy (L1/L2) is unchanged — L1 still cannot become an L2 child.
- The Linear sub-panel's connection gate (`mcpStatus()`) is unchanged.
- The team/project binding storage (workspace-scope `.opencode/linear-binding.json`) is unchanged.

## Amendment 2026-07-20 (Linear parent-child sync) — SyncPush two-phase CREATE + parentId dirty-checking via `linear_parent_id` shadow

**Status:** Accepted (2026-07-20, revised after end-to-end probe)
**Supersedes:** the initial "unconditional parentId for L2 UPDATEs" approach (which only worked for content-dirty L2s, not for the migration case where L2s were already linked but missing the Linear parent link).

### Context

Users reported that after creating 2 L1 issues (each with 2 L2 sub-issues) locally and pushing to Linear, all 6 issues appeared as **flat top-level Linear issues** — the parent-child hierarchy was not established on Linear.

**Two root causes** were identified through an end-to-end probe (creating BOR-40 as parent, BOR-41 as child with `parentId`, then `get_issue` on the child to verify `parentId: "BOR-40"` was persisted):

1. **CREATE path (initial push):** The SyncPush CREATE path pushed all local-only issues as a single concurrent batch with no `parentId` field. The Linear MCP `save_issue` tool **does** accept `parentId` (confirmed via `tools/list` probe — the field accepts "Parent issue ID or identifier (e.g., LIN-123). Null to remove"), but the code never set it.

2. **UPDATE path (re-push after fix):** The first fix attempt added `parentId` to the UPDATE call for L2 issues, but only when the L2 was in the `linkedDirty` cohort (content fields differed from `cloud_shadow`). If an L2 was already linked (had `linear_issue_id`) and its content hadn't changed, it was excluded from `linkedDirty` → never pushed → `parentId` never sent → Linear parent link never repaired. This is exactly the user's situation: 6 issues pushed with old code, then re-pushed with the first fix → nothing happened.

### Decision

SyncPush now establishes Linear parent-child links via three mechanisms:

#### 1. CREATE path — two-phase push

- **Phase 2a (L1):** Local-only L1 issues (level 0, no parent) are pushed first via `save_issue` without `parentId`. Their returned `linear_issue_id` values are collected into a `localIdToLinearId` map (seeded with already-linked issues from the `all` list).
- **Phase 2b (L2):** Local-only L2 issues (level 1, has parent) are pushed with `parentId` resolved from the parent's `linear_issue_id` via `localIdToLinearId`. If the parent is not linked (no `linear_issue_id` and not just created in Phase 2a), the L2 is skipped with a `parent_not_linked` error.

The two phases are sequential (`yield*` on Phase 2a before Phase 2b starts), ensuring all L1 `linear_issue_id` responses are available before L2 resolution begins.

#### 2. UPDATE path — `linear_parent_id` shadow dirty-checking

The key insight: `parent_id` (local UUID) and Linear's `parentId` (issue identifier, e.g., "BOR-40") are not directly comparable, so `parent_id` is NOT in `SHADOW_FIELDS`. Instead, a **derived** field `linear_parent_id` is tracked in the shadow:

- **`resolveLinearParentId(issue, all)`** — resolves the parent's `linear_issue_id` for an L2 issue (or null for L1 / unlinked parent).
- **`buildShadowWithParent(issue, all)`** — extends `Issue.buildShadow(issue)` with `linear_parent_id: resolveLinearParentId(issue, all)`. Used when writing `cloud_shadow` after both CREATE and UPDATE pushes.
- **`isParentLinkDirty(issue, shadow, all)`** — returns true if the L2's resolved `linear_parent_id` differs from `shadow.linear_parent_id`. Old shadows (pre-fix) lack this field → `undefined !== "BOR-40"` → dirty → re-pushed. This is the migration path for issues pushed before the fix.

The `linkedDirty` filter now includes an L2 if **either** content fields are dirty **or** the parent link is dirty:

```typescript
return diffShadow(i, shadow).length > 0 || isParentLinkDirty(i, shadow, all)
```

In the UPDATE call itself, if only the parent link is dirty (no content fields), the `save_args` contains just `id`/`team`/`project`/`parentId` — a minimal partial update. Linear treats this as setting only `parentId`, leaving other fields untouched.

#### 3. Pull path — shadow records cloud's `parentId`

`mapLinearFields` in `sync-pull.ts` now includes `linear_parent_id: i.parentId` in the `cloud_shadow` it writes. This ensures:

- After a pull, the shadow reflects the cloud's actual parent link state.
- If the user reparents locally after a pull, the next push detects the diff (local resolved parent ≠ cloud's `parentId`) and syncs the new parent to Linear.
- If cloud and local agree on the parent, no push is needed.

Per ADR-0002, pull still never overwrites local `parent_id` — hierarchy remains a local-only concern. The shadow merely records the cloud state for dirty-checking.

### Convergence guarantees

- **First push after fix (migration case):** L2s with old shadows (no `linear_parent_id`) are detected as parent-dirty → `parentId` sent → cloud establishes parent link → shadow updated with `linear_parent_id`. Converges in one push.
- **Steady state:** Local resolved parent matches `shadow.linear_parent_id` → no dirty → no push. Idempotent.
- **Local reparent:** User changes `parent_id` locally → resolved `linear_parent_id` changes → dirty → push → cloud updated → shadow updated. Converges in one push.
- **Cloud-side reparent (rare):** Someone changes the parent on linear.app → next pull records new `parentId` in shadow → local resolved parent differs → dirty → push → cloud updated to match local. Local-wins on hierarchy (per ADR-0002).

### What this does NOT change

- **SHADOW_FIELDS unchanged.** The 8 content fields (`title`, `content`, `description`, `status`, `priority`, `labels`, `due_date`, `assignee_id`) do not include `parent_id` or `linear_parent_id`. The latter is a derived field handled separately in the shadow JSON.
- **Pull doesn't overwrite local hierarchy.** `parent_id` (local UUID) is never set by pull. Only `cloud_shadow.linear_parent_id` records the cloud's `parentId` for dirty-checking.
- **Agent tools unchanged.** `issue_update` accepts `parent_id` for local reparenting; the agent doesn't know about `parentId` (Linear-side concern handled by SyncPush).
- **L1→L2 drag rejection unchanged.** L1 issues cannot become L2 children (two-level hierarchy).

### Edge cases handled

- **L2 whose parent is also local-only (CREATE):** Phase 2a creates the parent first, then Phase 2b resolves the parent's `linear_issue_id` from the map and passes it as `parentId`.
- **L2 whose parent is already linked (CREATE):** The `localIdToLinearId` map is seeded with all already-linked issues, so the parent's `linear_issue_id` is available without a Phase 2a create.
- **L2 whose parent failed to create (CREATE):** Phase 2b finds no `linear_issue_id` for the parent and skips the L2 with a `parent_not_linked` error.
- **L2 whose parent is not linked (UPDATE):** `resolveLinearParentId` returns null → `isParentLinkDirty` returns false → no parent-link push. The Linear issue remains top-level until the parent is pushed.
- **Old shadow without `linear_parent_id` (migration):** `shadow.linear_parent_id` is `undefined` → if parent is linked, `undefined !== "BOR-40"` → dirty → re-pushed with `parentId`. Converges in one push.
