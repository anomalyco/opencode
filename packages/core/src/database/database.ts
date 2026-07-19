export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Cause, Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { rename, stat, unlink } from "fs/promises"
import { execFileSync } from "child_process"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

function isCorruptedDatabase(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("file is not a database") || message.includes("database disk image is malformed")
}

const backupCorruptedFiles = (filename: string) =>
  Effect.gen(function* () {
    const timestamp = Date.now()
    const backedUp = yield* Effect.forEach(["", "-wal", "-shm"] as const, (ext) =>
      Effect.tryPromise({
        try: async () => {
          const src = filename + ext
          await rename(src, `${src}.corrupt-${timestamp}`)
          return true
        },
        catch: () => false,
      }).pipe(Effect.orElseSucceed(() => false)),
    )

    if (backedUp.some(Boolean)) {
      yield* Effect.logWarning(`Database corrupted. Backed up to: ${filename}.corrupt-${timestamp}`)
      return `${filename}.corrupt-${timestamp}`
    }

    yield* Effect.logWarning(`Database corrupted, but no files could be moved aside: ${filename}`)
    return undefined
  })

/**
 * Recover data from a corrupted database using sqlite3 `.recover`.
 *
 * `.recover` scans raw pages extracting every readable row even when B-tree
 * pages are damaged — unlike `SELECT *` which aborts the entire table on the
 * first bad page. Falls back to direct row copy if sqlite3 CLI is unavailable.
 */
const salvageFromBackup = (backupPath: string, targetFilename: string) =>
  Effect.gen(function* () {
    const exists = yield* Effect.tryPromise({
      try: () => stat(backupPath),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null))
    if (!exists) return

    const recoveredPath = yield* recoverWithSqlite3(backupPath)
    const sourcePath = recoveredPath ?? backupPath

    yield* Effect.try({
      try: () => {
        const { Database: BunDatabase } = require("bun:sqlite")
        const source = new BunDatabase(sourcePath, { readonly: true, create: false })
        const target = new BunDatabase(targetFilename, { readwrite: true, create: true })

        try {
          target.run("PRAGMA journal_mode = WAL")
          target.run("PRAGMA foreign_keys = OFF")

          const tables = target
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'migration'")
            .all() as Array<{ name: string }>

          let salvaged = 0
          for (const { name } of tables) {
            try {
              const sourceHasTable = source
                .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`)
                .all()
              if (sourceHasTable.length === 0) continue

              const targetColumns = (target.query(`PRAGMA table_info('${name}')`).all() as Array<{ name: string }>).map((c) => c.name)
              const sourceColumns = (source.query(`PRAGMA table_info('${name}')`).all() as Array<{ name: string }>).map((c) => c.name)
              const shared = targetColumns.filter((col) => sourceColumns.includes(col))
              if (shared.length === 0) continue

              const columnNames = shared.join(", ")
              const placeholders = shared.map(() => "?").join(", ")

              const rows = source.query(`SELECT ${columnNames} FROM ${name}`).all() as Array<Record<string, unknown>>
              if (rows.length === 0) continue

              const insert = target.prepare(`INSERT OR IGNORE INTO ${name} (${columnNames}) VALUES (${placeholders})`)
              const tx = target.transaction((batch: Array<Record<string, unknown>>) => {
                for (const row of batch) {
                  insert.run(...(shared.map((col) => row[col]) as Array<null | string | number | bigint | boolean | Uint8Array>))
                }
              })
              tx(rows)
              salvaged += rows.length
            } catch {
              continue
            }
          }

          if (salvaged > 0) {
            // eslint-disable-next-line no-console
            console.warn(`[opencode] Salvaged ${salvaged} rows from corrupted database${recoveredPath ? " (via .recover)" : ""}`)
          }
        } finally {
          target.run("PRAGMA wal_checkpoint(TRUNCATE)")
          source.close()
          target.close()
        }
      },
      catch: (e) => {
        // eslint-disable-next-line no-console
        console.warn(`[opencode] Failed to salvage from corrupted database:`, e)
        return undefined
      },
    })

    if (recoveredPath) {
      yield* Effect.tryPromise({
        try: () => unlink(recoveredPath),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined))
    }
  })

/**
 * Run `sqlite3 <corrupt> .recover` into a temp file.
 * Returns the temp file path on success, undefined if sqlite3 is unavailable or fails.
 *
 * Note: sqlite3 .recover exits non-zero on corrupt files while still producing
 * valid SQL on stdout — we extract stdout from the thrown error in that case.
 */
const recoverWithSqlite3 = (corruptPath: string) =>
  Effect.try({
    try: () => {
      const recoveredPath = `${corruptPath}.recovered-${Date.now()}`
      let sql: string | undefined
      try {
        sql = execFileSync("sqlite3", [corruptPath, ".recover"], {
          maxBuffer: 512 * 1024 * 1024,
          timeout: 300_000,
          encoding: "utf-8",
        })
      } catch (e: unknown) {
        const stdout = (e as { stdout?: string }).stdout
        if (stdout && stdout.length > 10) sql = stdout
      }
      if (!sql || sql.length < 10) return undefined

      execFileSync("sqlite3", [recoveredPath], {
        input: sql,
        maxBuffer: 512 * 1024 * 1024,
        timeout: 300_000,
        encoding: "utf-8",
      })
      return recoveredPath
    },
    catch: () => undefined,
  })

function initializeDb() {
  return Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")

    const rows = yield* db.all<{ quick_check: string }>("PRAGMA quick_check")
    if (rows.length !== 1 || rows[0]!.quick_check !== "ok") {
      const details = rows.map((r) => r.quick_check).join("; ")
      yield* Effect.die(new Error(`database disk image is malformed (quick_check: ${details})`))
    }

    yield* DatabaseMigration.apply(db)

    return Service.of({ db })
  })
}

function baseLayer(filename: string) {
  return Layer.effect(
    Service,
    initializeDb().pipe(Effect.orDie),
  ).pipe(
    Layer.provide(sqliteLayer({ filename, disableWAL: true })),
  )
}

export function layerFromPath(filename: string) {
  return Layer.catchCause(baseLayer(filename), (cause) =>
    isCorruptedDatabase(cause)
      ? Layer.unwrap(
          Effect.gen(function* () {
            const backupPath = yield* backupCorruptedFiles(filename)
            const recovered = baseLayer(filename)
            if (backupPath) {
              return Layer.tap(recovered, () => salvageFromBackup(backupPath, filename))
            }
            return recovered
          }),
        )
      : Layer.effectContext(Effect.failCause(cause)),
  )
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "opencode.db")
  return join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
