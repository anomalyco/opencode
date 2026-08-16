/* oxlint-disable */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectCache } from "drizzle-orm/cache/core/cache-effect"
import { EffectLogger } from "drizzle-orm/effect-core"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core/dialect"
import { SQLiteEffectDatabase } from "../sqlite-core/effect/db"
import type { DrizzleConfig } from "drizzle-orm/utils"
import { jitCompatCheck } from "../internal/drizzle-utils"
import { type EffectSQLiteQueryEffectHKT, type EffectSQLiteRunResult, EffectSQLiteSession } from "./session"

export class EffectSQLiteDatabase<TRelations extends AnyRelations = EmptyRelations> extends SQLiteEffectDatabase<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteDatabase"
}

export type EffectDrizzleSQLiteConfig<TRelations extends AnyRelations = EmptyRelations> = Omit<
  DrizzleConfig<Record<string, never>, TRelations>,
  "cache" | "logger" | "schema"
>

export const DefaultServices = Layer.merge(EffectCache.Default, EffectLogger.Default)

/**
 * Creates an EffectSQLiteDatabase instance.
 *
 * Requires a generic Effect `SqlClient`, `EffectLogger`, and `EffectCache` services to be provided.
 * Drizzle only depends on the generic `SqlClient`; install and provide a compatible SQLite provider such as
 * `@effect/sql-sqlite-node`, `@effect/sql-sqlite-bun`, or another package that exposes `SqlClient`.
 *
 * @example
 * ```ts
 * import { SqliteClient } from '@effect/sql-sqlite-node';
 * import * as SQLiteDrizzle from 'drizzle-orm/effect-sqlite';
 * import * as Effect from 'effect/Effect';
 *
 * const db = yield* SQLiteDrizzle.make({ relations }).pipe(
 *   Effect.provide(SQLiteDrizzle.DefaultServices),
 *   Effect.provide(SqliteClient.layer({ filename: 'sqlite.db' })),
 * );
 * ```
 */
export const make = Effect.fn("SQLiteDrizzle.make")(function* <TRelations extends AnyRelations = EmptyRelations>(
  config: EffectDrizzleSQLiteConfig<TRelations> = {},
) {
  const client = yield* SqlClient
  const cache = yield* EffectCache
  const logger = yield* EffectLogger

  const dialect = new SQLiteAsyncDialect()
  const relations = config.relations ?? ({} as TRelations)
  const session = new EffectSQLiteSession(client, dialect, relations, {
    logger,
    cache,
    useJitMappers: jitCompatCheck(config.jit),
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
