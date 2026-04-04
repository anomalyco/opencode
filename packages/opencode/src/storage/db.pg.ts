import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

/**
 * Adds SQLite-compatible .get(), .all(), and .run() methods to Postgres
 * query builder results. This allows the codebase to use the same API
 * regardless of dialect.
 *
 * - .all() — returns all rows (equivalent to await)
 * - .get() — returns first row or undefined
 * - .run() — executes the query, returns void
 */
function addSqliteCompat(obj: any): any {
  if (obj && typeof obj === "object" && typeof obj.then === "function") {
    // It's a thenable (Promise-like query builder)
    if (!obj.all) {
      obj.all = function () {
        return this.then((rows: any) => rows)
      }
    }
    if (!obj.get) {
      obj.get = function () {
        return this.then((rows: any) => (Array.isArray(rows) ? rows[0] : rows))
      }
    }
    if (!obj.run) {
      obj.run = function () {
        return this.then(() => undefined)
      }
    }
  }
  return obj
}

function proxyDb(db: any): any {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver)
      if (typeof val !== "function") return val

      // Wrap select/insert/update/delete to proxy their return values
      if (prop === "select" || prop === "insert" || prop === "update" || prop === "delete") {
        return function (...args: any[]) {
          const result = val.apply(target, args)
          return proxyQueryBuilder(result)
        }
      }

      // For transaction, wrap the callback's db parameter
      if (prop === "transaction") {
        return function (callback: any, ...rest: any[]) {
          return val.call(target, (tx: any) => callback(proxyDb(tx)), ...rest)
        }
      }

      return val
    },
  })
}

function proxyQueryBuilder(obj: any): any {
  if (!obj || typeof obj !== "object") return obj

  return new Proxy(obj, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver)

      // Add .get(), .all(), .run() methods
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

      if (typeof val !== "function") return val

      // Chain: methods like .from(), .where(), .values() etc return new query builders
      return function (...args: any[]) {
        const result = val.apply(target, args)
        if (result && typeof result === "object" && typeof result.then === "function") {
          return proxyQueryBuilder(result)
        }
        if (result && typeof result === "object" && result !== target) {
          return proxyQueryBuilder(result)
        }
        return result
      }
    },
  })
}

export function init(url: string) {
  const client = postgres(url)
  const db = drizzle({ client })
  return proxyDb(db)
}
