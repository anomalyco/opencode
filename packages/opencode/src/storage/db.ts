import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Database as SQLite } from "bun:sqlite"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync, mkdirSync } from "fs"
import { Flag } from "../flag/flag"
import { CHANNEL } from "../installation/meta"
import { InstanceState } from "@/effect/instance-state"
import { iife } from "@/util/iife"
import { init } from "#db"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

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
    if (Flag.OPENCODE_DB) {
      if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
      return path.join(Global.Path.data, Flag.OPENCODE_DB)
    }
    return getChannelPath()
  })

  export type Transaction = SQLiteTransaction<"sync", void>

  type Client = ReturnType<typeof init> & {
    $client: {
      close(): void
    }
  }

  type Entry = {
    db: Client
    at: number
  }

  type Journal = { sql: string; timestamp: number; name: string }[]

  const limit = 50

  const cache = new Map<string, Entry>()

  const schema = [
    `CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS message_session_time_created_id_idx ON message (session_id, time_created, id)`,
    `CREATE TABLE IF NOT EXISTS part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS part_message_id_id_idx ON part (message_id, id)`,
    `CREATE INDEX IF NOT EXISTS part_session_idx ON part (session_id)`,
    `CREATE TABLE IF NOT EXISTS todo (
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      position INTEGER NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      PRIMARY KEY (session_id, position)
    )`,
    `CREATE INDEX IF NOT EXISTS todo_session_idx ON todo (session_id)`,
    `CREATE TABLE IF NOT EXISTS event_sequence (
      aggregate_id TEXT NOT NULL PRIMARY KEY,
      seq INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      origin TEXT
    )`,
  ]

  const tables = ["message", "part", "todo", "event_sequence", "event"]

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

    const sql = dirs.flatMap((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return []
      return [
        {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        },
      ]
    })

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  function pragma(db: Client) {
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")
  }

  function evict() {
    if (cache.size <= limit) return
    const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)
    while (cache.size > limit && sorted.length) {
      const item = sorted.shift()!
      item[1].db.$client.close()
      cache.delete(item[0])
    }
  }

  const idle = 5 * 60_000
  const sweep = setInterval(() => {
    const cutoff = Date.now() - idle
    for (const [id, item] of cache) {
      if (item.at < cutoff) {
        item.db.$client.close()
        cache.delete(id)
      }
    }
  }, 60_000)
  if (typeof sweep === "object" && "unref" in sweep) sweep.unref()

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    const db = init(Path)

    pragma(db)

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

    try {
      db.run("UPDATE session SET origin_machine = 'unknown' WHERE origin_machine IS NULL")
    } catch (err) {
      log.warn("origin_machine backfill failed", { error: err })
    }

    return db
  })

  export const sessionDir = iife(() => path.join(Global.Path.data, "sessions"))

  export function session(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid session id: ${id}`)
    const item = cache.get(id)
    if (item) {
      item.at = Date.now()
      return item.db
    }

    mkdirSync(sessionDir, { recursive: true })
    const file = path.join(sessionDir, id + ".db")
    const fresh = !existsSync(file)
    const db = init(file)
    pragma(db)

    if (fresh) {
      for (const sql of schema) db.run(sql)
    }

    cache.set(id, { db, at: Date.now() })
    evict()
    return db
  }

  export function hasSession(id: string) {
    if (cache.has(id)) return true
    const file = path.join(sessionDir, id + ".db")
    if (!existsSync(file)) return false
    let db: SQLite | undefined
    try {
      db = new SQLite(file, { readonly: true, create: false })
      const rows = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?)")
        .all(...tables) as Array<{ name: string }>
      return rows.length === tables.length
    } catch {
      return false
    } finally {
      db?.close()
    }
  }

  export function sessionRoot(id: string) {
    if (hasSession(id)) return id

    const seen = new Set<string>()
    let next: string | undefined = id

    for (let hop = 0; hop < 100 && next; hop++) {
      if (seen.has(next)) {
        log.warn("parent chain cycle detected", { id })
        return
      }

      seen.add(next)

      const row = Client().$client.query("SELECT parent_id FROM session WHERE id = ?").get(next) as {
        parent_id: string | null
      } | null
      const parent = row?.parent_id ?? undefined
      if (!parent) return
      if (hasSession(parent)) return parent
      next = parent
    }

    if (next) log.warn("parent chain cycle detected", { id })
  }

  export function resolveSession(id: string) {
    const root = sessionRoot(id)
    if (root) return session(root)
    return Client()
  }

  export function closeSession(id: string) {
    const item = cache.get(id)
    if (!item) return
    item.db.$client.close()
    cache.delete(id)
  }

  export function close() {
    for (const item of cache.values()) item.db.$client.close()
    cache.clear()
    Client().$client.close()
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
    const bound = InstanceState.bind(fn)
    try {
      ctx.use().effects.push(bound)
    } catch {
      bound()
    }
  }

  type NotPromise<T> = T extends Promise<any> ? never : T

  export function transaction<T>(
    callback: (tx: TxOrDb) => NotPromise<T>,
    options?: {
      behavior?: "deferred" | "immediate" | "exclusive"
    },
  ): NotPromise<T> {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
        const result = Client().transaction(txCallback, { behavior: options?.behavior })
        for (const effect of effects) effect()
        return result as NotPromise<T>
      }
      throw err
    }
  }
}
