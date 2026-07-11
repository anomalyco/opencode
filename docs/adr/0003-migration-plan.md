# ADR-0003: Migration plan — from extended `TodoTable` to a new `Issue` system

**Status:** Accepted (grilling session, 2026-06-22)
**Branch:** `feature/todo-sidebar-linear` (worktree at `opencode/.worktrees/feature/todo-sidebar-linear`)
**Deciders:** user, Claude (grill-with-docs session)
**Depends on:** ADR-0001, ADR-0002

## Context

ADR-0001 placed the new feature at workspace scope on a fresh `IssueTable`, and ruled out repurposing the in-session `TodoTable`. ADR-0002 specified the sync data path (`directory`, snapshot import, always-runs, real SDK calls). The two ADRs together imply a significant rearrangement of the worktree's current code, but they do not specify the order of operations or how to keep the build green at each step.

This ADR is the playbook. It maps every file the worktree touched to one of three buckets: **revert**, **move**, **add fresh**. It sequences the work so the build is green and the tests pass after every commit, and it records the reversibility rules so a single bad commit can be backed out without unravelling the rest.

The migration happens entirely on the `feature/todo-sidebar-linear` branch. A new sub-branch `feature/todo-sidebar-linear-issue-migration` is created off it; each step lands as one commit on the sub-branch. The sub-branch is force-pushed back to `feature/todo-sidebar-linear` once the whole sequence is green. The PR against `dev` includes the full sequence with a "Migrate from extended `TodoTable` to `Issue`" commit message and references this ADR.

## Inventory — what the worktree has today

Mapped from `git log --oneline` on the worktree (21 commits ahead of `origin/dev`):

### Files that must REVERT to pre-feature state

| File                                                         | Why it reverts                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/session/session.sql.ts` (`TodoTable`) | The new columns (`parent_id`, `level`, `title`, `description`, `labels`, `due_date`, `team_id`, `project_id`, `assignee_id`, `linear_issue_id`) belong to the new `Issue` system, not the in-session todo. They are removed. |
| `packages/opencode/src/session/todo.ts`                      | The new `replaceAll`, `getTree`, hierarchy helpers, and `linear_issue_id`/`team_id`/`project_id` plumbing are dropped. `Todo.Service` shrinks back to its pre-feature CRUD on a flat per-session list.                       |

### Files that MOVE to a new `issue/` module

| From                                                                                | To                                                                                 | Why                                                                                                                             |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/linear/mcp-client.ts`                                        | `packages/opencode/src/issue/mcp-client.ts`                                        | The wrapper is not Linear-specific; rename only.                                                                                |
| `packages/opencode/src/linear/sync-pull.ts`                                         | `packages/opencode/src/issue/sync-pull.ts`                                         | Function body is rewritten to take `directory` and target `IssueTable`.                                                         |
| `packages/opencode/src/linear/sync-push.ts`                                         | `packages/opencode/src/issue/sync-push.ts`                                         | Same.                                                                                                                           |
| `packages/opencode/src/linear/tool-names.ts`                                        | `packages/opencode/src/issue/tool-names.ts`                                        | Rename only.                                                                                                                    |
| `packages/opencode/src/linear/README.md`                                            | `packages/opencode/src/issue/README.md`                                            | Path update only.                                                                                                               |
| `packages/opencode/src/linear/{mcp-client,sync-pull,sync-push,integration}.test.ts` | `packages/opencode/src/issue/{mcp-client,sync-pull,sync-push,integration}.test.ts` | Path update; test bodies are rewritten to use `Issue.Service` instead of `Todo.Service`.                                        |
| `packages/opencode/src/session/auto-progress.ts`                                    | `packages/opencode/src/issue/auto-progress.ts`                                     | Engine is rewritten to take `directory` (not `sessionID`) and to subscribe to `Issue.Event.Updated` (not `Todo.Event.Updated`). |
| `packages/opencode/test/session/auto-progress.test.ts`                              | `packages/opencode/test/issue/auto-progress.test.ts`                               | Same.                                                                                                                           |

The old `packages/opencode/src/linear/` directory is **deleted** once its files are moved (step 10).

### Files that REPLACE old with new in place

