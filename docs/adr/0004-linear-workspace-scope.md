# ADR-0004: Linear Team/Project binding — workspace-scope storage

**Status:** Accepted (2026-07-06)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude
**Supersedes:** parts of ADR-0001 §Linear config (the `teamId`/`projectId` fields in `Config.Linear`)

## Context

ADR-0001 placed Linear integration settings (`teamId`, `projectId`, `syncMode`, `autoPush`) inside `Config.Linear`, persisted to the **global** config file `~/.config/opencode/opencode.jsonc`. This worked for an MVP, but two problems surfaced during Desktop testing:

### Problem 1 — macOS TCC blocks global config writes

When a user clicks "Save binding" in the Linear management section, the kernel calls `Config.updateGlobal` which writes to `~/.config/opencode/opencode.jsonc`. On macOS, files created by a Tauri-bundled app (or touched by a sandboxed helper) get a `com.apple.provenance` extended attribute. Any **other** process that later tries to write the same file — including a different bundle identifier (dev → prod upgrade), or a standalone `bun serve` server — receives `EPERM: operation not permitted`, even when filesystem permissions read `-rw-r--r--`.

Reproduction (see diagnosing-bugs session 2026-07-06):

```bash
# Even an unchanged config PUT fails:
curl -X PATCH http://127.0.0.1:4096/global/config \
  -H "Content-Type: application/json" \
  -d "$(curl -s http://127.0.0.1:4096/global/config)"
# → HTTP 500, EPERM: operation not permitted, open '/Users/tk/.config/opencode/opencode.jsonc'
```

The root cause is `com.apple.provenance` on the file, not the code. Removing the xattr restores write access for the current process but macOS regenerates the attribute on next access — the fix is per-process and not durable across upgrades. This makes the global config file **unreliable as a runtime-mutable store** for workspace-scoped settings on macOS.

### Problem 2 — Wrong scope semantically

Linear MCP itself **does not bind to a team or project**. The MCP server's only configuration is the OAuth token (managed by the MCP auth flow, never written to `opencode.jsonc`). `teamId`/`projectId` are OpenCode's metadata: "which Linear team/project should new issues be created in, and which existing issues should be pulled for this workspace?" They are meaningfully **per-workspace**:

- A user may have workspace A sync to `team-engineering/project-backend` and workspace B sync to `team-design/project-mobile`.
- Putting workspace-scoped data in a global file forces all workspaces to share one binding, or requires ugly keyed structures inside the global config.

The current design also couples **workspace data** (binding) with **user preferences** (`syncMode`, `autoPush`). The former should travel with the workspace; the latter should travel with the user.

## Decision

### D1 — Split `Config.Linear` by scope

`Config.Linear` (in `packages/opencode/src/config/config.ts`) keeps only **user-level preferences** that apply regardless of workspace:

```ts
export const Linear = z
  .object({
    syncMode: z.enum(["manual", "auto-push", "auto-pull", "bidirectional"]).default("manual"),
    autoPush: z.boolean().default(false),
  })
  .strict()
```

The `teamId`, `teamName`, and `projectId` fields are **removed** from `Config.Linear`. They move to a new workspace-scoped store (D2).

The Linear MCP connection (`mcp.linear` in `opencode.jsonc`) is untouched — it is global and OAuth-based, exactly as it should be.

### D2 — New `LinearBinding.Service` (workspace-scope, dual-write)

A new Effect service `LinearBinding.Service` lives at `packages/opencode/src/issue/linear-binding.ts` and exposes:

```ts
export interface LinearBinding {
  get(): Effect.Effect<Binding | null>
  set(binding: Binding | null): Effect.Effect<Binding | null>
}
export type Binding = { teamId: string; teamName: string; projectId: string }
```

**Storage strategy — InstanceState cache + project-dir JSON file (dual-write):**

- **Cache layer**: `InstanceState.make<Binding | null>` — per-directory in-memory cache, lookup keyed by `Instance.directory`. Reads are synchronous-ish (cache hit) and never touch the filesystem.
- **Persistence layer**: `<workspace>/.opencode/linear-binding.json` — written on every `set()`, read on cache miss. Lives **inside the workspace directory**, so:
  - macOS TCC does not apply (user-owned directory, no `com.apple.provenance`).
  - Travels with the workspace (git-commit-able, shareable across machines).
  - Survives kernel restarts.

File format (JSON, not JSONC — no comments needed):

```json
{
  "teamId": "team-xyz-789",
  "teamName": "Engineering",
  "projectId": "proj-abc-123",
  "updatedAt": "2026-07-06T12:34:56.789Z"
}
```

**Atomicity**: `set()` writes the file with `fs.writeFile` to a temp path then renames — guarantees readers never see a partial JSON. After the rename, the InstanceState cache is updated, so subsequent reads see the new value immediately. The write + cache update happen inside a single Effect transaction; a write failure rolls back the cache.

