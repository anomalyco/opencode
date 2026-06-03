import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectCache } from "drizzle-orm/cache/core/cache-effect"
import { EffectLogger } from "drizzle-orm/effect-core"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import { type SQL, sql, type SQLWrapper } from "drizzle-orm/sql/sql"
import {
  EffectPgDatabase,
  make as makeBase,
  makeWithDefaults as makeWithDefaultsBase,
  DefaultServices as DefaultServicesBase,
} from "drizzle-orm/effect-postgres"
import { PgClient } from "@effect/sql-pg/PgClient"

export { EffectLogger } from "drizzle-orm/effect-core"
export { migrate } from "drizzle-orm/effect-postgres/migrator"

export type EffectPgDatabaseWithRun<TRelations extends AnyRelations = EmptyRelations> = EffectPgDatabase<TRelations> & {
  run(query: SQLWrapper | string): Effect.Effect<unknown, never, never>
  all<T = unknown>(query: SQLWrapper | string): Effect.Effect<T[], never, never>
  get<T = unknown>(query: SQLWrapper | string): Effect.Effect<T | undefined, never, never>
  values<T extends unknown[] = unknown[]>(query: SQLWrapper | string): Effect.Effect<T[], never, never>
}

function addRunMethods<TRelations extends AnyRelations = EmptyRelations>(
  db: EffectPgDatabase<TRelations>,
): EffectPgDatabaseWithRun<TRelations> {
  const run = (query: SQLWrapper | string) => {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL()
    return db.execute(sequel)
  }
  const all = <T = unknown>(query: SQLWrapper | string) => {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL()
    return db.execute(sequel).pipe(Effect.map((result) => result as unknown as T[]))
  }
  const get = <T = unknown>(query: SQLWrapper | string) => {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL()
    return db.execute(sequel).pipe(
      Effect.map((result) => {
        const rows = result as unknown as T[]
        return rows[0]
      }),
    )
  }
  const values = <T extends unknown[] = unknown[]>(query: SQLWrapper | string) => {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL()
    return db.execute(sequel).pipe(Effect.map((result) => result as unknown as T[]))
  }
  return Object.assign(db, { run, all, get, values }) as unknown as EffectPgDatabaseWithRun<TRelations>
}

export const DefaultServices = Layer.merge(EffectCache.Default, EffectLogger.Default)

export const make = Effect.fn("PgDrizzle.make")(function* <TRelations extends AnyRelations = EmptyRelations>(
  config: Parameters<typeof makeBase>[0] = {},
) {
  const db = yield* makeBase<TRelations>(config as never)
  return addRunMethods(db)
})

export const makeWithDefaults = <TRelations extends AnyRelations = EmptyRelations>(
  config?: Parameters<typeof makeWithDefaultsBase>[0],
) =>
  makeWithDefaultsBase(config as never).pipe(
    Effect.map((db) => addRunMethods(db)),
  )

export type { EffectPgDatabaseWithRun as EffectPgDatabase }
