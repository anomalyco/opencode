# Remove `packages/opencode/src/storage/db.ts`

## Goal

Remove all production usages of the legacy `packages/opencode/src/storage/db.ts` module.

This means eliminating imports from `@/storage/db` or `./storage/db`, including:

- `Database.use(...)`
- `Database.transaction(...)`
- `Database.effect(...)`
- `Database.Client()`
- `Database.getPath()`
- `Database.TxOrDb` / `Database.Transaction`
- drizzle helpers re-exported from `@/storage/db`, such as `eq`

This does not mean removing SQLite or Drizzle everywhere in one step. The smaller target is deleting the opencode legacy wrapper by moving call sites onto deeper modules or onto the core/effect database adapter directly.

## Current Inventory

Production imports from `packages/opencode/src/storage/db.ts` are concentrated in 22 source files:

- `packages/opencode/src/account/repo.ts`
- `packages/opencode/src/cli/cmd/db.ts`
- `packages/opencode/src/cli/cmd/import.ts`
- `packages/opencode/src/cli/cmd/stats.ts`
- `packages/opencode/src/control-plane/workspace.ts`
- `packages/opencode/src/data-migration.ts`
- `packages/opencode/src/index.ts`
- `packages/opencode/src/node.ts`
- `packages/opencode/src/permission/index.ts`
- `packages/opencode/src/project/project.ts`
- `packages/opencode/src/server/projectors.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts`
- `packages/opencode/src/server/shared/fence.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/session/projectors.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/todo.ts`
- `packages/opencode/src/share/share-next.ts`
- `packages/opencode/src/storage/db.ts`
- `packages/opencode/src/sync/index.ts`
- `packages/opencode/src/worktree/index.ts`

There are 65 direct API/type references in those files. The references fall into the groups below.

## Group 1: Database Runtime And Startup

Files:

- `packages/opencode/src/storage/db.ts`
- `packages/opencode/src/index.ts`
- `packages/opencode/src/node.ts`
- `packages/opencode/src/cli/cmd/db.ts`

Current usage:

- `storage/db.ts` opens the singleton database, applies pragmas, exposes callback-style access, holds ambient transaction context, and queues post-commit effects.
- `index.ts` checks `Database.getPath()` to decide whether JSON migration is needed, then runs `JsonMigration.run(drizzle({ client: Database.Client().$client }), ...)`.
- `node.ts` publicly re-exports `Database` from the legacy module.
- `cli/cmd/db.ts` uses `Database.getPath()` to print the path, open a readonly Bun SQLite handle, run `sqlite3`, and vacuum.

Why this group comes first:

- These call sites define the seam currently used by every other group.
- Deleting `storage/db.ts` requires an explicit replacement for database path, client acquisition, migration startup, and close/finalization.

Target shape:

- Move database path and client startup behind the core/effect database module rather than the opencode wrapper.
- Replace `Database.Client()` with an Effect-provided database service or a narrow startup-only adapter.
- Replace the public `node.ts` re-export with either no export or a stable non-legacy database capability.
- Keep `cli/cmd/db.ts` as an admin/raw SQLite tool, but make it ask the replacement database path provider instead of importing `@/storage/db`.

## Group 2: Sync Event Transaction Boundary

Files:

- `packages/opencode/src/sync/index.ts`
- `packages/opencode/src/session/projectors.ts`
- `packages/opencode/src/server/projectors.ts`

Current usage:

- `SyncEvent.run` uses `Database.transaction(..., { behavior: "immediate" })` to allocate event sequence numbers safely.
- `SyncEvent.process` wraps projector execution, event sequence writes, event log writes, and post-commit publishing in `Database.transaction(...)`.
- `Database.effect(...)` queues publish side effects until after the transaction commits.
- Projector functions accept `Database.TxOrDb` so they can write through either a root client or the active transaction.

Why this group is critical:

- It depends on the most non-obvious legacy behavior: nested `Database.use` inside a transaction must see the active transaction, and `Database.effect` must not publish until commit.
- It is the central seam for session, message, permission, workspace, and server projection writes.

Target shape:

- Replace `Database.TxOrDb` with an explicit projector transaction type from the replacement database adapter.
- Move transaction context and after-commit behavior into an Effect-native sync event implementation.
- Preserve immediate transaction behavior for sequence allocation.
- Convert projector registration to accept the new transaction interface before converting every projector body.

Suggested first step:

- Create a narrow internal module for sync projection execution, then migrate `SyncEvent.project(...)` and projector type signatures to that module. Keep the implementation backed by the new database adapter until all projector users are moved.

## Group 3: Domain Repositories Already Behind Services

Files:

- `packages/opencode/src/account/repo.ts`
- `packages/opencode/src/project/project.ts`
- `packages/opencode/src/control-plane/workspace.ts`
- `packages/opencode/src/share/share-next.ts`

Current usage:

- These modules already expose Effect services or Effect functions, but internally wrap `Database.use` with local `db(...)` helpers or `Effect.try`.
- `account/repo.ts` uses both `Database.use` and `Database.transaction` through a repository interface.
- `project/project.ts` has the largest mixed usage: Effect service methods use a local `db(...)` helper, while legacy top-level functions still call `Database.use` directly.
- `control-plane/workspace.ts` and `share/share-next.ts` have local Effect wrappers around `Database.use`.

Why this group is tractable:

- The public interfaces are already deeper than the database calls.
- Most callers should not need to know whether these modules use Drizzle, files, or core services internally.

Target shape:

