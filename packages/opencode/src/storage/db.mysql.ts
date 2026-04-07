import mysql from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import { sql } from "drizzle-orm"

/**
 * The proxyDb / proxyQueryBuilder shim is structurally identical to db.pg.ts
 * — it adds SQLite-style .get(), .all(), .run() methods to thenable Drizzle
 * query builders so the rest of the codebase can stay dialect-agnostic.
 *
 * MySQL-specific additions on top of the PG version:
 *   - .onConflictDoUpdate({target, set}) → .onDuplicateKeyUpdate({set})
 *   - .onConflictDoNothing() → .onDuplicateKeyUpdate({set: {<col>: <col>}})
 *     using a captured column from the insert table to produce a no-op SET.
 */

// Used to thread the inserted-into table reference through the .insert(t).values(v).onConflict… chain
const INSERT_TABLE = Symbol("insertTable")

function proxyDb(db: any): any {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver)
      if (typeof val !== "function") return val

      if (prop === "insert") {
        return function (table: any, ...rest: any[]) {
          const result = val.apply(target, [table, ...rest])
          return proxyQueryBuilder(result, { [INSERT_TABLE]: table })
        }
      }

      if (prop === "select" || prop === "update" || prop === "delete") {
        return function (...args: any[]) {
          const result = val.apply(target, args)
          return proxyQueryBuilder(result)
        }
      }

      if (prop === "transaction") {
        return function (callback: any, ...rest: any[]) {
          return val.call(target, (tx: any) => callback(proxyDb(tx)), ...rest)
        }
      }

      return val
    },
  })
}

function proxyQueryBuilder(obj: any, ctx: { [INSERT_TABLE]?: any } = {}): any {
  if (!obj || typeof obj !== "object") return obj

  return new Proxy(obj, {
    get(target, prop, receiver) {
      // Hidden context propagation
      if (prop === INSERT_TABLE) return ctx[INSERT_TABLE]

      const val = Reflect.get(target, prop, receiver)

      if (prop === "get") {
        return function () {
          return target.then((rows: any) => (Array.isArray(rows) ? rows[0] : rows))
        }
      }
      if (prop === "all") {
        return function () {
          return target.then((rows: any) => rows)
        }
      }
      if (prop === "run") {
        return function () {
          return target.then(() => undefined)
        }
      }

      // Translate Postgres/SQLite upsert API to MySQL's onDuplicateKeyUpdate
      if (prop === "onConflictDoUpdate") {
        return function (config: { target?: any; set: any }) {
          // MySQL infers the conflict key from the unique/primary index, so we drop `target`.
          const result = (target as any).onDuplicateKeyUpdate({ set: config.set })
          return proxyQueryBuilder(result, ctx)
        }
      }

      if (prop === "onConflictDoNothing") {
        return function () {
          // MySQL has no native ON CONFLICT DO NOTHING. The idiomatic equivalent is
          // INSERT ... ON DUPLICATE KEY UPDATE <col> = <col>, which is a no-op.
          // We grab any column from the captured insert table to satisfy Drizzle's
          // requirement of a non-empty SET clause.
          const table = ctx[INSERT_TABLE]
          if (!table) {
            throw new Error("onConflictDoNothing(): could not resolve insert table for MySQL no-op SET")
          }
          // Drizzle table objects expose columns under various symbol/property names.
          // The simplest reliable way to enumerate them is via Object.keys on the table itself.
          const columnName = Object.keys(table).find((k) => {
            const v = (table as any)[k]
            return v && typeof v === "object" && (v as any).name && (v as any).columnType
          })
          if (!columnName) {
            throw new Error("onConflictDoNothing(): could not find any column on insert table")
          }
          const col = (table as any)[columnName]
          const result = (target as any).onDuplicateKeyUpdate({
            set: { [columnName]: sql`${col}` },
          })
          return proxyQueryBuilder(result, ctx)
        }
      }

      if (typeof val !== "function") return val

      return function (...args: any[]) {
        const result = val.apply(target, args)
        if (result && typeof result === "object" && typeof result.then === "function") {
          return proxyQueryBuilder(result, ctx)
        }
        if (result && typeof result === "object" && result !== target) {
          return proxyQueryBuilder(result, ctx)
        }
        return result
      }
    },
  })
}

export async function init(url: string) {
  // mysql2 supports the mysql:// URL scheme natively. Strip the mysql2:// alias if present.
  const normalized = url.startsWith("mysql2://") ? url.replace(/^mysql2:\/\//, "mysql://") : url

  const connection = await mysql.createPool({
    uri: normalized,
    // Return BIGINT as JS Number rather than String. Timestamps and other 64-bit
    // integers in this codebase fit comfortably under 2^53, matching the assumptions
    // already validated for the Postgres backend.
    supportBigNumbers: true,
    bigNumberStrings: false,
  })

  const db = drizzle({ client: connection, mode: "default" })
  return proxyDb(db)
}
