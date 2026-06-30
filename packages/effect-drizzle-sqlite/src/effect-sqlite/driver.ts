/* oxlint-disable */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectCache } from "drizzle-orm/cache/core/cache-effect"
import { EffectLogger } from "drizzle-orm/effect-core"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import { SQLiteEffectDatabase } from "drizzle-orm/sqlite-core/effect/db"
import type { EffectDrizzleSQLiteConfig } from "drizzle-orm/sqlite-core/effect/utils"
import { jitCompatCheck } from "../internal/drizzle-utils"
import { type EffectSQLiteQueryEffectHKT, type EffectSQLiteRunResult, EffectSQLiteSession } from "./session"

export class EffectSQLiteDatabase<TRelations extends AnyRelations = EmptyRelations> extends SQLiteEffectDatabase<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteDatabase"
}

export type { EffectDrizzleSQLiteConfig } from "drizzle-orm/sqlite-core/effect/utils"

export const DefaultServices = Layer.merge(EffectCache.Default, EffectLogger.Default)

/**
 * Creates an EffectSQLiteDatabase instance backed by the generic Effect `SqlClient`.
 */
export const make = Effect.fn("SQLiteDrizzle.make")(function* <TRelations extends AnyRelations = EmptyRelations>(
  config: EffectDrizzleSQLiteConfig<TRelations> = {},
) {
  const client = yield* SqlClient
  const cache = yield* EffectCache
  const logger = yield* EffectLogger

  const dialect = new SQLiteDialect({ useJitMappers: jitCompatCheck(config.jit) })
  const relations = config.relations ?? ({} as TRelations)
  const session = new EffectSQLiteSession(client, dialect, relations, {
    logger,
    cache,
  })
  const db = new EffectSQLiteDatabase(dialect, session, relations) as EffectSQLiteDatabase<TRelations> & {
    $client: SqlClient
  }
  db.$client = client
  db.$cache.invalidate = cache.onMutate

  return db
})

/**
 * Convenience function that creates an EffectSQLiteDatabase with `DefaultServices` already provided.
 */
export const makeWithDefaults = <TRelations extends AnyRelations = EmptyRelations>(
  config: EffectDrizzleSQLiteConfig<TRelations> = {},
) => make(config).pipe(Effect.provide(DefaultServices))
