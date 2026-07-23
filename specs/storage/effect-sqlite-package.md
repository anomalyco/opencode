# Effect Drizzle SQLite Package

## Goal

Create a small workspace package that vendors the Drizzle `effect-sqlite` adapter shape for our repo. This is not an opencode storage abstraction. It is a local package that ports the Drizzle Effect SQLite implementation so we can use it before/independently of upstream release timing.

`packages/opencode` will use it internally, but the package itself should be generic: Drizzle + Effect + SQLite. No opencode paths, migrations, tables, transaction hooks, post-commit behavior, or domain language should live in this package.

## Package Shape

Add a package similar in style to `packages/http-recorder`:

- `packages/effect-drizzle-sqlite/package.json`
- `packages/effect-drizzle-sqlite/src/index.ts`
- `packages/effect-drizzle-sqlite/src/effect-sqlite/*`
- `packages/effect-drizzle-sqlite/src/sqlite-core/effect/*`
- `packages/effect-drizzle-sqlite/test/sqlite.test.ts`

Package name:

- `@opencode-ai/effect-drizzle-sqlite`

Initial exports:

```ts
export { EffectLogger } from "drizzle-orm/effect-core"
export * from "./effect-sqlite/driver"
export * from "./effect-sqlite/session"
export { migrate } from "./effect-sqlite/migrator"
export * as EffectDrizzleSqlite from "."
```

The package should follow Drizzle's adapter naming and semantics as closely as possible. Think of it as a vendored `drizzle-orm/effect-sqlite` package surface, not as a new storage service API.

## Upstream References

Use these as implementation references instead of inventing a custom API:

- Drizzle Effect Postgres current RC:
  - `/Users/kit/code/open-source/drizzle-orm-rc4-pr/drizzle-orm/src/effect-core/query-effect.ts`
  - `/Users/kit/code/open-source/drizzle-orm-rc4-pr/integration-tests/tests/pg/effect-sql.test.ts`
- SQLite Effect branch/reference:
  - `/Users/kit/code/open-source/drizzle-orm-beta16/drizzle-orm/src/up-migrations/effect-sqlite.ts`
  - `/Users/kit/code/open-source/drizzle-orm-beta16/integration-tests/tests/sqlite/effect-sql.test.ts`
  - `/Users/kit/code/open-source/drizzle-orm-beta16/drizzle-orm/type-tests/sqlite/effect.ts`
- Effect SQLite client source of truth:
  - `/Users/kit/code/open-source/effect-smol/packages/sql/sqlite-bun/src/SqliteClient.ts`
  - `/Users/kit/code/open-source/effect-smol/packages/sql/sqlite-node/test/Client.test.ts`
  - `/Users/kit/code/open-source/effect-smol/packages/sql/sqlite-node/test/SqliteMigrator.test.ts`

Important API patterns from those references:

- Drizzle queries are Effect-yieldable: `yield* db.select().from(table)`.
- Transactions are Effect values: `yield* db.transaction((tx) => Effect.gen(...), { behavior: "immediate" })`.
- SQLite clients come from Effect layers such as `SqliteClient.layer({ filename })`.
- Migrations can run through Effect SQL/SQLite migrator mechanisms or Drizzle's `effect-sqlite/migrator` when available.

## Public Surface

Do not invent an `Interface<TDatabase>` abstraction unless the Drizzle port already has one. The public surface should mirror Drizzle's Effect adapters:

```ts
const db = yield * EffectDrizzleSqlite.make({ relations }).pipe(Effect.provide(EffectDrizzleSqlite.DefaultServices))

yield * db.select().from(users)
yield *
  db.transaction(
    (tx) =>
      Effect.gen(function* () {
        yield* tx.insert(users).values({ name: "Ada" })
      }),
    { behavior: "immediate" },
  )
```

Notes:

- `make` / `makeWithDefaults` should match the Drizzle Effect SQLite branch as much as possible.
- `DefaultServices` should provide Drizzle's default logger/cache services, same as Effect Postgres.
- The package should depend on Effect SQL SQLite clients (`@effect/sql-sqlite-bun` and/or node) the same way the Drizzle branch does.
- Opencode-specific path/channel selection stays in `packages/opencode`.

## Opencode Adoption Notes

These are not package requirements, but they matter for the later opencode adoption PR.

The current `packages/opencode/src/storage/db.ts` has two non-obvious semantics that the opencode wrapper must preserve when it consumes this adapter:

- Nested `Database.use` inside `Database.transaction` sees the current transaction, not the root client.
- `Database.effect` queues post-commit side effects while inside a transaction, and runs immediately outside a transaction.

The opencode wrapper can implement that using Effect context instead of `LocalContext`:

- A private transaction context holding `{ tx, afterCommit }`.
- `withDb`/`db` methods read the current transaction context if present, otherwise use the root db.
- `transaction` installs a transaction context around the effect.
- Nested transactions can either reuse the existing tx initially, matching current behavior, or later use explicit savepoints if needed.

Do not remove this behavior while moving opencode to Effect SQLite. `SyncEvent.run` depends on transaction composability and `behavior: "immediate"` for sequencing correctness.

## Migration Strategy

1. Add `@opencode-ai/effect-drizzle-sqlite` with a minimal in-memory/file SQLite test schema.
2. Port the Drizzle Effect SQLite adapter from the SQLite branch into the package, preserving upstream names and API shape.
3. Test adapter-level guarantees:
   - query builders are yieldable Effect values,
   - `transaction(..., { behavior: "immediate" })` commits successful writes,
   - failed transaction rolls back,
   - migrations run once and in order,
   - close finalizer closes the underlying SQLite database.
4. Add `@opencode-ai/effect-drizzle-sqlite` as a dependency of `packages/opencode`.
5. Port `packages/opencode/src/storage/db.ts` to be a thin compatibility wrapper over the adapter plus opencode-specific transaction/post-commit context.
6. Keep existing call sites working first:
   - `Database.Client()`
   - `Database.use(...)`
   - `Database.transaction(...)`
   - `Database.effect(...)`
7. After compatibility is stable, migrate call sites from callback-style `Database.use` to yielding Effect Drizzle queries directly.
8. Only then build domain stores like session/message/project stores on top of opencode's storage wrapper.

## Why This Is Cleaner Than Starting With SessionStorage

`SessionStorage` is a useful domain seam, but it does not answer the core adapter problem: how to make Drizzle SQLite Effect-native in this repo.

An Effect Drizzle SQLite package lets us vendor the adapter once. Then opencode can build its own storage wrapper on top, and `SessionStorage`, `MessageStorage`, event store, and projector writes can all share the same transaction and migration model.

## Open Questions

- Which client should the first package target: `@effect/sql-sqlite-bun`, `@effect/sql-sqlite-node`, or both behind separate layers?
- How much source should we copy from the Drizzle branch versus import from catalog `drizzle-orm` internals?
- What is the update path once Drizzle upstream ships `effect-sqlite`?
- Should `afterCommit` stay opencode-specific until event publishing moves? Default answer: yes.
- Should the compatibility wrapper preserve synchronous return types temporarily, or should the migration intentionally force Effect call sites?
- Do CLI/admin raw SQL and sqlite shell stay in `packages/opencode`, or does the storage package expose backend capabilities for them?

## Recommended First PR

Make the first PR package-only and intentionally boring:

- Add `packages/effect-drizzle-sqlite`.
- Use a tiny test schema, not opencode domain tables.
- Prove Effect Drizzle SQLite queries, transactions, and migrations.
- Do not migrate `packages/opencode` yet except possibly adding the dependency if needed for typechecking.

That gives us a focused place to validate the Effect SQLite approach before disturbing opencode's current database runtime.