- Inject the replacement database service into each Effect layer and yield Effect Drizzle queries directly.
- Replace local callback wrappers with direct Effect queries.
- Move remaining synchronous top-level helpers either behind the existing service interface or onto core modules.

Suggested order:

- Start with `account/repo.ts`; it has a clear repository interface and few call sites.
- Then migrate `share/share-next.ts` and `control-plane/workspace.ts` local wrappers.
- Leave `project/project.ts` for last in this group because it mixes project resolution, VCS, global bus emission, migration, and legacy top-level helpers.

## Group 4: Session And Message Read Models

Files:

- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/todo.ts`
- `packages/opencode/src/session/projectors.ts`

Current usage:

- `session/session.ts` uses `Database.use` for session reads, list queries, children, part lookup, and global list helpers.
- `session/message-v2.ts` uses `Database.use` to page messages, hydrate parts, fetch one message, and fetch parts.
- `session/prompt.ts` imports `eq` from `@/storage/db` and reads current prompt-related session/message rows directly.
- `session/todo.ts` uses `Database.transaction` for todo replacement and `Database.use` for list reads.
- `session/projectors.ts` uses `TxOrDb` for session/message usage projection helpers.

Why this group should be split:

- Reads can move independently from projector writes.
- Message hydration is used by model prompt construction and session APIs, so changing it without a stable read module would spread query details across callers.
- Projector writes are tied to Group 2's transaction type.

Target shape:

- Create or use a session/message read module with Effect-native methods for `get`, `list`, `page`, `parts`, and prompt assembly reads.
- Move todo persistence either into a session todo repository or into the sync event projection path.
- Convert `session/projectors.ts` only after Group 2 defines the replacement projector transaction type.

Suggested order:

- Migrate `session/message-v2.ts` reads first because the module already centralizes message pagination and hydration.
- Migrate `session/session.ts` read helpers next.
- Migrate `session/prompt.ts` after message/session reads exist, and import drizzle operators from `drizzle-orm` if any direct SQL remains temporarily.
- Migrate `session/todo.ts` writes with the sync transaction work or move them behind a repository.

## Group 5: Legacy CLI And One-Off Admin Reads

Files:

- `packages/opencode/src/cli/cmd/import.ts`
- `packages/opencode/src/cli/cmd/stats.ts`
- `packages/opencode/src/server/shared/fence.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts`
- `packages/opencode/src/worktree/index.ts`
- `packages/opencode/src/permission/index.ts`

Current usage:

- `cli/cmd/import.ts` writes imported sessions/messages/parts directly with `Database.use`.
- `cli/cmd/stats.ts` reads all sessions directly.
- `server/shared/fence.ts` queries sessions for fence context.
- `handlers/sync.ts` reads event rows for HTTP sync endpoints.
- `worktree/index.ts` looks up a project row for worktree behavior.
- `permission/index.ts` reads permission rows directly.

Why this group is mostly cleanup:

- Most usages are small and can either call an existing domain service or be given a narrow query function.
- They are not defining shared transaction semantics.

Target shape:

- Replace direct database reads with existing services where possible.
- For admin/import commands, prefer dedicated import/stat modules rather than direct database access from command handlers.
- For HTTP sync reads, move the event log query behind the sync event module.
- For permission and worktree reads, call the permission/project services if available; otherwise add narrow repository methods.

## Group 6: Data Migrations

Files:

- `packages/opencode/src/data-migration.ts`

Current usage:

- Checks `DataMigrationTable` with `Database.use`.
- Runs resumable data migrations with `Database.use` and `Database.transaction`.
- Writes completion rows with `Database.use`.

Why this group is separate:

- Data migrations are database-native by definition and may reasonably stay close to SQL.
- They should not depend on the legacy opencode wrapper, but they do need a stable transaction API and migration completion store.

Target shape:

- Run data migrations through the same Effect database service used by startup/migrations.
- Keep SQL-heavy migration logic local to `data-migration.ts`, but remove callback-style legacy access.
- Ensure migrations still run in a scoped/background fiber and remain resumable.

## Recommended Migration Sequence

1. Replace the legacy runtime seam from Group 1 with an Effect-native database module that exposes path, client/query access, transaction, and after-commit behavior.
2. Port Group 2 sync event transaction semantics to the new module before touching projector bodies.
3. Migrate Group 3 repositories that already hide database access behind service interfaces.
4. Migrate Group 4 session/message reads, then projector write helpers once the new projector transaction type exists.
5. Migrate Group 6 data migrations onto the new database service.
6. Clean up Group 5 one-off reads and CLI/admin commands.
7. Remove drizzle helper re-exports from `@/storage/db` imports by importing operators directly from `drizzle-orm` during each file migration.
8. Delete `packages/opencode/src/storage/db.ts` once `rg "@/storage/db|./storage/db|Database\." packages/opencode/src` no longer finds legacy usages.

## Invariants To Preserve

- Nested reads inside a transaction must use the active transaction, not the root client.
- `SyncEvent.run` sequence allocation must keep immediate transaction behavior.
- Post-commit publish effects must not run before the transaction commits.
- Data migrations must remain resumable and record completion only after successful migration work.
- Existing schema ownership remains in `packages/core/src/**/*.sql.ts`; do not move table definitions back into `packages/opencode`.

## Verification Commands

- `rg "@/storage/db|./storage/db|Database\.(use|transaction|effect|Client|getPath)|\bTxOrDb\b|\bTransaction\b" packages/opencode/src`
- `bun typecheck` from `packages/opencode`
- Relevant package tests from `packages/opencode`, not the repo root
