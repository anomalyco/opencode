# Multi-Dialect Database Support

**Date:** 2026-04-04
**Status:** Approved

## Goal

Allow users to configure a remote Postgres database instead of the default local SQLite, via a `OPENCODE_DATABASE_URL` environment variable. The rest of the system (sync, share, control-plane) remains unchanged.

## Current State

- All storage uses embedded SQLite via Drizzle ORM
- Schema defined with `drizzle-orm/sqlite-core` (`sqliteTable`, `text()`, `integer()`)
- Two platform-specific drivers: `db.bun.ts` (bun:sqlite) and `db.node.ts` (node:sqlite)
- `Database.use()` and `Database.transaction()` are synchronous
- Single global client singleton, no connection pool
- Column types used: `text()`, `integer()`, `text({ mode: "json" })`, `integer({ mode: "boolean" })`

## Design

### 1. Configuration & Dialect Detection

**New env var:** `OPENCODE_DATABASE_URL` added to `flag.ts`.

**Dialect detection logic:**
- `OPENCODE_DATABASE_URL` starting with `postgres://` or `postgresql://` -> Postgres
- `OPENCODE_DATABASE_URL` absent, or any other value -> SQLite (existing behavior)
- `OPENCODE_DB` remains for backward compat; `OPENCODE_DATABASE_URL` takes precedence

**New module:** `storage/dialect-detect.ts`
```typescript
export type Dialect = "sqlite" | "postgres"
export function detectDialect(): Dialect
export const DIALECT: Dialect
```

### 2. Schema Dialect Shim

**New module:** `storage/dialect.ts`

Re-exports table constructors and column types from the correct Drizzle dialect package based on `DIALECT`:

| Unified Export | SQLite Source | Postgres Source |
|---|---|---|
| `table()` | `sqliteTable` | `pgTable` |
| `text()` | `text()` | `text()` |
| `integer()` | `integer()` | `integer()` |
| `json()` | `text({ mode: "json" })` | `jsonb()` |
| `boolean()` | `integer({ mode: "boolean" })` | `boolean()` |
| `index` | from sqlite-core | from pg-core |
| `primaryKey` | from sqlite-core | from pg-core |

**Schema file changes:** All 7 `*.sql.ts` files change their import:
- `session.sql.ts` — imports from dialect shim
- `project.sql.ts` — imports from dialect shim
- `account.sql.ts` — imports from dialect shim
- `share.sql.ts` — imports from dialect shim
- `workspace.sql.ts` — imports from dialect shim
- `event.sql.ts` — imports from dialect shim
- `schema.sql.ts` (Timestamps) — imports from dialect shim

### 3. Driver Layer

**New file:** `storage/db.pg.ts`
```typescript
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

export function init(url: string) {
  const client = postgres(url)
  return drizzle({ client })
}
```

**Modified:** `storage/db.ts`
- `init()` call becomes dialect-aware: SQLite gets a file path, Postgres gets a URL
- SQLite PRAGMAs wrapped in `if (DIALECT === "sqlite")` guard
- Migration loading selects the right directory based on dialect
- `Client` type becomes `SQLiteBunDatabase | PostgresJsDatabase`
- `Transaction` type becomes a union of SQLite and Postgres transaction types

**Package dependency:** Add `postgres` to `dependencies` in `package.json`.

### 4. Async Wrapper

**`Database.use()`** — signature changes:
```typescript
// Before
export function use<T>(callback: (trx: TxOrDb) => T): T
// After
export async function use<T>(callback: (trx: TxOrDb) => T | Promise<T>): Promise<T>
```

**`Database.transaction()`** — signature changes:
```typescript
// Before
export function transaction<T>(callback: (tx: TxOrDb) => NotPromise<T>, options?): NotPromise<T>
// After
export async function transaction<T>(callback: (tx: TxOrDb) => T | Promise<T>, options?): Promise<T>
```

- `NotPromise<T>` type guard removed
- All ~40 callsites across the codebase add `await`
- `Database.effect()` queue continues to work — effects fire after the awaited result

**Key callsite files:**
- `session/index.ts`
- `session/message-v2.ts`
- `session/todo.ts`
- `account/repo.ts`
- `project/project.ts`
- `control-plane/workspace.ts`
- `sync/index.ts`
- `share/share-next.ts`
- `permission/index.ts`
- `server/projectors.ts`
- `cli/cmd/import.ts`
- `cli/cmd/stats.ts`

### 5. Migrations

- **SQLite:** Existing `migration/` directory unchanged
- **Postgres:** New `migration-pg/` directory
- **Generation:** New `drizzle.pg.config.ts` pointing to `migration-pg/` with `dialect: "postgresql"`
- **Runtime:** `Database.Client` loads migrations from the correct directory based on `DIALECT`
- Postgres migrator: `drizzle-orm/postgres-js/migrator` (async)

### 6. Testing Strategy

**Docker setup:**
```bash
docker run -d --name opencode-pg \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=opencode_test \
  -p 5432:5432 \
  postgres:16
```

**Unit tests:**
1. `dialect-detect.test.ts` — URL parsing, dialect detection
2. `dialect.test.ts` — shim exports correct types per dialect
3. `db.pg.test.ts` — Postgres driver init and basic connectivity

**Integration tests:**
4. `db.integration.test.ts` — CRUD operations against both SQLite and Postgres
   - Create/read/update/delete for each table
   - JSON column handling
   - Foreign key cascades
   - Transaction rollback behavior

**Test config:**
- `OPENCODE_DATABASE_URL=postgres://postgres:test@localhost:5432/opencode_test`
- Tests create/drop a fresh database per test suite

## Files Changed

| File | Change |
|---|---|
| `src/flag/flag.ts` | Add `OPENCODE_DATABASE_URL` |
| `src/storage/dialect-detect.ts` | New: dialect detection |
| `src/storage/dialect.ts` | New: schema type shim |
| `src/storage/db.pg.ts` | New: Postgres driver |
| `src/storage/db.ts` | Async wrapper, dialect-aware init |
| `src/storage/db.bun.ts` | No change |
| `src/storage/db.node.ts` | No change |
| `src/storage/schema.sql.ts` | Import from dialect shim |
| `src/session/session.sql.ts` | Import from dialect shim |
| `src/project/project.sql.ts` | Import from dialect shim |
| `src/account/account.sql.ts` | Import from dialect shim |
| `src/share/share.sql.ts` | Import from dialect shim |
| `src/control-plane/workspace.sql.ts` | Import from dialect shim |
| `src/sync/event.sql.ts` | Import from dialect shim |
| ~40 callsite files | Add `await` to `Database.use/transaction` |
| `package.json` | Add `postgres` dependency |
| `drizzle.pg.config.ts` | New: Postgres drizzle-kit config |
| `migration-pg/` | New: Postgres migration directory |

## Out of Scope

- MySQL support (can be added later with the same shim pattern)
- Connection pooling configuration
- Read replicas
- Changes to sync, share, or control-plane data flows
- LibSQL/Turso support