| Old                                                                     | New                                                                                                                                                           | Why                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/tool/todo.ts` (unchanged from pre-feature)       | (kept)                                                                                                                                                        | The original `TodoWriteTool` is the right shape for the in-session todo. Kept.                                                            |
| `packages/opencode/src/tool/todo_add.ts`                                | **deleted**                                                                                                                                                   | Granular in-session tools are an artefact of the bad design. The in-session todo keeps a single `todo` (write) tool.                      |
| `packages/opencode/src/tool/todo_update.ts`                             | **deleted**                                                                                                                                                   | Same.                                                                                                                                     |
| `packages/opencode/src/tool/todo_delete.ts`                             | **deleted**                                                                                                                                                   | Same.                                                                                                                                     |
| `packages/opencode/src/tool/todo_assign.ts`                             | **deleted**                                                                                                                                                   | Same.                                                                                                                                     |
| `packages/opencode/src/tool/auto_progress.ts`                           | **renamed** to `packages/opencode/src/tool/issue_auto_progress.ts`, body rewritten to invoke `Issue.AutoProgress.Service.start/stop/status` with `directory`. | Old tool targeted `sessionID`; new tool targets `directory`.                                                                              |
| `packages/app/src/pages/layout/sidebar-linear.tsx`                      | (rewritten in place)                                                                                                                                          | Replace fake handlers (D9) with real `globalSDK.client.issue.*` calls. Add the `SidebarTodo` parent and re-shape as the Linear sub-panel. |
| `packages/app/src/components/dialog-edit-todo.tsx`                      | (rewritten in place)                                                                                                                                          | Submit handler is currently a no-op (per the domain analysis "anomalies"); wire to real `globalSDK.client.issue.update`.                  |
| `packages/app/src/components/dialog-linear-config.tsx`                  | (rewritten in place)                                                                                                                                          | Hardcoded empty `<Select>` options replaced with a real `linear.listTeams` / `linear.listProjects` MCP call.                              |
| `packages/app/src/components/linear-sync-history.tsx`                   | (rewritten in place)                                                                                                                                          | Drop the in-module `entries` `createSignal` shim; read from a real sync-history store populated by the kernel route response.             |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/linear.tsx`  | (rewritten in place)                                                                                                                                          | Reads from `api.state.issue` (a new `TuiState` accessor added per D7), not from the `linear:*` KV keys.                                   |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/todo.tsx`    | (rewritten in place)                                                                                                                                          | Becomes the in-session only view; new sibling `sidebar-issue.tsx` is added.                                                               |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/linear/commands.tsx` | (rewritten in place)                                                                                                                                          | Real `/linear-push` and `/linear-pull` wired to the new kernel routes.                                                                    |
| `packages/opencode/src/cli/cmd/tui/command/linear.ts`                   | (rewritten in place)                                                                                                                                          | Real route calls.                                                                                                                         |
| `packages/opencode/src/cli/cmd/tui/plugin/internal.ts`                  | (edited)                                                                                                                                                      | Add `SidebarIssue`; reorder slots.                                                                                                        |
| `packages/app/src/pages/layout.tsx:2299`                                | (edited)                                                                                                                                                      | Slot `SidebarTodo` in the workspace panel; demote `SidebarLinear` to be its sub-panel.                                                    |

### Files that ADD FRESH

