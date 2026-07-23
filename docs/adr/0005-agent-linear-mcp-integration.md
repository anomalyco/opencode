# ADR-0005: Agent-driven Linear MCP integration

**Status:** Proposed (2026-07-20)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude
**Supersedes:** Partially supersedes ADR-0001 §"Linear MCP is the integration point; the agent layer needs no code changes" and ADR-0002 §"Sync is UI-driven only"
**Amends:** ADR-0001 Amendment 2026-07-17 (GraphQL bypass scope) — the bypass becomes the foundation for a full `LinearGraphqlClient`

## Context

### The MCP design principle

MCP (Model Context Protocol) is a tool protocol designed for LLM agents. The Linear MCP server (`https://mcp.linear.app/mcp`) exposes tools like `save_issue`, `list_issues`, `get_issue`, `list_issue_statuses` so that **agents** can operate Linear issues directly. This is the canonical integration path: when an agent needs to edit a Linear resource, it calls the Linear MCP tool.

### The Linear MCP schema gap (audited 2026-07-20)

The Linear MCP server has known schema gaps that make it impossible for the agent to perform certain edits via MCP alone:

- **`save_issue` rejects `null` for `dueDate`** — the input schema types `dueDate` as `string`, so sending `dueDate: null` is rejected by Zod validation. The agent cannot clear a due date via MCP.
- **`save_issue` does not support `description: null`** — same issue, schema types it as `string`.
- **No `delete_issue` tool exists in MCP** — Linear's MCP server has no Issue deletion tool at all. Linear's own model treats archive as soft-delete, but true hard-delete is only available via the GraphQL `issueDelete` mutation.

The user-facing UI path already works around this with a narrow GraphQL bypass: `clearDueDateViaGraphQL` in `sync-push.ts:300-344`. This ADR extends that pattern into a full `LinearGraphqlClient` so the agent has the same capabilities.

### Current behavior (audited 2026-07-20)

The Todo Sidebar Feature currently has **two completely isolated paths**:

| Path       | Caller                           | Entry point                                                                                        | Touches Linear MCP? |
| ---------- | -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| Agent path | LLM agent via `issue_*` tools    | `packages/opencode/src/tool/issue_*.ts`                                                            | **No**              |
| Sync path  | Desktop UI user clicks Push/Pull | `packages/opencode/src/server/routes/instance/httpapi/handlers/issue.ts` → `SyncPush` / `SyncPull` | Yes                 |

Audit of the 6 agent tools (`issue_add`, `issue_update`, `issue_archive`, `issue_delete`, `issue_list`, `issue_reorder`):

- **Zero** of them import `LinearMcpClient`, `SyncPush`, `SyncPull`, or `LinearBinding`.
- **Zero** of them check `linear_issue_id` before operating.
- `Issue.Service` (`issue.ts`) methods (`create` / `update` / `archive` / `del` / `reorder`) **never** call `SyncPush` or `LinearMcpClient`.
- `issue_list` returns the full `Issue.Info` JSON including `linear_issue_id`, `last_pushed_at`, `last_pulled_at`, `cloud_shadow` — so the agent **can** see Linear association state, but the tool descriptions (`.txt` files) **do not tell the agent what to do about it**.

### Concrete sync gaps

When an agent operates on a Linear-associated issue (`linear_issue_id != null`), the local `IssueTable` is updated but **Linear is never notified**:

1. `issue_update` modifies local fields → Linear issue unchanged → drift until next manual Push from UI.
2. `issue_archive` flips local status to Done/Canceled/Duplicate → Linear workflow state unchanged.
3. `issue_delete` removes the local row → Linear issue still exists → next `SyncPull` re-imports it as a new local row ("delete resurrection" bug).
4. `issue_reorder` changes local `position` → Linear ordering (driven by priority, not position) unaffected.
5. `issue_add` creates a local-only row → never appears in Linear until manual Push.

### Why this happened

ADR-0001 §"Linear MCP server is the integration point; the agent layer needs no code changes — agents discover Linear tools through the existing MCP system" was interpreted as "the agent tools should be Linear-agnostic." That interpretation is wrong. The ADR meant the **OpenCode agent layer** (session loop, tool registry) needs no Linear-specific code — but the **issue tool descriptions and behavior** still need to honor the Linear association contract, otherwise the agent cannot do the right thing.

## Decision

### D1 — Agent uses Linear MCP + Linear GraphQL directly for Linear-associated issues

