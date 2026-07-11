# ADR-0001: Todo sidebar — independent surface, new project-scoped store

**Status:** Accepted (grilling round 1, 2026-06-22)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude (grill-with-docs session)

## Context

The PRD (`/Users/tk/repositories/OpenCode-Feature/REQUIREMENTS.md` and `OPENCODE_LINEAR_INTEGRATION.md`) calls for a Linear-style todo system in the OpenCode Desktop sidebar with the following requirements:

- **Two-level hierarchy** (L1 sequential, L2 parallel) — feature does not validate ordering.
- **Linear-aligned statuses** (`Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`) and **priorities** (`Urgent`, `High`, `Medium`, `Low`, `No priority`).
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
