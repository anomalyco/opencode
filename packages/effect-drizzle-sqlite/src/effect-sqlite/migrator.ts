/* oxlint-disable */
import type { MigrationConfig } from "drizzle-orm/migrator"
import { readMigrationFiles } from "drizzle-orm/migrator"
import type { AnyRelations } from "drizzle-orm/relations"
import { migrate as coreMigrate } from "../sqlite-core/effect/session"
import type { EffectSQLiteDatabase } from "./driver"

export function migrate<TRelations extends AnyRelations>(
  db: EffectSQLiteDatabase<TRelations>,
  config: MigrationConfig,
) {
  const migrations = readMigrationFiles(config)
  return coreMigrate(migrations, db.session, config)
}