| Path                                                                               | Purpose                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/issue/issue.sql.ts`                                         | Drizzle schema for `IssueTable`.                                                                                                                                                                                                                                                                                                                |
| `packages/opencode/src/issue/issue.ts`                                             | `Issue.Service` (CRUD on `IssueTable`, `directory`-scoped).                                                                                                                                                                                                                                                                                     |
| `packages/opencode/src/issue/events.ts`                                            | `Issue.Event.{Created,Updated,Deleted,Progressed}`.                                                                                                                                                                                                                                                                                             |
| `packages/opencode/src/issue/auto-progress.ts`                                     | Workspace-scoped auto-progress engine.                                                                                                                                                                                                                                                                                                          |
| `packages/opencode/src/issue/sync-pull.ts`                                         | Snapshot import; takes `directory`; targets `IssueTable`.                                                                                                                                                                                                                                                                                       |
| `packages/opencode/src/issue/sync-push.ts`                                         | Inverse push; per-row `last_pushed_at`.                                                                                                                                                                                                                                                                                                         |
| `packages/opencode/src/issue/mcp-client.ts`                                        | Wrapper around the existing MCP client.                                                                                                                                                                                                                                                                                                         |
| `packages/opencode/src/issue/tool-names.ts`                                        | Linear tool name constants.                                                                                                                                                                                                                                                                                                                     |
| `packages/opencode/src/issue/{mcp-client,sync-pull,sync-push,integration}.test.ts` | Tests for the above.                                                                                                                                                                                                                                                                                                                            |
| `packages/opencode/src/tool/issue.ts`                                              | Single `issue` (write) tool mirroring `tool/todo.ts`.                                                                                                                                                                                                                                                                                           |
| `packages/opencode/src/tool/issue_add.ts`                                          | Granular add.                                                                                                                                                                                                                                                                                                                                   |
| `packages/opencode/src/tool/issue_update.ts`                                       | Granular update.                                                                                                                                                                                                                                                                                                                                |
| `packages/opencode/src/tool/issue_delete.ts`                                       | Granular delete.                                                                                                                                                                                                                                                                                                                                |
| `packages/opencode/src/tool/issue_reorder.ts`                                      | Drag-reorder.                                                                                                                                                                                                                                                                                                                                   |
| `packages/opencode/src/tool/issue_auto_progress.ts`                                | `start`/`stop`/`status` of the workspace engine.                                                                                                                                                                                                                                                                                                |
| `packages/opencode/src/server/instance/issue.ts`                                   | Routes: `POST /issue/create`, `POST /issue/update`, `POST /issue/delete`, `POST /issue/reorder`, `GET /issue/list`, `POST /issue/sync/pull`, `POST /issue/sync/push`, `POST /issue/auto-progress/start`, `POST /issue/issue/auto-progress/stop`, `GET /issue/auto-progress/status`. Each carries `describeRoute` + `operationId` per CLAUDE.md. |
| `packages/opencode/migration/<ts>_add_issue_table/`                                | Drizzle migration: `CREATE TABLE issue (...)`. Generated via `bun run --cwd packages/opencode run db generate --name add_issue_table`.                                                                                                                                                                                                          |
| `packages/opencode/migration/<ts>_drop_todo_linear_columns/`                       | Follow-up migration that drops the now-unused `todo.{parent_id, level, title, description, labels, due_date, team_id, project_id, assignee_id, linear_issue_id}` columns. Generated by reverting `session.sql.ts` and re-running `bun --cwd packages/opencode run db generate --name drop_todo_linear_columns`.                                 |
| `packages/app/src/pages/layout/sidebar-todo.tsx`                                   | The new always-renders `Todos` section per ADR-0001 D2.                                                                                                                                                                                                                                                                                         |
| `packages/app/src/pages/layout/sidebar-todo-item.tsx`                              | One row in the list.                                                                                                                                                                                                                                                                                                                            |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/issue.tsx`              | TUI analogue of the Desktop `SidebarTodo`.                                                                                                                                                                                                                                                                                                      |
| `packages/plugin/src/tui.ts` (extension)                                           | Add `TuiState.issue(directory)` accessor.                                                                                                                                                                                                                                                                                                       |

## Sequence — ten steps, each a single commit, each green

The principle is **additive first, swap second, remove last**. Steps 1–7 add the new system without removing anything. Step 8 wires the new UI. Step 9 swaps the engine. Step 10 deletes the dead code. At every step the build is green (`bun typecheck`), the in-session todo system still works, and the new system is either absent or fully functional.

