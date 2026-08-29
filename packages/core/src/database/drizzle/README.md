# Effect Drizzle SQLite Adapter

This subtree is an upstream-derived Drizzle ORM fork adapted to run SQLite query
builders over Effect's generic `SqlClient`. It is maintained source, not
generated output.

## Provenance

The implementation is derived from Drizzle ORM's Effect SQLite driver/session,
SQLite Effect query builders, and shared query-builder utilities. The
corresponding upstream source families are `drizzle-orm/src/effect-sqlite`,
`drizzle-orm/src/sqlite-core`, and `drizzle-orm/src/utils.ts`.

The exact upstream revision originally copied into this repository is unknown.
The currently pinned `drizzle-orm` version is a compatibility dependency, not
copy provenance.

## Local Boundary

The supported local entrypoint is `@opencode-ai/core/database/drizzle`, exposed
as the `EffectDrizzleSqlite` namespace. OpenCode's database service consumes that
facade from `database/database.ts`.

Material local adaptations include:

- a runtime-independent driver over Effect's generic `SqlClient`
- local cache, mapping, and runtime-inspection helpers
- suppressed statement tracing beneath the database operation boundary
- explicit SQLite transactions and savepoints
- native transaction delegation for Durable Object SQLite
- deliberate query-builder variance annotations

Preserve these adaptations when comparing or synchronizing upstream code.
Focused regression coverage is in `test/database-drizzle.test.ts` and
`test/sqlite-workerd.test.ts`.
