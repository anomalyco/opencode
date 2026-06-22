# Glossary — Todo / Linear feature

Living document. Add a term the first time it's used in an ADR or design doc; expand the definition as understanding grows. The terms below cover the new feature on the `feature/todo-sidebar-linear` branch and the in-session todo system it sits next to.

## A

**Auto-progress** — The engine that advances L1 items to `In Progress` when the previous L1 is `Done`, and to `Done` when its own L2 children (if any) are all `Done`. Lives in `Issue/AutoProgress` (per ADR-0001). The user can toggle it on or off in the sidebar; the kernel continues to honour bus events while it is off, but does not publish `Issue.Progressed`.

## B

**Bus event** — A typed message published on the in-process bus (`@/bus`). For the new feature: `Issue.Created`, `Issue.Updated`, `Issue.Deleted`, `Issue.Progressed`. Subscribers (TUI sidebar, Desktop sidebar, auto-progress engine, future Slack notifier) attach to the events they care about. Events are scoped by `directory`.

## C

**Composer** — The rich-text input component reused for the issue title and description (`packages/app/src/pages/session/composer/`). Supports file references (`@file`) and skill references (`/skill`) per PRD §4. The new issue dialog reuses this component rather than building a new editor.

**Composer dock (`session-todo-dock`)** — The in-session todo panel mounted inside the composer. **Not the new feature.** It reads the in-session `TodoTable`. Users can confuse this with the new `Todos` sidebar section because both display todo-like items; the glossary entry exists to disambiguate.

**Configured** — A boolean in the sidebar UI: `Config.Info.linear` is non-null AND `linear.projectId` is set AND `linear.teamId` is set. Drives whether the Linear sub-panel is shown.

## D

**Directory** — The string OpenCode uses to identify a workspace on disk (a project folder). The new feature is keyed by `directory`. The kernel resolves it from the request context; the SDK sends it in the request body for typed routes. The phrase "workspace" and "directory" are interchangeable in the kernel; the UI uses "Workspace" in user-facing copy.

## F

**Fake handler** — A UI event handler that simulates an effect without calling the kernel. Example: `handlePull` in `sidebar-linear.tsx:53-72` (pre-ADR-0002). The contract codified in ADR-0002 D10 is: a fake handler is a **defect**, not a stub. Either call the real API or delete the handler.

## I

**Issue** — The noun for an item in the new feature. The kernel's TypeScript namespace is `Issue` (per ADR-0001's open question — pending naming confirmation). At the SQL layer the table is `issue_table`. At the wire / SDK layer the type is `Issue.Info` and the route prefix is `/issue/*`. Maps 1-to-1 to Linear's `Issue` concept but is independent of Linear — an `Issue` exists locally with or without Linear.

**IssueTable** — The Drizzle SQLite table for the new feature. Columns: `id, directory, parent_id, level, title, content, description, status, priority, labels, due_date, assignee_id, linear_issue_id, linear_team_id, linear_project_id, position, last_pushed_at, created_at, updated_at`. Keyed by `directory`, not by `session_id`.

**Issue.Service** — The Effect-based service exposing CRUD on `IssueTable`. Mirrors `Session.Todo.Service`'s shape (`get`, `create`, `update`, `delete`, `patchStatus`, `reorder`, `getTree`) but takes `directory` instead of `sessionID` and operates on the Linear-aligned status enum.

## L

**L1 / L2** — Hierarchy levels. L1 = parent items, processed **sequentially** — the user/agent decides order; the feature does not validate it. L2 = child items, processed **in parallel** — all L2 children of an L1 are required for that L1 to be considered complete. Stored as `level` (0 for L1, 1 for L2) plus a `parent_id` pointer.

**Linear** — The external SaaS product at linear.app. Integrated via the official remote MCP server at `https://mcp.linear.app/sse`. Authentication via OAuth; tokens stored in the kernel DB. Linear is an **add-on** to the new feature, not a prerequisite (per ADR-0001).

**Linear-aligned statuses** — `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`. The full Linear set; the new feature does not subset it. Persisted in `IssueTable.status` as snake_case strings (`backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`); the zod schema presents them in PascalCase.

**Linear-aligned priorities** — `Urgent`, `High`, `Medium`, `Low`, `No priority`. Persisted as snake_case strings; the zod schema uses PascalCase.

**Linear MCP** — The remote MCP server at `https://mcp.linear.app/sse`. Discovered and connected by OpenCode's existing MCP client in `packages/opencode/src/mcp/`. Tools (`create_issue`, `update_issue`, `list_issues`, …) are exposed to the agent; the kernel's `LinearMcpClient` (`packages/opencode/src/linear/mcp-client.ts`) wraps the same client for the sync engines.

**Linear sub-panel** — The collapsible section inside the new `Todos` sidebar that shows connection state, last sync, and the sync history. Hidden when the workspace is not configured for Linear. Always subordinate to `Todos` — never rendered standalone.

## P

**Project mapping** — The `Config.Info.linear` block in `.opencode/config.json`: `{ projectId, teamId, syncMode }`. Optional. When set, the kernel reads it on every sync. When unset, the Linear sub-panel is hidden and the sync buttons are not shown — but the rest of the sidebar is fully functional.

**Pull (snapshot import)** — A one-way operation that reads active Linear issues and inserts any not already locally linked. Per ADR-0002 D5: leaves existing local rows alone. The kernel returns `{ pulled, skipped, failed, ids, errors }`. The UI shows the counts, never says "Already up to date."

**Push** — A one-way operation that writes locally-changed fields back to Linear. Operates only on rows with a `linear_issue_id`. Per ADR-0002 D8: uses a per-row `last_pushed_at` (or per-directory watermark) to skip rows that haven't changed since the last push.

## S

**Sidebar** — The vertical panel on the left of the OpenCode Desktop window. Hosts the project list, session list, and section panels. After ADR-0001, hosts the new `Todos` section that always renders and contains the `Linear` sub-panel as an internal collapsible.

**Snapshot import** — See Pull.

**Sync** — Umbrella term for `pull` and `push`. Sync is bidirectional in name; each direction is one-way and idempotent (per ADR-0002).

**Sync history** — A UI-only ledger in the sidebar (the `LinearSyncHistory` component) recording past operations with timestamp, count, and status. Not a system of record; the kernel does not read it. The user can collapse the panel to hide it.

**Sync mode** — The `Config.Info.linear.syncMode` field. Values: `manual` (default) or `auto` (deferred). In `manual` mode, sync only happens when the user clicks a button. In `auto` mode, the kernel will pull on a debounced timer after `Issue.Updated` events. The `auto` implementation is out of scope for ADR-0002.

## T

**Todo (`TodoTable`, in-session)** — The pre-existing per-session todo system in `packages/opencode/src/session/todo.ts` and `session.sql.ts`. Used by the agent loop for in-session plans (the things the agent will do _right now_ in this session). **Not the new feature.** The two systems coexist: a session can have a `TodoTable` plan AND the workspace can have `IssueTable` items. The UI is responsible for not confusing the user about which is which.

**Todos (sidebar section)** — The new sidebar section (per ADR-0001 D2). Lists `IssueTable` rows for the current workspace. Always renders. Contains the Linear sub-panel when configured.

## W

**Workspace** — User-facing synonym for `directory` in the OpenCode Desktop app. See Directory.
