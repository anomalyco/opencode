import { Context, Effect, Layer } from "effect"
import { Database, type TxOrDb } from "./storage/db"
import { CodeMigrationTable } from "./code-migration.sql"
import * as Log from "@opencode-ai/core/util/log"

export type Migration = {
  name: string
  run: (db: TxOrDb) => Effect.Effect<void, unknown>
}

const log = Log.create({ service: "code-migration" })

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeMigration") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const migrations: Migration[] = []

    yield* Effect.gen(function* () {
      if (migrations.length === 0) return

      const db = yield* Effect.sync(() => Database.Client())
      yield* Effect.sync(() => db.run("BEGIN IMMEDIATE"))

      yield* Effect.gen(function* () {
        const completed = yield* Effect.sync(
          () =>
            new Set(
              db
                .select({ name: CodeMigrationTable.name })
                .from(CodeMigrationTable)
                .all()
                .map((row) => row.name),
            ),
        )
        for (const migration of migrations.filter((item) => !completed.has(item.name))) {
          yield* Effect.sync(() => log.info("running code migration", { name: migration.name }))
          yield* migration.run(db)
          yield* Effect.sync(() =>
            db
              .insert(CodeMigrationTable)
              .values({ name: migration.name, time_completed: Date.now() })
              .onConflictDoNothing()
              .run(),
          )
          completed.add(migration.name)
        }
      }).pipe(
        Effect.tap(() => Effect.sync(() => db.run("COMMIT"))),
        Effect.tapCause(() => Effect.sync(() => db.run("ROLLBACK")).pipe(Effect.ignore)),
      )
    }).pipe(
      Effect.tapCause((cause) => Effect.sync(() => log.error("failed to run code migrations", { cause }))),
      Effect.ignore,
      Effect.forkScoped,
    )
    return Service.of({})
  }),
)

export const defaultLayer = layer

export * as CodeMigration from "./code-migration"