| #   | Commit message                                                                           | Files touched                                                                                                                                                                                                                                                                                                                                                                                                                                      | What is green after                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `feat(issue): add IssueTable schema + migration`                                         | `issue/issue.sql.ts` (new), `migration/<ts>_add_issue_table/*` (new), `drizzle/*` (snapshot).                                                                                                                                                                                                                                                                                                                                                      | `bun --cwd packages/opencode typecheck`, `bun --cwd packages/opencode run db generate` produces a clean diff, existing `Todo` CRUD still works.                                                      |
| 2   | `feat(issue): add Issue.Service with CRUD + bus events`                                  | `issue/issue.ts` (new), `issue/events.ts` (new), `effect/app-runtime.ts` (add `Issue.defaultLayer`).                                                                                                                                                                                                                                                                                                                                               | New `Issue.Service` is constructable; the layer composes with the rest of the runtime. Existing `Todo.Service` untouched.                                                                            |
| 3   | `chore(linear): move mcp-client + tool-names into issue/ (rename only)`                  | `linear/mcp-client.ts` → `issue/mcp-client.ts`; `linear/tool-names.ts` → `issue/tool-names.ts`; tests move too. `linear/` directory is **not** deleted yet; `issue/` is a re-export shim that re-exports from the old path so `sync-pull`/`sync-push` keep compiling.                                                                                                                                                                              | Everything still works; the names now live in the right module.                                                                                                                                      |
| 4   | `feat(issue): rewrite sync-pull + sync-push to take { directory } and target IssueTable` | `issue/sync-pull.ts` (rewritten from `linear/sync-pull.ts`), `issue/sync-push.ts` (rewritten from `linear/sync-push.ts`), `linear/sync-pull.ts` deleted, `linear/sync-push.ts` deleted. The shim in `linear/` now re-exports from `issue/`.                                                                                                                                                                                                        | The new sync functions exist with the right shape; old call sites (TUI commands, registry) keep importing from `linear/` and get the new behavior. Tests against the new `sync-pull/sync-push` pass. |
| 5   | `feat(issue): add Issue.AutoProgress (workspace-scoped)`                                 | `issue/auto-progress.ts` (new), `test/issue/auto-progress.test.ts` (new). `session/auto-progress.ts` **not** yet removed.                                                                                                                                                                                                                                                                                                                          | The new engine compiles and the tests pass. Old engine still wires through `tool/registry.ts:360` and continues to function.                                                                         |
| 6   | `feat(server): add /issue/* routes and regenerate SDK`                                   | `server/instance/issue.ts` (new), `server/instance/index.ts` (register), `script/generate.ts` invoked, `packages/sdk/openapi.json` + `packages/sdk/js/src/v2/server.ts` regenerated.                                                                                                                                                                                                                                                               | SDK exposes `client.issue.{list,create,update,delete,reorder,syncPull,syncPush,autoProgressStart,autoProgressStop,autoProgressStatus}`. `bun --cwd packages/sdk typecheck` passes.                   |
| 7   | `feat(tool): add issue + granular issue tools and issue_auto_progress`                   | `tool/issue.ts`, `tool/issue_add.ts`, `tool/issue_update.ts`, `tool/issue_delete.ts`, `tool/issue_reorder.ts`, `tool/issue_auto_progress.ts` (new), `tool/registry.ts` (add registrations).                                                                                                                                                                                                                                                        | The agent can call the new tools. The old `TodoWriteTool` and `tool/auto_progress.ts` still registered.                                                                                              |
| 8   | `feat(app): add SidebarTodo + rewrite SidebarLinear to use real SDK`                     | `app/src/pages/layout/sidebar-todo.tsx` (new), `app/src/pages/layout/sidebar-todo-item.tsx` (new), `app/src/pages/layout/sidebar-linear.tsx` (rewritten: real SDK calls, no fake handlers, sub-panel shape), `app/src/components/linear-sync-history.tsx` (rewritten), `app/src/components/dialog-edit-todo.tsx` (rewritten submit), `app/src/components/dialog-linear-config.tsx` (rewritten), `app/src/pages/layout.tsx` (slot the new section). | Desktop shows the new `Todos` section. Linear sub-panel uses real SDK calls. Old `SidebarLinear` (the Linear-only version) is gone.                                                                  |
| 9   | `feat(tui): add sidebar-issue + rewrite sidebar-linear/todo and /linear-* commands`      | `cli/cmd/tui/feature-plugins/sidebar/issue.tsx` (new), `cli/cmd/tui/feature-plugins/sidebar/linear.tsx` (rewritten: real state), `cli/cmd/tui/feature-plugins/sidebar/todo.tsx` (rewritten: in-session only), `cli/cmd/tui/feature-plugins/linear/commands.tsx` (rewritten: real route calls), `cli/cmd/tui/command/linear.ts` (rewritten), `cli/cmd/tui/plugin/internal.ts` (register), `packages/plugin/src/tui.ts` (add `TuiState.issue`).      | TUI shows the new `Issue` section, real sync commands, real auto-progress toggle.                                                                                                                    |
| 10  | `chore: revert extended TodoTable + delete linear/ + delete granular todo_* tools`       | `session/session.sql.ts` (revert Linear columns), `session/todo.ts` (revert hierarchy/Linear plumbing), `session/auto-progress.ts` (delete), `tool/todo_add.ts` / `todo_update.ts` / `todo_delete.ts` / `todo_assign.ts` / `auto_progress.ts` (delete), `tool/registry.ts` (unregister, register new tools only), `linear/` directory (delete), `migration/<ts>_drop_todo_linear_columns/*` (new, generated).                                      | `Todo.Service` is back to its pre-feature shape, `Issue.Service` is the only todo-shaped system at workspace scope. The two coexisted in steps 1–9; from step 10 onward they are properly disjoint.  |

