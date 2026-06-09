import { Database as StorageDatabase } from "@/storage/db"
import { JsonMigration } from "@/storage/json-migration"
import { Context, Effect, Layer } from "effect"

export { Config } from "@/config/config"
export { Server } from "./server/server"
export { bootstrap } from "./cli/bootstrap"
export * as Log from "@opencode-ai/core/util/log"

interface DatabaseStartup {
  readonly migrated: true
}

class DatabaseStartupService extends Context.Service<DatabaseStartupService, DatabaseStartup>()(
  "@opencode/DatabaseStartup",
) {}

const databaseStartupLayer = Layer.effect(
  DatabaseStartupService,
  Effect.promise(async () => {
    await JsonMigration.run(StorageDatabase.Client())
    return { migrated: true }
  }),
)

export const Database = {
  ...StorageDatabase,
  defaultLayer: databaseStartupLayer,
}
export { JsonMigration }