The agent is the canonical editor of Linear-associated issues. When an issue has `linear_issue_id != null`, the agent **must** use Linear's remote APIs to edit it, never the local `issue_*` write tools. The agent has two remote paths:

- **Linear MCP tools** (`linear_save_issue`, `linear_list_issues`, etc.) — discovered through the existing MCP system when the user registers the Linear MCP server in `opencode.jsonc`. Used for all standard edits (create, update fields with non-null values, list, query).
- **`linear_graphql` agent tool** (new) — a thin agent tool that runs a Linear GraphQL mutation directly. Used when MCP's schema cannot represent the operation:
  - clearing `dueDate` (MCP rejects `null`)
  - clearing `description` (MCP rejects `null`)
  - hard-deleting an issue (MCP has no `delete_issue` tool)

After a remote edit, the agent calls `issue_sync` to reconcile the local copy (see D3).

The local `issue_*` write tools (`issue_update`, `issue_archive`, `issue_delete`) **refuse** Linear-associated issues and return a structured error pointing the agent to the correct remote path.

### D2 — Local issue\_\* tools are local-only

`issue_add`, `issue_update`, `issue_archive`, `issue_delete`, `issue_reorder` operate **only** on issues with `linear_issue_id == null`. They:

- Reject writes to Linear-associated issues with `IssueLinearLinkedError` (a new `Schema.TaggedErrorClass`).
- The error message tells the agent exactly which remote path to use instead (Linear MCP `save_issue` for updates, `linear_graphql` for null-clearing or deletion).
- `issue_list` and `issue_reorder` remain read-only / local-position-only and do not refuse (reorder does not touch Linear semantics; list must surface `linear_issue_id` so the agent can route correctly).
- `issue_add` still creates local-only issues. The agent that wants a Linear issue uses `linear_create_issue` via MCP (or `linear_graphql` with `issueCreate`), then `issue_sync` to import it locally.

### D3 — New tool: `issue_sync`

Adds a new agent tool `issue_sync` that triggers `SyncPull` or `SyncPush` from the agent path:

- Parameters: `direction: "pull" | "push"` (default `"pull"`).
- `pull` calls `SyncPull.pull({ directory })` — used after the agent edits Linear via MCP/GraphQL, to reconcile local.
- `push` calls `SyncPush.push({ directory, issueIds: [] })` — used after local edits (rare; the agent path normally refuses Linear-associated writes, so push is only for local-only issues the user later wants on Linear).
- Returns the `SyncPull.Result` / `SyncPush.Result` summary (pulled / updated / skipped / failed counts).

### D4 — New tool: `linear_graphql`

Adds a new agent tool `linear_graphql` that exposes the Linear GraphQL API directly to the agent. This is the agent-side counterpart of the existing `clearDueDateViaGraphQL` bypass.

- Parameters:
  - `mutation` (string) — the GraphQL mutation body (e.g. `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id } } }`)
  - `variables` (object) — the variables object (e.g. `{ id: "LIN-123", input: { dueDate: null } }`)
- Authentication: reuses `LinearGraphqlClient` (see D7), which reads `LINEAR_API_KEY` from the environment (same as the existing bypass).
- Returns: the GraphQL response JSON. The agent is responsible for interpreting success/failure.
- The tool description lists the canonical mutations the agent should use:
  - `issueUpdate` with `input: { dueDate: null }` to clear due date
  - `issueUpdate` with `input: { description: null }` to clear description
  - `issueDelete` with `id: "LIN-123"` to hard-delete (MCP has no equivalent)
- The tool does **not** wrap or interpret the mutation — it is a thin pass-through. This keeps it future-proof against new Linear GraphQL features without kernel changes.

### D5 — Tool descriptions guide the agent

Each `issue_*.txt` description is updated to state the Linear contract explicitly:

- `issue_list.txt` — explains that `linear_issue_id != null` means "edit via Linear MCP (`linear_save_issue`), or `linear_graphql` for null-clearing/deletion; then call `issue_sync`".
- `issue_update.txt` / `issue_archive.txt` / `issue_delete.txt` — state the refusal and the remote alternatives.
- `issue_add.txt` — states that local creates are local-only; to create on Linear, use `linear_save_issue` via MCP then `issue_sync`.
- `issue_sync.txt` (new) — explains when to call it and what the counts mean.
- `linear_graphql.txt` (new) — lists the canonical mutations and when to use each.

### D6 — Agent-visible data is trimmed

