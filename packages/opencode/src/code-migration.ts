import { Context, Effect, Layer } from "effect"
import { Database } from "./storage/db"
import { CodeMigrationTable } from "./code-migration.sql"
import { Session } from "./session/session"
import * as Log from "@opencode-ai/core/util/log"
import { eq } from "drizzle-orm"

export type Migration<R = never> = {
  name: string
  run: Effect.Effect<void, unknown, R>
}

const log = Log.create({ service: "code-migration" })

export interface Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeMigration") {}

export const make = <R>(build: Effect.Effect<Migration<R>[], never, R>) => Layer.effect(
  Service,
  Effect.gen(function* () {
    const migrations = yield* build

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

export const layer = make(
  Effect.gen(function* () {
    const session = yield* Session.Service
    return [
      {
        name: "list-sessions-with-session-service",
        run: Effect.gen(function* () {
          const sessions = yield* session.list()
          log.info("listed sessions with session service", { count: sessions.length })
        }),
      },
    ]
  }),
)

export const defaultLayer = layer

export * as CodeMigration from "./code-migration"
