import { Database as BunDatabase } from "bun:sqlite"
import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { it } from "../lib/effect"

let Database: typeof import("../../src/storage/db").Database

const prev = process.env["OPENCODE_DISABLE_CHANNEL_DB"]

beforeAll(async () => {
  process.env["OPENCODE_DISABLE_CHANNEL_DB"] = "0"
  ;({ Database } = await import(`../../src/storage/db?test=${Date.now()}`))
})

afterAll(() => {
  if (prev === undefined) {
    delete process.env["OPENCODE_DISABLE_CHANNEL_DB"]
    return
  }
  process.env["OPENCODE_DISABLE_CHANNEL_DB"] = prev
})

describe("Database.getChannelPath", () => {
  it.effect("returns database path for the current channel", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service
      const expected = ["latest", "beta", "prod"].includes(InstallationChannel)
        ? path.join(Global.Path.data, "opencode.db")
        : path.join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)

      expect(Database.getChannelPath(flags)).toBe(expected)
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

  it.effect("uses the shared database path when channel databases are disabled", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(Database.getChannelPath(flags)).toBe(path.join(Global.Path.data, "opencode.db"))
    }).pipe(Effect.provide(RuntimeFlags.layer({ disableChannelDb: true }))),
  )

  it.effect("accepts RuntimeFlags with skipMigrations for database callers", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(flags.skipMigrations).toBe(true)
      expect(Database.getChannelPath(flags)).toBe(Database.getChannelPath({ disableChannelDb: flags.disableChannelDb }))
    }).pipe(Effect.provide(RuntimeFlags.layer({ skipMigrations: true }))),
  )
})

describe("Database.Client schema repair", () => {
  it.effect("adds session_message seq when a shared database is missing it", () =>
    Effect.sync(() => {
      const dir = mkdtempSync(path.join(tmpdir(), "opencode-db-repair-"))
      const dbPath = path.join(dir, "opencode.db")
      const previous = Flag.OPENCODE_DB

      try {
        const sqlite = new BunDatabase(dbPath, { create: true })
        sqlite.run("PRAGMA foreign_keys = OFF")
        sqlite.run("CREATE TABLE session (id text PRIMARY KEY)")
        sqlite.run(`
          CREATE TABLE session_message (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            type text NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL,
            data text NOT NULL
          )
        `)
        sqlite.run("CREATE INDEX session_message_session_idx ON session_message (session_id)")
        sqlite.run("CREATE INDEX session_message_session_type_idx ON session_message (session_id, type)")
        sqlite.run("CREATE INDEX session_message_time_created_idx ON session_message (time_created)")
        sqlite.run("INSERT INTO session (id) VALUES ('session')")
        sqlite.run(`
          INSERT INTO session_message (id, session_id, type, time_created, time_updated, data)
          VALUES ('later', 'session', 'assistant', 20, 20, '{}')
        `)
        sqlite.run(`
          INSERT INTO session_message (id, session_id, type, time_created, time_updated, data)
          VALUES ('earlier', 'session', 'user', 10, 10, '{}')
        `)
        sqlite.close()

        Flag.OPENCODE_DB = dbPath
        Database.Client({ disableChannelDb: true, skipMigrations: true })

        const rows = Database.Client()
          .$client.query("SELECT id, seq FROM session_message ORDER BY seq")
          .all() as { id: string; seq: number }[]
        const indexes = Database.Client()
          .$client.query("PRAGMA index_list(session_message)")
          .all() as { name: string; unique: number }[]

        expect(rows).toEqual([
          { id: "earlier", seq: 0 },
          { id: "later", seq: 1 },
        ])
        expect(indexes.find((index) => index.name === "session_message_session_seq_idx")).toMatchObject({
          unique: 1,
        })
        expect(indexes.map((index) => index.name)).toContain("session_message_session_type_seq_idx")
      } finally {
        Database.close()
        Flag.OPENCODE_DB = previous
        rmSync(dir, { recursive: true, force: true })
      }
    }),
  )
})