**Directory layout**: `<workspace>/.opencode/` is created on first write if it does not exist. This directory is already used by other OpenCode workspace-scoped state (e.g. `.opencode/session/`), so no new convention is introduced.

### D3 — New HTTP routes

Two new instance-scoped routes replace the `PATCH /global/config` round-trip for binding mutations:

| Method | Path                    | Operation ID              | Purpose                                                                                                          |
| ------ | ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/issue/linear/binding` | `issue.linearBinding.get` | Returns current binding `{ teamId, teamName, projectId }` or `null`                                              |
| `PUT`  | `/issue/linear/binding` | `issue.linearBinding.set` | Accepts `{ teamId?, teamName?, projectId? }`, writes through to `LinearBinding.Service`, returns the new binding |

Both mount under `src/server/instance/issue.ts` alongside the existing `/issue/linear/users` and `/issue/linear/teams` routes. They take a `directory` query param like all instance routes.

The old flow (`globalSync.updateConfig({ ..., linear: { teamId, projectId, ... } })`) is removed from `SidebarLinear`.

### D4 — Refresh hook on binding change

When `PUT /issue/linear/binding` succeeds, the kernel:

1. Publishes a `linear.binding.updated` bus event with the new binding.
2. The desktop UI's event reducer reacts to this event by calling `globalSync.todo.refresh(directory)` — the same refresh hook used after sync push/pull.

This guarantees that switching team/project immediately re-pulls issues for the new binding (if the user triggers a pull) and clears any stale list state. The bus event is the single source of truth — the UI does not decide when to refresh, the kernel does.

**Atomicity for the UI**: the binding write and the bus event publish happen in one Effect transaction. Either the binding is updated AND the event is fired, or neither happens. The UI's refresh is a follow-up read after the event lands; it sees the new binding atomically.

### D5 — sync-push / sync-pull read from the new service

`sync-push.ts` and `sync-pull.ts` currently read `info.linear` from `Config.Service.get()`. They are changed to:

```ts
const binding = yield * LinearBinding.Service
const cfg = yield * binding.get()
if (!cfg?.projectId || !cfg?.teamId) {
  return yield * Effect.fail(new Error({ message: "Linear binding missing projectId or teamId" }))
}
```

The `syncMode` and `autoPush` fields stay in `Config.Linear` and are still read from `Config.Service` — they are user preferences, not workspace data.

### D6 — No migration (clean cut)

This feature is in active development and has not shipped to end users. The legacy `linear.teamId` / `teamName` / `projectId` fields that briefly lived in `Config.Linear` are **removed entirely** — no migration path is provided. Existing test workspaces that carried those fields should clear them from `opencode.jsonc` (or simply delete the `linear` section) and re-configure the binding through the new sidebar UI, which writes to `<workspace>/.opencode/linear-binding.json`.

Rationale: avoiding migration code keeps `LinearBinding.Service` focused on its single responsibility (workspace-scoped read/write). The pre-existing `Config.Linear` schema stays `.strict()` so any leftover keys surface as a clear validation error rather than being silently stripped.

## Consequences

### Positive

- **No more macOS TCC writes** for binding changes — the global config file is never touched by Linear management.
- **Workspace isolation** — each workspace has its own binding, enabling multi-team workflows.
- **Atomic UI refresh** — the bus event + refresh hook guarantees the todo list reflects the new binding immediately.
- **Git-shareable config** — `.opencode/linear-binding.json` can be committed to share team/project bindings across a team.
- **Cleaner separation** — `Config.Linear` is now purely user preferences; workspace data lives in the workspace.
- **No migration code to maintain** — `LinearBinding.Service` has a single code path (read/write the workspace file).

### Negative

- **New file per workspace** — `.opencode/linear-binding.json` accumulates. Acceptable: it's tiny and lives in the workspace's own `.opencode/` directory which already exists.
- **Pre-release configs with legacy `linear.teamId`/`projectId` keys fail validation** — intentional, surfaces the breakage immediately. Users clear those keys and re-configure via the UI.

### Out of scope

- Migrating `syncMode` / `autoPush` to workspace scope — these stay global (user preference).
- Backfilling `linear_team_id` / `linear_project_id` on existing `IssueTable` rows — they already store per-row values, and the binding only affects new issue creation.
- TUI parity — TUI will be updated in a follow-up; the kernel changes are shared.

## Open questions

None at decision time. The bus event name (`linear.binding.updated`) and file path (`.opencode/linear-binding.json`) are stable.

## Amendment 2026-07-11 — Binding schema 扩展 + selector-based 配置 UI + UUID 约定

**Status:** Accepted (2026-07-11)
**Supersedes:** parts of D2 (Binding type), D3 (route table)

### Context

D2 定义的 `Binding = { teamId, teamName, projectId }` 在实际开发中暴露出两个问题：

1. **`projectId` 存储的是 slug 而非 UUID，导致 push verify 永远 mismatch。** 用户只能从 Linear 项目 URL（如 `https://linear.app/boring-link/project/graduationdesign-69b3bec34c5f/overview`）获取信息，原 UI 解析 URL 得到的 `projectId` 是 slug（`graduationdesign-69b3bec34c5f`），而 Linear MCP `get_issue` 返回的 `projectId` 是 UUID（`e2ca8dc3-a1ec-4f65-9fdc-c6e862a87fa5`）。`verifyLinearIssue` 比较 slug vs UUID 永远失败。

