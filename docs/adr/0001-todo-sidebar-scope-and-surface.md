# ADR-0001: Todo sidebar — independent surface, new project-scoped store

**Status:** Accepted (grilling round 1, 2026-06-22)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude (grill-with-docs session)

## Context

The PRD (`/Users/tk/repositories/OpenCode-Feature/REQUIREMENTS.md` and `OPENCODE_LINEAR_INTEGRATION.md`) calls for a Linear-style todo system in the OpenCode Desktop sidebar with the following requirements:

- **Two-level hierarchy** (L1 sequential, L2 parallel) — feature does not validate ordering.
- **Linear-aligned statuses** (`Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`) and **priorities** (`Urgent`, `High`, `Medium`, `Low`, `No priority`). See Amendment 2026-07-19 for the 7-status set rationale.
- **Project/workspace scope** — each OpenCode directory maps to one project; items persist across sessions in that workspace.
- **Linear MCP is an add-on**, not a prerequisite. The sidebar must work standalone.

The implementation on the worktree branch (`feature/todo-sidebar-linear`, 21 commits) extended the **existing per-session** `TodoTable` (in `packages/opencode/src/session/session.sql.ts`) with hierarchy and Linear fields, and the **desktop sidebar slot** holds a single `<SidebarLinear>` component that gates on Linear configuration. CLAUDE.md at the workspace root says explicitly:

> The existing in-session todo system … is a single-session flat list — it is **not** the new feature. The new feature lives at the project/workspace scope, persists independently, and supports parent/child links and the full Linear status set. Reuse the patterns … but add new tables; do not repurpose `TodoTable`.

That instruction has been violated by the current worktree code. The desktop sidebar shows a Linear configuration panel that animates a fake 3-second sync and emits a hardcoded "Synced 1 item" success toast, with **no local-todo CRUD UI** and **no data path to the kernel** for sync.

## Decision

### D1 — Data model: new project-scoped table

The new feature owns a **separate** SQLite table keyed by `directory` (workspace), not by `session_id`. It does **not** share storage, types, or events with `TodoTable`. Concretely:

- **New file**: `packages/opencode/src/issue/issue.sql.ts` (or `workspace-todo.sql.ts` if we want to keep the word "todo"). Name pending — see Open Questions.
- **Schema**: `IssueTable { id, directory, parent_id, level, title, content, description, status, priority, labels, due_date, assignee_id, linear_issue_id, linear_team_id, linear_project_id, position, created_at, updated_at }`.
- **Service**: a new `Issue.Service` (Effect-based) with full CRUD, reorder, getTree, and `publish()` of `Issue.Updated` / `Issue.Created` / `Issue.Deleted` / `Issue.Progressed` events.
- **Migration**: a new Drizzle migration under `packages/opencode/migration/<ts>_issue_table/`. No data migration from `TodoTable` — the new system starts empty.

The existing in-session `TodoTable` is left untouched. The two systems can coexist; an agent in a session can read both, but a UI panel in the workspace sidebar only reads the new `IssueTable`.

### D2 — Sidebar surface: one section, two sub-panels

The desktop sidebar gets **one** section called `Todos` (or `Issues`, pending naming) that:

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
