import { Database } from "bun:sqlite"
import type { DurableObjectStorage } from "@opencode-ai/core/database/sqlite.workerd"

// Emulates the Durable Object storage API over bun:sqlite so the workerd
// adapter and the workerd server profile can be verified without workerd or
// Cloudflare runtime dependencies.
export const makeDurableObjectStorage = (): DurableObjectStorage => {
  const native = new Database(":memory:")
  const toSqlStorageValue = (value: unknown) => {
    if (!(value instanceof Uint8Array)) return value as ArrayBuffer | string | number | null
    const buffer = new ArrayBuffer(value.byteLength)
    new Uint8Array(buffer).set(value)
    return buffer
  }
  return {
    sql: {
      exec(query: string, ...bindings: Array<unknown>) {
        const statement = native.query(query)
        const rows = (statement.values(...(bindings as never[])) ?? []).map((row) => row.map(toSqlStorageValue))
        const columnNames = statement.columnNames
        return {
          columnNames,
          raw: () => rows[Symbol.iterator](),
          toArray: () => rows.map((row) => Object.fromEntries(columnNames.map((name, i) => [name, row[i]]))),
        }
      },
    },
    transaction<T>(closure: (txn: { rollback(): void }) => Promise<T>): Promise<T> {
      native.run("BEGIN")
      let rolledBack = false
      return closure({ rollback: () => (rolledBack = true) }).then(
        (result) => {
          native.run(rolledBack ? "ROLLBACK" : "COMMIT")
          return result
        },
        (error) => {
          native.run("ROLLBACK")
          throw error
        },
      )
    },
    transactionSync<T>(closure: () => T): T {
      return native.transaction(closure)()
    },
  }
}
