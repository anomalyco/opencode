import { Context, Effect, Layer } from "effect"
import { makeRuntime } from "./effect/run-service"
import { Database, type TxOrDb } from "./storage/db"
import { CodeMigrationTable } from "./code-migration.sql"
import * as Log from "@opencode-ai/core/util/log"

export type Migration = {
  name: string
  run: (db: TxOrDb) => void | Promise<void>
}

export interface Interface {
  readonly start: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeMigration") {}

const log = Log.create({ service: "code-migration" })

export const All: Migration[] = []

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let started = false

    const start = Effect.fn("CodeMigration.start")(function* () {
      if (started) return
      started = true
      yield* Effect.sync(() => {
        void runPending().catch((error) => {
          log.error("failed to run code migrations", { error })
        })
      })
    })

    return Service.of({ start })
  }),
)

export const defaultLayer = layer

async function runPending() {
  if (All.length === 0) return

  const db = Database.Client()
  db.run("BEGIN IMMEDIATE")

  try {
    const completed = new Set(
      db
        .select({ name: CodeMigrationTable.name })
        .from(CodeMigrationTable)
        .all()
        .map((row) => row.name),
    )
    for (const migration of All.filter((item) => !completed.has(item.name))) {
      log.info("running code migration", { name: migration.name })
      await migration.run(db)
      db.insert(CodeMigrationTable)
        .values({ name: migration.name, time_completed: Date.now() })
        .onConflictDoNothing()
        .run()
      completed.add(migration.name)
    }
    db.run("COMMIT")
  } catch (error) {
    db.run("ROLLBACK")
    throw error
  }
}

const { runFork } = makeRuntime(Service, defaultLayer)

export function start() {
  runFork((svc) => svc.start())
}

export * as CodeMigration from "./code-migration"
