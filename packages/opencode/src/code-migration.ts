import { Context, Effect, Layer } from "effect"
import { Database, type TxOrDb } from "./storage/db"
import { CodeMigrationTable } from "./code-migration.sql"
import * as Log from "@opencode-ai/core/util/log"
import { eq } from "drizzle-orm"

export type Migration = {
  name: string
  run: (db: TxOrDb) => void | Promise<void>
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

      for (const migration of migrations) {
        yield* Effect.promise(async () => {
          const db = Database.Client()
          db.run("BEGIN IMMEDIATE")
          try {
            const completed = db
              .select({ name: CodeMigrationTable.name })
              .from(CodeMigrationTable)
              .where(eq(CodeMigrationTable.name, migration.name))
              .get()
            if (!completed) {
              log.info("running code migration", { name: migration.name })
              await migration.run(db)
              db.insert(CodeMigrationTable)
                .values({ name: migration.name, time_completed: Date.now() })
                .onConflictDoNothing()
                .run()
            }
            db.run("COMMIT")
          } catch (error) {
            db.run("ROLLBACK")
            throw error
          }
        })
      }
    }).pipe(
      Effect.tapCause((cause) => Effect.logError("failed to run code migrations", { cause })),
      Effect.ignore,
      Effect.forkScoped,
    )
    return Service.of({})
  }),
)

export const defaultLayer = layer

export * as CodeMigration from "./code-migration"
