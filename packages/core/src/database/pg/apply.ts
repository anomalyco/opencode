export * as PgApply from "./apply.js"

import { Effect } from "effect"
import type { Database } from "../postgres.node.js"
import baseline from "./baseline.generated.js"
import migrationIds from "./migration-ids.generated.js"

// Any stable 63-bit key. One per database is enough: bootstrap is the only
// thing that takes it.
const LOCK_KEY = "8241993071"

// Splits the generated baseline into single statements. The generator emits one
// statement per block, never a semicolon inside a string literal, so splitting
// on ";" at end of line is exact. BEGIN/COMMIT are dropped because the caller
// supplies the transaction.
export const statements = (script: string): ReadonlyArray<string> =>
  script
    .split(/;\s*\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((chunk) => chunk.length > 0)
    .filter((chunk) => chunk.toUpperCase() !== "BEGIN" && chunk.toUpperCase() !== "COMMIT")

const migrationValues = (at: number) =>
  migrationIds.map((id) => "('" + id + "', " + at + ")").join(", ")

// Applies the PostgreSQL baseline exactly once.
//
// The marker is the same one SQLite bootstrap uses: session_v2 existing means
// the schema is already there. Everything runs in one transaction under an
// advisory lock, so two workers starting against an empty database cannot race
// and a failure leaves nothing behind.
export const apply = (db: Database) =>
  Effect.gen(function* () {
    // Resolve the target schema through search_path: bootstrap runs in public by
    // default, but a scratch schema (tests) or a tenant schema can be selected
    // by connecting with a search_path startup parameter.
    const state = yield* db.get<{ present: boolean }>(
      "select to_regclass(format('%I.session_v2', current_schema())) is not null as present",
    )
    if (state?.present) return { applied: false, statements: 0 } as const

    const tables = yield* db.all<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() and left(tablename, 1) <> '_'",
    )
    if (tables.length > 0) return yield* Effect.die(new Error("Database is not empty and has no session table"))

    const list = statements(baseline)
    const started = Date.now()
    yield* Effect.logInfo("database schema bootstrap started", { statements: list.length, migrations: migrationIds.length })
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run("select pg_advisory_xact_lock(" + LOCK_KEY + ")")
        // Another process may have finished between the check above and the lock.
        const raced = yield* tx.get<{ present: boolean }>(
          "select to_regclass(format('%I.session_v2', current_schema())) is not null as present",
        )
        if (raced?.present) return
        for (const statement of list) yield* tx.run(statement)
        const at = Date.now()
        yield* tx.run(
          "insert into migration (id, time_completed) values " +
            migrationValues(at) +
            " on conflict (id) do nothing",
        )
      }),
    )
    yield* Effect.logInfo("database schema bootstrap completed", {
      statements: list.length,
      migrations: migrationIds.length,
      durationMs: Date.now() - started,
    })
    return { applied: true, statements: list.length } as const
  })
