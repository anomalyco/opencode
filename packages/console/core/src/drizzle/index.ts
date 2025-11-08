import { drizzle } from "drizzle-orm/planetscale-serverless"
import { Resource } from "@opencode-ai/console-resource"
export * from "drizzle-orm"
import { Client } from "@planetscale/database"

import { MySqlTransaction, type MySqlTransactionConfig } from "drizzle-orm/mysql-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PlanetScalePreparedQueryHKT, PlanetscaleQueryResultHKT } from "drizzle-orm/planetscale-serverless"
import { Context } from "../context"
import { memo } from "../util/memo"

export namespace Database {
  export type Transaction = MySqlTransaction<
    PlanetscaleQueryResultHKT,
    PlanetScalePreparedQueryHKT,
    Record<string, never>,
    ExtractTablesWithRelations<Record<string, never>>
  >

  const client = memo(() => {
    const result = new Client({
      host: Resource.Database.host,
      username: Resource.Database.username,
      password: Resource.Database.password,
    })
    const db = drizzle(result, {})
    return db
  })

  export type TxOrDb = Transaction | ReturnType<typeof client>

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
        const effects: (() => void | Promise<void>)[] = []
        const result = await TransactionContext.provide(
          {
            effects,
            tx: client(),
          },
          () => callback(client()),
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

  export async function transaction<T>(callback: (tx: TxOrDb) => Promise<T>, config?: MySqlTransactionConfig) {
    try {
      const { tx } = TransactionContext.use()
      return callback(tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = await client().transaction(async (tx) => {
          return TransactionContext.provide({ tx, effects }, () => callback(tx))
        }, config)
        await Promise.all(effects.map((x) => x()))
        return result
      }
      throw err
    }
  }
}
