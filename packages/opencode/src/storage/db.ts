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
import { readFileSync, readdirSync, existsSync, statfsSync, unlinkSync, mkdirSync } from "fs"
import os from "os"
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

  /** Resolve the database directory, falling back to a local path on NFS. */
  function resolveDbDir(): string {
    const dataDir = Global.Path.data
    if (!isNFS(dataDir)) return dataDir

    // SQLite's WAL mode requires shared memory via mmap, which is broken on
    // NFS. Instead of downgrading journal mode (slower, still fragile), just
    // put the database on a local filesystem.
    const localDir = path.join(os.tmpdir(), "opencode-" + os.userInfo().uid)
    mkdirSync(localDir, { recursive: true })
    log.info("NFS detected, using local database path", { nfs: dataDir, local: localDir })
    return localDir
  }

  export const Client = lazy(() => {
    const dbDir = resolveDbDir()
    const dbPath = path.join(dbDir, "opencode.db")
    Path = dbPath
    log.info("opening database", { path: dbPath })

    let sqlite: BunDatabase
    try {
      sqlite = new BunDatabase(dbPath, { create: true })

      // Integrity check — detect corruption before it causes harder-to-debug errors
      const result = sqlite.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined
      if (result?.integrity_check !== "ok") {
        log.warn("database corrupted, recreating", { path: dbPath, integrity: result?.integrity_check })
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

    sqlite.run("PRAGMA journal_mode = WAL")
    try { sqlite.run("PRAGMA wal_checkpoint(PASSIVE)") } catch {}
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
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
