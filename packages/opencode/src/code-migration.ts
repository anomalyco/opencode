import { Context, Effect, Layer } from "effect"
import { Database, type TxOrDb } from "./storage/db"
import { CodeMigrationTable } from "./code-migration.sql"
import * as Log from "@opencode-ai/core/util/log"

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

    void runPending(migrations).catch((error) => {
      log.error("failed to run code migrations", { error })
    })
    return Service.of({})
  }),
)

export const defaultLayer = layer

async function runPending(migrations: Migration[]) {
  if (migrations.length === 0) return

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
    for (const migration of migrations.filter((item) => !completed.has(item.name))) {
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

export * as CodeMigration from "./code-migration"
