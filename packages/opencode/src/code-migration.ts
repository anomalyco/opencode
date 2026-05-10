import { Context, Effect, Layer } from "effect"
import { Database } from "./storage/db"
import { CodeMigrationTable } from "./code-migration.sql"
import * as Log from "@opencode-ai/core/util/log"
import { eq } from "drizzle-orm"

export type Migration = {
  name: string
  run: Effect.Effect<void, unknown>
}

const log = Log.create({ service: "code-migration" })

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeMigration") {}

export const make = (build: () => Migration[]) => Layer.effect(
  Service,
  Effect.gen(function* () {
    const migrations = build()

    yield* Effect.gen(function* () {
      if (migrations.length === 0) return

      // Migrations run in a background fiber, so they must be resumable until
      // their completion row is written.
      for (const migration of migrations) {
        const completed = Database.use((db) =>
          db
            .select({ name: CodeMigrationTable.name })
            .from(CodeMigrationTable)
            .where(eq(CodeMigrationTable.name, migration.name))
            .get(),
        )
        if (completed) continue

        log.info("running code migration", { name: migration.name })
        yield* migration.run
        Database.use((db) =>
          db
            .insert(CodeMigrationTable)
            .values({ name: migration.name, time_completed: Date.now() })
            .onConflictDoNothing()
            .run(),
        )
      }
    }).pipe(
      Effect.tapCause((cause) => Effect.logError("failed to run code migrations", { cause })),
      Effect.ignore,
      Effect.forkScoped,
    )
    return Service.of({})
  }),
)

export const layer = make(() => [])

export const defaultLayer = layer

export * as CodeMigration from "./code-migration"