### Why this order

- Steps 1–2 are additive. Nothing in the existing system can break because nothing imports the new files yet.
- Step 3 is a rename-via-shim. The shim ensures nothing in the existing `sync-pull`/`sync-push` import paths changes.
- Step 4 is the surgical API change. Because the shim is in place, all existing call sites of `SyncPull.pull({ sessionID })` and `SyncPush.push({ sessionID })` continue to compile but now invoke the new `directory`-shaped functions. The new functions ignore the absence of `directory` only if the call site is updated; step 4 also updates all in-tree call sites (TUI commands, registry, tests).
- Steps 5–7 add more pieces without removing any. Build stays green.
- Steps 8–9 swap the UI consumers one at a time, first Desktop then TUI. If a regression is caught in step 8, we can revert it without touching the TUI.
- Step 10 is the cleanup. By this point the new system is wired end-to-end and the old extensions are unused. Reverting step 10 alone is safe; reverting steps 1–9 in reverse order is also safe because each step's diff is contained.

### Reversibility matrix

| Step | Reversible by                                                                                                                                                                                 | Risk of partial revert                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Revert the commit; `IssueTable` does not exist; nothing else changes.                                                                                                                         | None — additive.                                                                                                                                  |
| 2    | Revert the commit; `Issue.Service` is gone; no callers exist yet.                                                                                                                             | None — additive.                                                                                                                                  |
| 3    | Revert the commit; the files move back; the shim is removed.                                                                                                                                  | Low — pure rename.                                                                                                                                |
| 4    | Revert the commit; sync functions revert to `sessionID` shape; old call sites restored.                                                                                                       | Medium — the kernel route doesn't exist yet, so old `pull({ sessionID })` works but writes to the wrong table. Acceptable for a transient revert. |
| 5    | Revert the commit; new engine deleted; old engine still wired.                                                                                                                                | None — additive.                                                                                                                                  |
| 6    | Revert the commit; SDK methods gone; UI in step 8 calls fail. **Reverting step 6 forces reverting steps 7–9.**                                                                                | High after step 8 lands; pre-step-8, low.                                                                                                         |
| 7    | Revert the commit; new tools unregistered; old `TodoWriteTool` still registered.                                                                                                              | Low — additive.                                                                                                                                   |
| 8    | Revert the commit; Desktop UI rolls back to the pre-ADR-0001 shape. The TUI in step 9 is unaffected.                                                                                          | Low.                                                                                                                                              |
| 9    | Revert the commit; TUI rolls back; Desktop unaffected.                                                                                                                                        | Low.                                                                                                                                              |
| 10   | Revert the commit; the extended `TodoTable` returns. **The bus events `Issue.*` keep firing**, so the new system keeps working. Two todo systems coexist again, which is the state at step 9. | Low — the pre-feature state is fully restored.                                                                                                    |

### Commit hygiene

- Every step is **one commit**. No "WIP" or "fix typos" inside a step. If a step needs a fixup, the fixup is a separate commit on top, then squashed before the PR.
- The commit message references the ADR and step number: `feat(issue): add IssueTable schema (ADR-0003 step 1)`.
- Each commit is fast-forward-only on the sub-branch; the sub-branch is rebased onto `feature/todo-sidebar-linear` once per step (never after a push) to keep the history linear.
- The PR description links this ADR and walks the reviewer through steps 1 → 10 with the green-build evidence (CI logs).

## Drizzle migration specifics

The Drizzle migration in step 1 is generated, not hand-written. Procedure:

```bash
cd opencode
bun install
bun --cwd packages/opencode run db generate --name add_issue_table
```

The generated migration lives at `packages/opencode/migration/<timestamp>_add_issue_table/{migration.sql,snapshot.json}`. The `snapshot.json` is committed; `migration.sql` is committed verbatim. No data backfill is needed because the table is new and starts empty.

