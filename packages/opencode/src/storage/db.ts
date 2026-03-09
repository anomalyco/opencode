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
import { readFileSync, readdirSync, existsSync, mkdirSync, statSync, chmodSync, accessSync, unlinkSync, constants as fsConstants } from "fs"
import * as schema from "./schema"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = iife(() => {
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "opencode.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `opencode-${safe}.db`)
  })

  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  type Journal = { sql: string; timestamp: number; name: string }[]

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
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Ensure the database file and its WAL/SHM companion files are writable.
   * On macOS (especially when launched from a desktop app through a login shell),
   * these files can end up read-only due to inherited umask settings or
   * stale files left behind by a crashed process. This fixes permissions
   * before SQLite tries to open the database, preventing the
   * "attempt to write a readonly database" error.
   */
  function ensureDbWritable(dbPath: string) {
    const dir = path.dirname(dbPath)

    // Ensure parent directory exists and is writable
    try {
      mkdirSync(dir, { recursive: true, mode: 0o755 })
    } catch {
      // directory may already exist, that's fine
    }

    // Check and fix permissions on the database file and its WAL/SHM companions
    const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
    for (const file of files) {
      try {
        const stat = statSync(file)
        // If the file exists but is not writable by the owner, fix it
        // eslint-disable-next-line no-bitwise
        if ((stat.mode & 0o200) === 0) {
          log.info("fixing readonly permissions", { file })
          // eslint-disable-next-line no-bitwise
          chmodSync(file, stat.mode | 0o600)
        }
      } catch {
        // File doesn't exist yet, that's fine — SQLite will create it
      }
    }

    // Verify the directory is writable
    try {
      accessSync(dir, fsConstants.W_OK)
    } catch {
      log.error("database directory is not writable", { dir })
    }
  }

  function openDatabase(dbPath: string): BunDatabase {
    const sqlite = new BunDatabase(dbPath, { create: true })

    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

    return sqlite
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    ensureDbWritable(Path)

    let sqlite: BunDatabase
    try {
      sqlite = openDatabase(Path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("readonly")) {
        // The database or its WAL/SHM files may be stale or corrupted.
        // Remove the WAL and SHM files and retry — SQLite will recreate
        // them on the next write. This handles the case where a previous
        // process crashed and left behind files with wrong permissions
        // or in an inconsistent state.
        log.warn("database is readonly, removing WAL/SHM files and retrying", {
          path: Path,
          error: message,
        })
        for (const suffix of ["-wal", "-shm"]) {
          try {
            unlinkSync(`${Path}${suffix}`)
          } catch {
            // file may not exist
          }
        }
        ensureDbWritable(Path)
        sqlite = openDatabase(Path)
      } else {
        throw err
      }
    }
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
      if (Flag.OPENCODE_SKIP_MIGRATIONS) {
        for (const item of entries) {
          item.sql = "select 1;"
        }
      }
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
        const result = (Client().transaction as any)((tx: TxOrDb) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
