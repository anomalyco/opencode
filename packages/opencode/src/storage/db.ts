import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync, statfsSync, unlinkSync } from "fs"
import * as schema from "./schema"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  /** Actual database path, set when Client is initialized. Falls back to default. */
  export let Path = path.join(Global.Path.data, "opencode.db")
  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  type Journal = { sql: string; timestamp: number }[]

  const state = {
    sqlite: undefined as BunDatabase | undefined,
  }

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
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  function isNFS(dir: string): boolean {
    try {
      // NFS magic number: 0x6969
      return statfsSync(dir).type === 0x6969
    } catch {
      return false
    }
  }

  function removeDatabase(dbPath: string) {
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        unlinkSync(dbPath + suffix)
      } catch {}
    }
  }

  export const Client = lazy(() => {
    const dbPath = path.join(Global.Path.data, "opencode.db")
    const nfs = isNFS(Global.Path.data)
    Path = dbPath
    log.info("opening database", { path: dbPath, nfs })

    let sqlite: BunDatabase
    try {
      sqlite = new BunDatabase(dbPath, { create: true })

      // quick_check is fast (unlike integrity_check which reads every page and
      // can hang indefinitely on large corrupt databases)
      const result = sqlite.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined
      if (result?.quick_check !== "ok") {
        log.warn("database corrupted, recreating", { path: dbPath, check: result?.quick_check })
        sqlite.close()
        removeDatabase(dbPath)
        sqlite = new BunDatabase(dbPath, { create: true })
      }
    } catch (e) {
      // Database file itself may be unreadable/corrupt — remove and retry
      log.warn("database open failed, recreating", { path: dbPath, error: String(e) })
      removeDatabase(dbPath)
      sqlite = new BunDatabase(dbPath, { create: true })
    }

    // busy_timeout must be set first — changing journal mode requires an
    // exclusive lock and NFS can have stale locks from killed processes.
    sqlite.run("PRAGMA busy_timeout = 5000")

    // WAL mode uses mmap'd shared memory (-shm file) for coordination, which
    // is fundamentally broken on NFS — concurrent writers corrupt the database.
    // DELETE mode uses only file-level locks (handled by NFS lock manager).
    if (nfs) {
      log.info("NFS detected, using DELETE journal mode to avoid WAL/mmap corruption")
      try {
        sqlite.run("PRAGMA journal_mode = DELETE")
      } catch (e) {
        // Stale NFS locks can block journal mode changes — log and continue.
        // The database may still be in WAL mode but at least it won't crash.
        log.warn("failed to set DELETE journal mode, continuing with current mode", { error: String(e) })
      }
    } else {
      sqlite.run("PRAGMA journal_mode = WAL")
      try { sqlite.run("PRAGMA wal_checkpoint(PASSIVE)") } catch {}
    }
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")

    state.sqlite = sqlite

    const db = drizzle({ client: sqlite, schema })

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
      migrate(db, entries)
    }

    return db
  })

  export function close() {
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.close()
    state.sqlite = undefined
    Client.reset()
  }

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = Client().transaction((tx) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