The step 10 migration is generated the same way after `session.sql.ts` is reverted: `bun --cwd packages/opencode run db generate --name drop_todo_linear_columns`. The Drizzle generator emits `ALTER TABLE todo DROP COLUMN ...` statements in the correct order. No data loss because no in-tree code path writes the dropped columns after step 10.

## Tool layer wiring

Step 7 registers the new tools in `tool/registry.ts`. The diff in that commit:

```ts
// before
import { TodoWriteTool } from "./todo"
import { TodoAddTool } from "./todo_add"
import { TodoUpdateTool } from "./todo_update"
import { TodoDeleteTool } from "./todo_delete"
import { TodoAssignTool } from "./todo_assign"
import { AutoProgressTool } from "./auto_progress"

// after
import { TodoWriteTool } from "./todo"
import { IssueWriteTool } from "./issue"
import { IssueAddTool } from "./issue_add"
import { IssueUpdateTool } from "./issue_update"
import { IssueDeleteTool } from "./issue_delete"
import { IssueReorderTool } from "./issue_reorder"
import { IssueAutoProgressTool } from "./issue_auto_progress"
```

`TodoWriteTool` stays. `TodoAddTool` / `TodoUpdateTool` / `TodoDeleteTool` / `TodoAssignTool` / `AutoProgressTool` are removed in step 10. In step 7, **both** sets are registered (the old ones for the per-session todo, the new ones for the issue system). This is intentional: the agent can interact with both shapes during the migration window. The agent's system prompt is updated in step 10 to direct it to the `issue_*` tools for workspace work and the `todo` tool for in-session planning.

## Kernel routes — `describeRoute` / `operationId` per CLAUDE.md

Each new route in `server/instance/issue.ts` follows the conventions in the workspace `CLAUDE.md` (OpenAPI metadata, operation IDs, snake_case in schemas). Example for `POST /issue/sync/pull`:

```ts
export const IssueRoutes = () =>
  new Hono()
    .post(
      "/sync/pull",
      describeRoute({
        operationId: "issue.syncPull",
        summary: "Snapshot-import Linear issues into the workspace's IssueTable",
        ...,
      }),
      validator("json", z.object({ directory: z.string() })),
      async (c) => {
        const { directory } = c.req.valid("json")
        const result = await IssueSyncPull.pull({ directory }).pipe(...)
        return c.json(result)
      },
    )
    // ... other routes
```

The route prefix is mounted in `server/instance/index.ts` alongside the other instance-scoped routes (`/mcp`, `/session`, etc.). After step 6, the SDK exposes `client.issue.syncPull({ directory })` and the Desktop UI calls it directly.

## TUI state surface

The TUI plugin API is extended in step 9 by adding `TuiState.issue(directory)` to `packages/plugin/src/tui.ts`. The accessor is backed by a bus subscription on `Issue.Updated` (filtered by directory) plus a one-shot `client.issue.list({ directory })` fetch. The pattern mirrors how `TuiState.session(sessionID)` works today. The TUI sidebar plugin `sidebar/issue.tsx` reads from this accessor; the rewritten `sidebar/linear.tsx` reads MCP connection state from `TuiState.mcp()` as before but does not store `linear:projectId` in `api.kv` anymore (it comes from the server config).

## Test plan

Each step ships with its own test additions or moves. The full test matrix after the migration:

| Test file                                                         | Status                                            | Notes                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `test/session/todo.test.ts`                                       | Kept as-is                                        | In-session `Todo.Service` tests.                            |
| `test/session/auto-progress.test.ts`                              | **Deleted in step 10**                            | The engine it tested is gone.                               |
| `test/issue/auto-progress.test.ts`                                | **Added in step 5**                               | New engine, `directory`-scoped.                             |
| `test/issue/issue.test.ts`                                        | **Added in step 2**                               | `Issue.Service` CRUD + events.                              |
| `src/linear/{mcp-client,sync-pull,sync-push,integration}.test.ts` | **Moved to `src/issue/` and rewritten in step 4** | Target `Issue.Service`, not `Todo.Service`.                 |
| `test/issue/sync-roundtrip.test.ts`                               | **Added in step 4**                               | End-to-end: pull → list → push.                             |
| `test/server/issue-routes.test.ts`                                | **Added in step 6**                               | Each new route returns the expected shape.                  |
| `test/tool/issue-tools.test.ts`                                   | **Added in step 7**                               | Each new tool emits the right tool call.                    |
| `e2e/desktop-sidebar-todo.spec.ts`                                | **Added in step 8**                               | Playwright: create/edit/delete/reorder via the new sidebar. |
| `e2e/desktop-sidebar-linear.spec.ts`                              | **Added in step 8**                               | Playwright: configure Linear, pull, see real items.         |