2. **URL 解析不可靠。** team slug 需要通过 `slugify(team.name)` 模糊匹配 `list_teams` 返回的团队，当 team name 与 slug 差异较大时无法解析。用户也无法直观地看到可选的团队和项目。

Linear MCP 是系统连接 Linear 的唯一入口。`list_projects` 和 `list_teams` 工具返回的 `id` 字段就是 UUID，`save_issue` 接受 team name/ID 和 project name/ID/slug，`get_issue` 返回的 `projectId`/`teamId` 是 UUID。因此正确的做法是在 binding 配置时就通过 MCP 工具获取 UUID 并存储。

### Decision

1. **Binding schema 扩展。** `Binding` 新增 `projectName`（可选，用于显示）和 `projectUrl`（可选，legacy，仅用于 deep-linking，不用于 ID 解析）：

   ```ts
   export const Binding = z.object({
     teamId: z.string().describe("Linear team UUID (resolved from list_teams)"),
     teamName: z.string().describe("Linear team name (user-friendly; unique in Linear)"),
     projectId: z.string().describe("Linear project UUID (resolved from list_projects)"),
     projectName: z.string().optional().describe("Linear project name (for display)"),
     projectUrl: z
       .string()
       .optional()
       .describe("Full Linear project URL (legacy; kept for deep-linking but not used for ID resolution)"),
   })
   ```

2. **`teamId` 和 `projectId` 必须是 UUID。** 这是硬性约定。它们由 Linear MCP `list_teams`/`list_projects` 工具返回，不是从 URL 解析的 slug。`verifyLinearIssue` 比较的是 UUID vs UUID，`save_issue` 的 `team`/`project` 参数可以直接使用 UUID（Linear 接受 name/ID/slug，UUID 是 ID 的一种）。

3. **Selector-based 配置 UI。** 移除 URL 输入框，改为两个 `Select` 组件：
   - **团队选择器** — 面板打开时调用 `GET /issue/linear/teams`（背后调用 Linear MCP `list_teams`）加载团队列表
   - **项目选择器** — 选择团队后调用 `GET /issue/linear/projects?team=<teamId>`（背后调用 Linear MCP `list_projects`）加载该团队的项目列表
   - 用户手动选择团队和项目，前端直接将 UUID 传给后端存储
   - 移除了 `parseProjectUrl`、`slugify` 等所有 URL 解析逻辑

4. **新增 `GET /issue/linear/projects` 路由。** 调用 Linear MCP `list_projects` 工具，返回 `[{ id, name, state? }]`（id 为 UUID）。支持可选的 `team` query 参数按团队过滤项目。operationId: `issue.linearProjects`。

5. **D3 路由表更新。** 完整的 Linear 相关路由：

   | Method | Path                     | Operation ID              | Purpose                                                                                 |
   | ------ | ------------------------ | ------------------------- | --------------------------------------------------------------------------------------- |
   | `GET`  | `/issue/linear/binding`  | `issue.linearBinding.get` | Returns current binding or `null`                                                       |
   | `PUT`  | `/issue/linear/binding`  | `issue.linearBinding.set` | Accepts `{ teamId?, teamName?, projectId?, projectName?, projectUrl? }`, writes through |
   | `GET`  | `/issue/linear/teams`    | `issue.linearTeams`       | Lists teams via MCP `list_teams`                                                        |
   | `GET`  | `/issue/linear/projects` | `issue.linearProjects`    | Lists projects via MCP `list_projects` (optional `team` filter)                         |
   | `GET`  | `/issue/linear/users`    | `issue.linearUsers`       | Lists users via MCP `list_users`                                                        |
   | `GET`  | `/issue/linear/statuses` | `issue.linearStatuses`    | Lists workflow states via MCP `list_issue_statuses`                                     |

### Migration

无需数据库迁移。`projectName` 和 `projectUrl` 是可选字段，旧 binding 文件不包含它们也能正常解析。但旧的 `projectId` 若存储的是 slug，需要用户通过新 UI 重新选择项目以写入正确的 UUID——这是配置层的一次性修正，不影响数据层。
