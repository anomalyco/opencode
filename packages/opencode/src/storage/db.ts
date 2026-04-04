import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
import { type PostgresJsDatabase } from "drizzle-orm/postgres-js"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Flag } from "../flag/flag"
import { CHANNEL } from "../installation/meta"
import { InstanceState } from "@/effect/instance-state"
import { iife } from "@/util/iife"
import { init as initSqlite } from "#db"
import { DIALECT } from "./dialect-detect"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined
declare const OPENCODE_PG_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export function getChannelPath() {
    if (["latest", "beta"].includes(CHANNEL) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "opencode.db")
    const safe = CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `opencode-${safe}.db`)
  }

  export const Path = iife(() => {
    if (Flag.OPENCODE_DATABASE_URL) return Flag.OPENCODE_DATABASE_URL
    if (Flag.OPENCODE_DB) {
      if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
      return path.join(Global.Path.data, Flag.OPENCODE_DB)
    }
    return getChannelPath()
  })

  export type Transaction = SQLiteTransaction<"sync", void>

  // Typed as SQLiteBunDatabase for TypeScript compatibility with SQLite-typed schemas.
  // At runtime, may be a PostgresJsDatabase when DIALECT is "postgres" — the Drizzle
  // query builder API is structurally compatible, so this is safe.
  type Client = SQLiteBunDatabase

  type Journal = { sql: string; timestamp: number; name: string }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    if (!existsSync(dir)) return []
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  async function initPostgres(url: string): Promise<Client> {
    const { init } = await import("./db.pg")
    const db = init(url)

    if (!Flag.OPENCODE_SKIP_MIGRATIONS) {
      const { migrate } = await import("drizzle-orm/postgres-js/migrator")

      if (typeof OPENCODE_PG_MIGRATIONS !== "undefined" && OPENCODE_PG_MIGRATIONS.length > 0) {
        // Bundled mode: write migrations to a temp directory for the migrator
        const os = await import("os")
        const fs = await import("fs")
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pg-migrations-"))
        try {
          for (const entry of OPENCODE_PG_MIGRATIONS) {
            const migDir = path.join(tmpDir, entry.name)
            fs.mkdirSync(migDir, { recursive: true })
            fs.writeFileSync(path.join(migDir, "migration.sql"), entry.sql)
          }
          log.info("applying bundled postgres migrations", { count: OPENCODE_PG_MIGRATIONS.length })
          await migrate(db as any, { migrationsFolder: tmpDir })
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        }
      } else {
        // Dev mode: read migrations from folder
        const migrationsDir = path.join(import.meta.dirname, "../../migration-pg")
        if (existsSync(migrationsDir)) {
          log.info("applying postgres migrations from folder", { dir: migrationsDir })
          await migrate(db as any, { migrationsFolder: migrationsDir })
        }
      }
    }

    // Cast to Client (SQLiteBunDatabase) for type compat — safe at runtime
    return db as unknown as Client
  }

  function initSqliteClient(dbPath: string): Client {
    const db = initSqlite(dbPath)

    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")

    // Apply schema migrations
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      if (Flag.OPENCODE_SKIP_MIGRATIONS) {
        for (const item of entries) {
          item.sql = "select 1;"
        }
      }
      migrateSqlite(db as SQLiteBunDatabase, entries)
    }

    return db
  }

  // Postgres-only client state
  let _pgClient: Client | undefined
  let _pgClientPromise: Promise<Client> | undefined

  /** Synchronous SQLite client accessor. */
  export const Client = lazy(() => {
    if (DIALECT === "postgres") {
      throw new Error("Cannot use synchronous Client accessor with Postgres. Use Database.getClient() instead.")
    }
    log.info("opening database", { path: Path })
    return initSqliteClient(Path) as SQLiteBunDatabase
  })

  export async function getClient(): Promise<Client> {
    if (DIALECT === "postgres") {
      if (_pgClient) return _pgClient
      if (_pgClientPromise) return _pgClientPromise
      _pgClientPromise = initPostgres(Path)
      _pgClient = await _pgClientPromise
      return _pgClient
    }

    // For SQLite, always delegate to the lazy Client singleton
    return Client() as Client
  }

  export async function close() {
    if (DIALECT === "postgres" && _pgClient) {
      const pgClient = (_pgClient as any).$client
      if (pgClient?.end) await pgClient.end()
      _pgClient = undefined
      _pgClientPromise = undefined
    } else if (DIALECT === "sqlite") {
      ;(Client() as any).$client.close()
      Client.reset()
    }
  }

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export async function use<T>(callback: (trx: TxOrDb) => T | Promise<T>): Promise<T> {
    try {
      return await callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const client = await getClient()
        const result = await ctx.provide({ effects, tx: client }, () => callback(client))
        for (const effect of effects) await effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    const bound = InstanceState.bind(fn)
    try {
      ctx.use().effects.push(bound)
    } catch {
      bound()
    }
  }

  export async function transaction<T>(
    callback: (tx: TxOrDb) => T | Promise<T>,
    options?: {
      behavior?: "deferred" | "immediate" | "exclusive"
    },
  ): Promise<T> {
    try {
      return await callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const client = await getClient()

        let result: T
        if (DIALECT === "postgres") {
          const pgDb = client as unknown as PostgresJsDatabase
          result = await (pgDb.transaction as any)(async (tx: any) => {
            return await ctx.provide({ tx, effects }, () => callback(tx))
          })
        } else {
          const sqliteDb = client as SQLiteBunDatabase
          const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
          result = sqliteDb.transaction(txCallback as any, { behavior: options?.behavior }) as T
        }

        for (const effect of effects) await effect()
        return result
      }
      throw err
    }
  }
}
