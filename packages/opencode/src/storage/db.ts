import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
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
import { readFileSync, readdirSync, existsSync } from "fs"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { init } from "#db"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined
declare const OPENCODE_CLIENT_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

type Journal = { sql: string; timestamp: number; name: string }[]
type Client = SQLiteBunDatabase
type Transaction = SQLiteTransaction<"sync", void>
type TxOrDb = Transaction | Client
type NotPromise<T> = T extends Promise<any> ? never : T

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

function make(input: {
  service: string
  path: string
  context: string
  source: () => {
    entries: Journal
    mode: "bundled" | "dev"
  }
}) {
  const log = Log.create({ service: input.service })
  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>(input.context)

  const Client = lazy(() => {
    log.info("opening database", { path: input.path })

    const db = init(input.path)

    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")

    const source = input.source()
    if (source.entries.length > 0) {
      log.info("applying migrations", {
        count: source.entries.length,
        mode: source.mode,
      })
      if (Flag.OPENCODE_SKIP_MIGRATIONS) {
        for (const item of source.entries) {
          item.sql = "select 1;"
        }
      }
      migrate(db, source.entries)
    }

    return db
  })

  function close() {
    Client().$client.close()
    Client.reset()
  }

  function use<T>(callback: (trx: TxOrDb) => T): T {
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

  function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  function transaction<T>(
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
        const result = Client().transaction(
          (tx: TxOrDb) => {
            return ctx.provide({ tx, effects }, () => callback(tx))
          },
          { behavior: options?.behavior },
        )
        for (const effect of effects) effect()
        return result as NotPromise<T>
      }
      throw err
    }
  }

  return {
    Client,
    close,
    use,
    effect,
    transaction,
  }
}

export namespace Database {
  export function getChannelPath() {
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "opencode.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `opencode-${safe}.db`)
  }

  export const Path = iife(() => {
    if (Flag.OPENCODE_DB) {
      if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
      return path.join(Global.Path.data, Flag.OPENCODE_DB)
    }
    return getChannelPath()
  })

  const db = make({
    service: "db",
    path: Path,
    context: "database",
    source: () => {
      if (typeof OPENCODE_MIGRATIONS !== "undefined") {
        return {
          entries: OPENCODE_MIGRATIONS,
          mode: "bundled" as const,
        }
      }
      return {
        entries: migrations(path.join(import.meta.dirname, "../../migration")),
        mode: "dev" as const,
      }
    },
  })

  export type Transaction = SQLiteTransaction<"sync", void>
  export type TxOrDb = Transaction | SQLiteBunDatabase

  export const Client = db.Client
  export const close = db.close
  export const use = db.use
  export const effect = db.effect
  export const transaction = db.transaction
}

export namespace ClientDatabase {
  export const Path = path.join(Global.Path.state, "client.db")

  const db = make({
    service: "client-db",
    path: Path,
    context: "client-database",
    source: () => {
      if (typeof OPENCODE_CLIENT_MIGRATIONS !== "undefined") {
        return {
          entries: OPENCODE_CLIENT_MIGRATIONS,
          mode: "bundled" as const,
        }
      }
      return {
        entries: migrations(path.join(import.meta.dirname, "../../client-migration")),
        mode: "dev" as const,
      }
    },
  })

  export type Transaction = SQLiteTransaction<"sync", void>
  export type TxOrDb = Transaction | SQLiteBunDatabase

  export const Client = db.Client
  export const close = db.close
  export const use = db.use
  export const effect = db.effect
  export const transaction = db.transaction
}
