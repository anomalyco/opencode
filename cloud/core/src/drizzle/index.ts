import { drizzle } from "drizzle-orm/postgres-js"
import { Resource } from "sst"
export * from "drizzle-orm"
import postgres from "postgres"

function createClient() {
  const client = postgres({
    idle_timeout: 30000,
    connect_timeout: 30000,
    host: Resource.Database.host,
    database: Resource.Database.database,
    user: Resource.Database.username,
    password: Resource.Database.password,
    port: Resource.Database.port,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 1,
  })

  return drizzle(client, {})
}

import { PgTransaction, type PgTransactionConfig } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js"
import { Context } from "../context"

export namespace Database {
  export type Transaction = PgTransaction<
    PostgresJsQueryResultHKT,
    Record<string, unknown>,
    ExtractTablesWithRelations<Record<string, unknown>>
  >

  export type TxOrDb = Transaction | ReturnType<typeof createClient>

  const TransactionContext = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>()

  export async function use<T>(callback: (trx: TxOrDb) => Promise<T>) {
    try {
      const { tx } = TransactionContext.use()
      return tx.transaction(callback)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const client = createClient()
        const effects: (() => void | Promise<void>)[] = []
        const result = await TransactionContext.provide(
          {
            effects,
            tx: client,
          },
          () => callback(client),
        )
        await Promise.all(effects.map((x) => x()))
        return result
      }
      throw err
    }
  }
  export async function fn<Input, T>(callback: (input: Input, trx: TxOrDb) => Promise<T>) {
    return (input: Input) => use(async (tx) => callback(input, tx))
  }

  export async function effect(effect: () => any | Promise<any>) {
    try {
      const { effects } = TransactionContext.use()
      effects.push(effect)
    } catch {
      await effect()
    }
  }

  export async function transaction<T>(callback: (tx: TxOrDb) => Promise<T>, config?: PgTransactionConfig) {
    try {
      const { tx } = TransactionContext.use()
      return callback(tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const client = createClient()
        const effects: (() => void | Promise<void>)[] = []
        const result = await client.transaction(async (tx) => {
          return TransactionContext.provide({ tx, effects }, () => callback(tx))
        }, config)
        await Promise.all(effects.map((x) => x()))
        return result
      }
      throw err
    }
  }
}