The `issue_list` and `issue_*` tool outputs stop returning `last_pushed_at`, `last_pulled_at`, `cloud_shadow`. These are sync-internal bookkeeping fields; exposing them to the agent creates confusion without actionable value. They remain in `IssueTable` (used by `SyncPush` / `SyncPull`) but are filtered out of the agent-facing `Issue.Info` projection.

`linear_issue_id`, `linear_team_id`, `linear_project_id` stay in the agent-facing projection — the agent needs them to route to the correct remote path and to construct `save_issue` / GraphQL calls.

### D7 — `LinearGraphqlClient` shared service

The existing `clearDueDateViaGraphQL` function in `sync-push.ts:300-344` is refactored into a proper `LinearGraphqlClient` service:

- New file: `packages/opencode/src/issue/linear-graphql.ts`.
- Exposes `LinearGraphqlClient.Service` (Effect Context.Service) with one method:
  - `call(mutation: string, variables: Record<string, unknown>) => Effect.Effect<unknown, LinearMcpError>`
- Uses the same authentication as the existing bypass: `process.env.LINEAR_API_KEY`, sent as `Authorization: <key>` header (Linear's accepted format).
- Uses `HttpClient.HttpClient` (Effect) — no raw `fetch`, per AGENTS.md.
- Returns the parsed JSON response body. The caller interprets success/failure.
- `SyncPush.clearDueDateViaGraphQL` is rewritten to call `LinearGraphqlClient.Service.call(...)` — no logic change, just delegation.
- The new `linear_graphql` agent tool also uses `LinearGraphqlClient.Service.call(...)`.

This keeps a single source of truth for "how to talk to Linear GraphQL" — both the UI sync path and the agent tool path use the same client.

### D8 — UI Push/Pull stays

The Desktop UI Push/Pull buttons and their HTTP routes (`POST /issue/sync/push`, `POST /issue/sync/pull`) are **kept**. They remain the manual sync entry point for users who edit via the sidebar UI instead of the agent. `SyncPush` and `SyncPull` services are shared between the UI HTTP route and the new `issue_sync` agent tool. `SyncPush` continues to use `LinearGraphqlClient` internally for the `dueDate: null` case — no behavior change for the UI path.

## Consequences

### Positive

- **Honors the MCP contract**: Linear MCP is the agent's interface to Linear, as intended.
- **Eliminates the 5 sync gaps**: no path can silently drift local vs Linear.
- **Removes the "delete resurrection" bug**: `issue_delete` refuses Linear-linked rows, so the agent must archive on Linear first; the next pull sees the Linear archive and reconciles correctly.
- **Agent-facing data is simpler**: no `cloud_shadow` / `last_pushed_at` confusion.
- **`SyncPush` / `SyncPull` stay single-source**: both UI and agent tool call the same service, no duplicated sync logic.

### Negative

- **Agent must make two calls** for a Linear edit (MCP tool + `issue_sync`). This is inherent to the pull-based reconcile model and matches how Linear's own MCP works (edits are server-side, callers re-fetch).
- **`issue_update` / `issue_archive` / `issue_delete` now refuse** a class of issues they previously silently accepted. Any agent prompt that assumed these tools work on all issues must be updated. This is intentional — the previous behavior was a bug (silent drift).
- **`issue_sync` adds latency** to agent workflows (one Linear API round-trip per edit cycle). Acceptable: the agent was already supposed to be Linear-aware.

### Neutral

- The `cloud_shadow` field and shadow-diff push logic remain in `SyncPush` for the UI path. The agent never triggers a push of Linear-associated issues, so the shadow-diff path is only exercised by UI Push.

## Implementation Plan

### Phase 0 — `LinearGraphqlClient` service extraction

1. **Create `packages/opencode/src/issue/linear-graphql.ts`**:
   - Define `LinearGraphqlClient.Service` (Context.Service) with one method:
     `call(mutation: string, variables: Record<string, unknown>) => Effect.Effect<unknown, LinearMcpError>`
   - Define `LinearGraphqlClient.layer` (Layer.effect) that reads `process.env.LINEAR_API_KEY` and constructs an `HttpClient`-backed client.
   - Define `LinearGraphqlClient.node` (LayerNode) for layer registration.
   - Reuse the authentication pattern from `sync-push.ts:300-344`: `Authorization: <key>` header, `POST https://api.linear.app/graphql`, body `{ query, variables }`.
   - Return the parsed JSON response body on success; `LinearMcpError` on HTTP/parse failure.

2. **Rewrite `clearDueDateViaGraphQL` in `sync-push.ts`**:
   - Replace the inline HTTP logic with `yield* LinearGraphqlClient.Service.call(mutation, variables)`.
   - The function stays in `sync-push.ts` as a thin wrapper (it constructs the specific mutation string and variables, then delegates to the service).
   - No behavior change — same mutation, same variables, same error type.

3. **Register `LinearGraphqlClient.node` in the HTTP server layer tree** (`packages/opencode/src/server/routes/instance/httpapi/server.ts`) so both the sync path and the agent tool path can access it.

### Phase 1 — Kernel changes (no UI changes)

4. **Add `IssueLinearLinkedError`** in `packages/opencode/src/issue/issue.ts`:
   - `Schema.TaggedErrorClass` with `{ id: string, linearIssueId: string, tool: string }`.
   - Message template: `"Issue {id} is linked to Linear ({linearIssueId}). Use Linear MCP tools (linear_save_issue) or linear_graphql for null-clearing/deletion to edit it, then call issue_sync to reconcile the local copy."`

5. **Refuse Linear-linked writes in `Issue.Service`**:
   - `update({ directory, id, patch })` — read the row first; if `linear_issue_id != null` and the patch contains any non-local field (i.e. anything other than `position`), `yield* new IssueLinearLinkedError(...)`.
   - `archive({ directory, id, outcome })` — if `linear_issue_id != null`, refuse.
   - `del({ directory, id })` — if `linear_issue_id != null`, refuse.
   - `reorder({ directory, ids })` — **not refused** (position is local-only; Linear ordering is by priority).
   - `create({ directory, issue })` — never refuses (local creates always start unlinked).

6. **Filter agent-facing `Issue.Info`**:
   - Add a `toAgentInfo(row)` helper in `issue.ts` that omits `last_pushed_at`, `last_pulled_at`, `cloud_shadow`.
   - `issue_list`, `issue_add`, `issue_update`, `issue_archive` tool outputs use `toAgentInfo`.
   - `Issue.Service.get({ directory, includeArchived })` returns the **full** `Info` (UI still needs all fields); the filtering happens only at the tool boundary.

7. **Add `issue_sync` tool**:
   - New file `packages/opencode/src/tool/issue_sync.ts` + `issue_sync.txt`.
   - Calls `SyncPull.pull({ directory })` or `SyncPush.push({ directory, issueIds: [] })` based on `direction`.
   - Returns the `Result` JSON.
   - Requires `SyncPull.Client` / `SyncPush.Client` Context — these are already provided by the instance layer.

8. **Add `linear_graphql` tool**:
   - New file `packages/opencode/src/tool/linear_graphql.ts` + `linear_graphql.txt`.
   - Parameters: `mutation` (string), `variables` (object).
   - Calls `LinearGraphqlClient.Service.call(mutation, variables)`.
   - Returns the GraphQL response JSON.
   - Tool description lists canonical mutations (issueUpdate for null-clearing, issueDelete for hard-delete).

9. **Register both new tools in `registry.ts`** alongside the other 6 issue tools.

10. **Update tool descriptions** (`.txt` files) per D5.

### Phase 2 — Cleanup

11. **Remove Linear-field write paths from `Issue.Service.update`**:
    - Currently `issue.ts` line ~378 has `if (p.linear_issue_id !== undefined) set.linear_issue_id = p.linear_issue_id ?? null` and similar for `linear_team_id` / `linear_project_id`. These were only reachable from the HTTP handler (the agent tool's `Parameters` schema never exposed them). After this refactor, the HTTP handler also should not allow direct local writes of `linear_issue_id` — that field is only set by `SyncPull` (on insert) or `SyncPush` (on create-from-local). Remove the `linear_*` branches from `update`'s patch handling. The HTTP `PATCH /issue/:id` route that previously accepted `linear_issue_id` in the body stops accepting it; clients that need to link/unlink must go through `SyncPush` / `SyncPull`.

12. **Remove `linear_issue_id` / `linear_team_id` / `linear_project_id` from the HTTP `PATCH /issue/:id` body schema** in `groups/issue.ts`. These fields are now sync-internal only.

13. **Remove `linear_issue_id` / `linear_team_id` / `linear_project_id` from the `issue_update` tool's `Parameters` schema** (already not exposed, but verify and assert via typecheck).

14. **Remove the deprecated `Issue.patchStatus` references** (if any remain after the 2026-07-19 amendment) — status changes flow through `Issue.update` or Linear MCP, never a separate patchStatus path.

15. **Update `docs/adr/0001-todo-sidebar-scope-and-surface.md`** — strike the "agent layer needs no code changes" sentence and replace with a reference to ADR-0005. Also update Amendment 2026-07-17 to note the bypass is now the foundation for `LinearGraphqlClient` (no longer a narrow one-off).

16. **Update `docs/adr/0002-sync-data-path.md`** — mark the "Sync is UI-driven only" assumption as superseded by ADR-0005 D8 (sync is both UI- and agent-driven). Also update §D13 to reference `LinearGraphqlClient` instead of the narrow `clearDueDateViaGraphQL`.

### Phase 3 — Tests

17. **Add unit tests** in `packages/opencode/test/issue/issue.test.ts`:
    - `issue_update` on a Linear-linked issue → `IssueLinearLinkedError`.
    - `issue_archive` on a Linear-linked issue → `IssueLinearLinkedError`.
    - `issue_delete` on a Linear-linked issue → `IssueLinearLinkedError`.
    - `issue_update` on a local-only issue → success.
    - `issue_list` output does not contain `last_pushed_at` / `last_pulled_at` / `cloud_shadow`.
    - `issue_sync` with `direction: "pull"` calls `SyncPull.pull` once and returns the result.
    - `issue_sync` with `direction: "push"` calls `SyncPush.push` once and returns the result.
    - `linear_graphql` calls `LinearGraphqlClient.Service.call` with the provided mutation and variables.
    - `LinearGraphqlClient.Service.call` sends the correct Authorization header and request body.

18. **Add E2E test** in `issue-e2e.test.ts`:
    - Agent creates a local issue, then `issue_sync push` → issue appears on Linear (or is skipped if no Linear binding).
    - Agent edits a Linear-linked issue via `issue_update` → tool refuses with the MCP hint.

### Phase 4 — Verification

19. `bun --cwd packages/opencode typecheck`
20. `bun --cwd packages/app typecheck`
21. `bun --cwd packages/opencode test test/issue`
22. Regenerate SDK if HTTP route schemas changed: `./script/generate.ts`

## Cleanup Checklist (post-refactor)

These files / fields / behaviors are removed or changed:

| Item                                                                                            | Location                                                               | Action                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `clearDueDateViaGraphQL` inline HTTP logic                                                      | `packages/opencode/src/issue/sync-push.ts:300-344`                     | **Replace** with a call to `LinearGraphqlClient.Service.call(...)` — the inline HttpClient construction is removed |
| `linear_issue_id` / `linear_team_id` / `linear_project_id` write path in `Issue.Service.update` | `packages/opencode/src/issue/issue.ts` ~L378                           | **Remove** the `if (p.linear_* !== undefined)` branches                                                            |
| `linear_issue_id` etc. in HTTP `PATCH /issue/:id` body schema                                   | `packages/opencode/src/server/routes/instance/httpapi/groups/issue.ts` | **Remove** from schema                                                                                             |
| `last_pushed_at` / `last_pulled_at` / `cloud_shadow` in agent-facing tool outputs               | `packages/opencode/src/tool/issue_*.ts`                                | **Filter out** via `toAgentInfo`                                                                                   |
| `Issue.patchStatus` references                                                                  | `packages/opencode/src/issue/issue.ts` (if any)                        | **Remove**                                                                                                         |
| ADR-0001 "agent layer needs no code changes"                                                    | `docs/adr/0001-*.md`                                                   | **Strike and reference ADR-0005**                                                                                  |
| ADR-0001 Amendment 2026-07-17 narrow GraphQL bypass                                             | `docs/adr/0001-*.md`                                                   | **Update** to reflect the bypass is now `LinearGraphqlClient`, no longer a narrow one-off                          |
| ADR-0002 "Sync is UI-driven only"                                                               | `docs/adr/0002-*.md`                                                   | **Mark superseded by ADR-0005 D8**                                                                                 |
| ADR-0002 §D13 narrow GraphQL bypass reference                                                   | `docs/adr/0002-*.md`                                                   | **Update** to reference `LinearGraphqlClient`                                                                      |

These stay (still needed):

| Item                                                                         | Reason                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `SyncPush` / `SyncPull` services                                             | Used by UI Push/Pull and the new `issue_sync` tool                                     |
| `cloud_shadow` / `last_pushed_at` / `last_pulled_at` columns in `IssueTable` | Used by sync services for diff/reconcile                                               |
| HTTP routes `POST /issue/sync/{push,pull}`                                   | UI manual sync entry points                                                            |
| `linear_issue_id` / `linear_team_id` / `linear_project_id` in `IssueTable`   | Used by sync services and agent routing                                                |
| `LinearBinding.Service`                                                      | Workspace-scope Linear config, used by sync services                                   |
| `LinearMcpClient` (MCP path)                                                 | Primary path for agent + UI sync; handles 90% of operations                            |
| `LinearGraphqlClient` (GraphQL path)                                         | New shared service, used by `SyncPush` (dueDate clear) and `linear_graphql` agent tool |

## Amendment 2026-07-20 — D1 and D2 are superseded (Agent edits locally, syncs like the UI)

### What changed

**Superseded:**

- **D1** ("Agent uses Linear MCP + Linear GraphQL directly for Linear-associated issues") — the agent no longer MUST route Linear-linked edits through Linear MCP. The agent edits Linear-linked issues directly in the local IssueTable, then optionally calls `issue_sync push` to sync to Linear.
- **D2** ("Local issue_* tools are local-only") — the refusal logic (`IssueLinearLinkedError`, the pre-check in `issue_update.ts` / `issue_archive.ts` / `issue_delete.ts`) is removed entirely. The `IssueLinearLinkedError` class is deleted. The agent and the UI now share the same edit path: write locally, push to sync.
- **D5** (tool descriptions) — rewritten to describe the new behavior. The `.txt` files no longer say "REFUSE writes"; they describe how `linear_issue_id` indicates Linear linkage and that local edits sync via Push (mirroring the UI path).
- **Implementation Notes Deviations 4, 5** — both were about the now-deleted `IssueLinearLinkedError`. They are kept in the notes as historical record but marked as obsolete.

**Kept (still in force):**

- **D3** (`issue_sync` tool) — kept. The agent uses it to trigger `SyncPull` / `SyncPush` after editing. The "pull after a Linear MCP edit" use case is now rare (the agent edits locally), but "push after local edits" and "pull to reconcile" are still valid.
- **D4** (`linear_graphql` tool) — kept as an **escape hatch**. The agent no longer needs it as the primary path for null-clearing or deletion (SyncPush handles null-clearing internally via `LinearGraphqlClient`; local delete + pull handles the "delete resurrection" case). But it remains available for the rare case where the agent needs to call Linear GraphQL directly (e.g., the user explicitly asks to permanently delete on Linear's side). The tool description should be updated to reflect this reduced scope.
- **D6** (agent-visible data trimmed) — kept. `last_pushed_at`, `last_pulled_at`, `cloud_shadow` remain filtered out of agent-facing tool outputs.
- **D7** (`LinearGraphqlClient` shared service) — kept. `SyncPush.clearDueDateViaGraphQL` still uses it; the `linear_graphql` agent tool still uses it.
- **D8** (UI Push/Pull stays) — kept. The UI path is unchanged.

### Why

The original D1/D2 design forced the agent into a two-call pattern (Linear MCP edit + `issue_sync pull`) for every Linear-linked edit. This was motivated by "Linear MCP is the canonical agent interface to Linear" — but it created an asymmetry: the user could edit Linear-linked issues in the UI (local write + later Push), but the agent could not. The agent was forced to make remote API calls for issues the user could edit locally.

The user clarified on 2026-07-20 that the requirement is symmetric: **both the user and the agent should be able to operate on local Issues and Linear-linked Issues directly**. The correct model is:

1. Edit local IssueTable (user via UI, agent via `issue_*` tools) — marks the row dirty (`time_updated > last_pushed_at`).
2. Sync to Linear via Push (user clicks Push, agent calls `issue_sync push`).
3. Sync from Linear via Pull (user clicks Pull, agent calls `issue_sync pull`).

This eliminates the asymmetry, removes the `IssueLinearLinkedError` code path, and simplifies the agent's mental model: there is one edit path, and one sync path, shared by UI and agent.

### Consequences of the amendment

- The "delete resurrection" behavior is now explicit: deleting a Linear-linked issue locally does not delete it on Linear; the next pull re-imports it. The agent's `issue_delete.txt` documents this clearly. If the user wants permanent deletion on Linear, they use `linear_graphql` (escape hatch) or Linear's UI.
- The "5 sync gaps" listed in the original Consequences section are not fully eliminated — they're reframed as expected behavior. Local edits to Linear-linked issues drift from Linear until the next Push. This is the same drift the UI path has always had, and it's intentional (local-first, sync-on-demand).
- The `linear_graphql` tool is no longer the "agent's primary path for null-clearing/deletion" — it's an escape hatch. SyncPush handles null-clearing internally; local delete + pull handles the deletion case.

### Files affected

- `packages/opencode/src/issue/issue.ts` — `IssueLinearLinkedError` class deleted; `update` / `archive` / `del` no longer refuse Linear-linked issues; service signatures updated.
- `packages/opencode/src/tool/issue_update.ts` — pre-check removed; `UpdateOutcome` no longer has `linear_linked` reason.
- `packages/opencode/src/tool/issue_archive.ts` — pre-check removed; `ArchiveOutcome` no longer has `linear_linked` reason.
- `packages/opencode/src/tool/issue_delete.ts` — pre-check removed; `DeleteOutcome` no longer has `linear_linked` reason.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/issue.ts` — `Effect.catchTag("Issue.LinearLinkedError", ...)` removed from `update` / `archive` / `remove` handlers.
- `packages/opencode/src/tool/issue_update.txt` / `issue_archive.txt` / `issue_delete.txt` / `issue_add.txt` / `issue_list.txt` — "REFUSE writes" sections removed; "Linear linkage" sections rewritten to describe the symmetric edit-then-sync model.
- `packages/opencode/test/issue/issue.test.ts` — service-layer refusal tests replaced with "service is Linear-agnostic" tests.

## Open Questions

1. **Should `issue_sync` accept an optional `issueIds: string[]` for targeted push?** Current proposal pushes all dirty local issues. Targeted push would let the agent push only the issue it just edited. Decision: defer — bulk push is simpler and matches the UI behavior. The Amendment 2026-07-20 makes this even less urgent: both local-only and Linear-linked issues can now be dirty, and a bulk push handles both uniformly.

2. **Should `issue_reorder` also refuse Linear-linked L1 issues?** (Superseded by Amendment 2026-07-20 — the refusal concept no longer exists.) The agent can reorder Linear-linked L1 issues locally. Linear ordering is by priority, not position, so the local reorder creates a visible divergence between sidebar order and Linear order. This is intentional — `position` is a local-only concern. Revisit if users report confusion.

3. **Should the agent see `last_pushed_at` / `last_pulled_at` for diagnostics?** Current proposal hides them. If the agent needs to decide "should I pull again?", the answer is "yes, always pull after a Linear MCP edit" — the timestamps don't change that. Decision: hide.

4. **Should `linear_graphql` accept arbitrary queries (not just mutations)?** Current proposal only documents mutations. Linear's GraphQL also supports queries (e.g. `issue(id: "LIN-123") { ... }`). Allowing queries would let the agent fetch Linear-side state directly. Decision: defer — the agent can use `linear_get_issue` via MCP for queries. GraphQL is reserved for operations MCP cannot do (null-clearing, deletion). Revisit if the agent needs fields MCP does not expose.

5. **Should `LinearGraphqlClient` fall back to MCP OAuth token when `LINEAR_API_KEY` is not set?** Currently it requires the env var. The MCP path uses OAuth tokens from `~/.local/share/opencode/mcp-auth.json`. Reusing OAuth would remove the env var requirement. Decision: defer — the env var is already required by the existing `clearDueDateViaGraphQL` and documented in ADR-0001 Amendment 2026-07-17. Adding OAuth support is a separate enhancement.

## Implementation Notes (2026-07-20)

The implementation followed the 4-phase plan above with these documented deviations from the original spec wording. None change the decisions D1–D8; they record how the code actually behaves where the spec was silent or imprecise.

### Deviation 1 — `issue_sync` tool wraps outcomes in `{ ok, title, output, metadata }`

**Spec (D3):** "The tool returns `{ ok: true, summary: ... }` on success, `{ ok: false, error: ... }` on failure."

**Actual:** The tool returns the standard `Tool.ExecuteResult` shape (`{ title, output, metadata }`), with the sync outcome JSON-encoded inside `output` and a boolean `ok` mirror in `metadata`. This matches every other `issue_*` tool's return shape and is required by `Tool.define`'s `execute` signature.

The agent still sees `{ ok: true, summary: ... }` / `{ ok: false, error: ... }` — it's just inside `output` (a JSON string), not at the top level of the tool result. The `metadata.ok` field lets the host route on success/failure without parsing `output`.

### Deviation 2 — `linear_graphql` tool wraps Linear's response in `{ ok, data }` / `{ ok, error }`

**Spec (D4):** "Returns the raw GraphQL response `{ data, errors }`."

**Actual:** Returns `{ ok: true, data }` on success, `{ ok: false, error: string }` on `LinearMcpError`. The raw `{ data, errors }` shape is decoded inside `LinearGraphqlClient.Service.call` via `Schema.decodeUnknownOption(GraphqlResponse)`; if the shape is unrecognized, the service fails with `LinearMcpError` and the tool surfaces it as `{ ok: false, error }`.

This lets the agent pattern-match on `ok` without inspecting Linear's GraphQL error envelope, and keeps `Tool.define`'s `never` error channel contract (typed errors are caught via `Effect.catchTag` and folded into the discriminated union).

### Deviation 3 — `LinearMcpClient` response unwrapping (`content[0].text`)

**Spec (D1, "Path A"):** "Agent calls Linear MCP `save_issue` directly — the MCP protocol wraps the response."

**Actual:** The Linear MCP server's tool responses follow the MCP protocol: `{ content: [{ type: "text", text: "<JSON>" }] }`. The agent calls `save_issue` with flat top-level parameters (`id`, `team`, `project`, `state`, `assignee`, etc.) — no nested `input` object. The response is the MCP-wrapped shape; the agent parses `content[0].text` as JSON to read Linear's result.

This is not really a deviation — the spec said "the MCP protocol wraps the response" — but it's documented here because the wrapping is non-obvious to someone reading only the Linear GraphQL docs.

### Deviation 4 — `IssueLinearLinkedError` includes a `tool` field

**OBSOLETE 2026-07-20:** The `IssueLinearLinkedError` class was deleted when D2 was superseded. The "tool field" and the entire refusal mechanism no longer exist. This deviation is kept as a historical record only.

**Original spec (D2):** "Typed error `IssueLinearLinkedError` carrying `{ id, linear_issue_id }`."

**Original actual:** The error also carried a `tool` field (`"issue_update" | "issue_archive" | "issue_delete"`) so the agent-facing tool could include the refusing tool's name in its `detail` message. This was a strict superset of the spec — no behavior change, just richer diagnostics.

### Deviation 5 — `issue_update` refusal is field-aware, not blanket

**OBSOLETE 2026-07-20:** The refusal logic was removed when D2 was superseded. This deviation is kept as a historical record only.

**Original spec (D2):** "Local `issue_update` / `issue_archive` / `issue_delete` throw `IssueLinearLinkedError` when `linear_issue_id != null`."

**Original actual:** `issue_archive` and `issue_delete` threw unconditionally on `linear_issue_id != null` (matching spec). `issue_update` threw only when the patch touched any Linear-sourced content field (`title`, `content`, `description`, `status`, `priority`, `labels`, `due_date`, `assignee_id`, `parent_id`, `level`). Patches that only set `position` were accepted — but `position` was not in `update`'s schema at all (position is owned by `issue_reorder`), so in practice this was equivalent to a blanket refusal.

The field-aware check existed so that future schema additions (e.g. a local-only `notes` field) wouldn't accidentally trigger the refusal.

### Deviation 6 — HTTP `IssuePartial` also drops `last_pushed_at` / `last_pulled_at` / `cloud_shadow`

**Spec (Phase 2 step 12):** "Remove `linear_issue_id` / `linear_team_id` / `linear_project_id` from the HTTP `PATCH /issue/:id` body schema."

**Actual:** The implementation also removed `last_pushed_at`, `last_pulled_at`, and `cloud_shadow` from `IssuePartial` (the shared create/update body schema). These are sync-internal bookkeeping fields that should never be client-writable — allowing them would let a client corrupt sync state. The spec only mentioned `linear_*` because the sync-internal fields were not in scope at the time; removing them is a correctness improvement aligned with D6's "hide sync-internal fields" principle.

The fields remain readable via `GET /issue` (they're in `IssueRecord`) — only the writable surface was narrowed.

### Deviation 7 — `issue_sync` resolves Linear client per-call (no sticky failure flag)

**Spec (D3):** "The tool resolves a Linear client via the same path as the HTTP handler."

**Actual:** The HTTP handler (`IssueHttpApi.syncPull` / `syncPush`) caches a "client failed" flag after the first `LinearMcpClient.create()` failure to avoid retrying on every request. The `issue_sync` tool does NOT cache — it retries `LinearMcpClient.create()` on every call. Rationale: the agent path is less hot than the HTTP handler (called once per Linear edit, not on every UI interaction), and a transient failure (e.g. network blip during `create()`) should not permanently disable the agent's sync capability for the session.