`bun --cwd packages/opencode test` runs all unit tests in ~30s (per the existing convention in the worktree `OPENCODE_TODO_LINEAR_GUIDE.md`). The e2e suite is run separately.

## Risks and mitigations

- **Bus event collisions**: `Todo.Event.Updated` and `Issue.Event.Updated` are different types and different topics. No collision, but a careless subscriber in `tool/registry.ts` or `effect/app-runtime.ts` could listen to the wrong one. Step 4 includes a grep pass: `grep -rn "Todo.Event.Updated" packages/` and `grep -rn "Issue.Event.Updated" packages/`; the new code paths must only subscribe to the new event.
- **Schema migration order**: the `issue` table is created in step 1; the `todo` table is altered in step 10. A user upgrading mid-migration (e.g., pulling step 6 but not step 10) gets a build where the `Issue.Service` writes to a real `issue` table while the old code still reads the extended `todo` table. The two are disjoint, so this is fine. The test plan covers this as a "mixed state" test: at the end of step 7, both tables exist and both services work, and a regression test ensures the wrong table is never written by the wrong service.
- **OpenAPI drift**: regenerating the SDK in step 6 is a one-shot; the build fails loudly if `packages/sdk/openapi.json` is out of sync. CLAUDE.md already mandates this. The CI in the worktree has a guard for it.
- **TUI parity gap**: the TUI (step 9) lands after the Desktop (step 8). Between step 8 and step 9 the Desktop has the new sidebar and the TUI has the old one. This is acceptable; the user can use the Desktop for the new feature while the TUI catches up. We will not block step 8 on step 9.
- **Auto-progress toggle UX**: step 8 ships the toggle in the Desktop sidebar; the TUI equivalent lands in step 9. Until then, the TUI's `/auto-progress` command operates on the old per-session engine and is a no-op for workspace items. This is acceptable for a one-PR window.

## Acceptance criteria for the PR

The PR description must include:

1. A link to this ADR.
2. The full step list with each step's commit SHA.
3. A screenshot of the new Desktop `Todos` sidebar with at least one L1 and one L2 item, and a separate screenshot of the Linear sub-panel after a real pull.
4. `bun typecheck` and `bun --cwd packages/opencode test` logs.
5. A demo Linear project ID (sandbox) with the resulting `IssueTable` rows visible (or a recorded `sqlite3` dump).
6. A note in the PR template: "Reverting this PR leaves the worktree in the state at step 9 — the new system is wired but the old `TodoTable` extensions are still present. Step 10 is a separate follow-up PR." (Or, if step 10 is included in the same PR, that note is unnecessary and step 10 has its own demo evidence.)

## Open questions

1. **PR shape**: one PR for steps 1–10, or two PRs (1–9 then 10)? The acceptance criteria above assume one. If we split, the second PR is a pure revert of the extensions and is much smaller. Recommendation: **one PR**, because the extended `TodoTable` is a defect and step 10 is the cleanup. Splitting the cleanup into a separate PR invites it to be deprioritised. **Owner: user, blocking step 1.**
2. **Migration backfill**: do we want to copy any in-session `TodoTable` rows with a `linear_issue_id` to the new `IssueTable`? Currently no — the PRD treats the new system as starting fresh. If the user wants a backfill, step 10 includes a `INSERT INTO issue SELECT ... FROM todo WHERE linear_issue_id IS NOT NULL` step. **Owner: user, blocking step 10.**
3. **TUI sub-panel shape**: does the TUI's `SidebarIssue` also host a Linear sub-panel, or does the TUI get only the `Issue` section with a separate `SidebarLinear`? The current TUI has both as siblings. Recommendation: **siblings in the TUI** because the TUI's existing `sidebar-linear.tsx` already shows MCP state and that surface is useful on its own. **Owner: implementation, no decision needed unless contradicted.**

## Notes

The two ADRs upstream of this one (0001, 0002) describe **what** the system looks like after the migration. This ADR describes **how** to get there. The acceptance of all three together is the design contract for the migration PR.
