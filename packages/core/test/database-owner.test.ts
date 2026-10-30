import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode/core/database/database"
import { acquireDatabaseOwner, releaseDatabaseOwner } from "@opencode/core/database/owner"
import { DatabaseMigration } from "@opencode/core/database/migration"
import { KV } from "@opencode/core/kv"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import {
  DATABASE_OWNER_TABLE,
  databaseOwnerAlive,
  databaseOwnerIdentity,
  parseDatabaseOwnerJson,
} from "@opencode/util/database-owner"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, KV.node, Global.node])))
const table = sql.identifier(DATABASE_OWNER_TABLE)
const owner = {
  version: 1,
  token: "another-process",
  pid: process.pid,
  host: databaseOwnerIdentity.host,
  refs: 1,
} as const
type DB = Database.Service["Service"]["db"]
const read = (db: DB) => db.get<{ value: string }>(sql`SELECT value FROM ${table} WHERE id = 1`)
const seed = (db: DB, value: string) => db.run(sql`UPDATE ${table} SET value = ${value} WHERE id = 1`)

test("process liveness never expires on elapsed time; unknown hosts fail closed", () => {
  expect(databaseOwnerAlive(owner)).toBe(true)
  expect(databaseOwnerAlive(owner, { host: owner.host, exists: () => false })).toBe(false)
  expect(databaseOwnerAlive(owner, { host: "another-host", exists: () => false })).toBe(true)
})

it.effect("refuses a foreign live process without touching its lease", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* acquireDatabaseOwner(db)
    yield* seed(db, JSON.stringify(owner))
    const result = yield* acquireDatabaseOwner(db).pipe(Effect.result)
    expect(result._tag).toBe("Failure")
    expect((yield* read(db))?.value).toBe(JSON.stringify(owner))
    yield* releaseDatabaseOwner(db, false)
    expect((yield* read(db))?.value).toBe(JSON.stringify(owner))
  }),
)

it.effect("references same-process connections and releases only the final reference", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    expect(yield* acquireDatabaseOwner(db)).toBe(true)
    expect(yield* acquireDatabaseOwner(db)).toBe(true)
    expect(parseDatabaseOwnerJson((yield* read(db))?.value ?? "").refs).toBe(2)
    yield* releaseDatabaseOwner(db, true)
    expect(parseDatabaseOwnerJson((yield* read(db))?.value ?? "").refs).toBe(1)
    yield* releaseDatabaseOwner(db, true)
    expect(yield* read(db)).toBeUndefined()
  }),
)

it.effect("recovers an exited process and never exposes coordination through KV.scan", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const kv = yield* KV.Service
    const child = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8", timeout: 5000 })
    expect(child.status).toBe(0)
    const pid = Number(child.stdout.trim())
    expect(pid).toBeGreaterThan(0)
    yield* acquireDatabaseOwner(db)
    yield* seed(db, JSON.stringify({ ...owner, pid }))
    expect(yield* acquireDatabaseOwner(db)).toBe(true)
    expect(parseDatabaseOwnerJson((yield* read(db))?.value ?? "")).toEqual({
      version: 1,
      ...databaseOwnerIdentity,
      refs: 1,
    })
    expect((yield* kv.scan({ prefix: "" })).entries).toEqual([])
    yield* releaseDatabaseOwner(db, true)
  }),
)

it.effect("fails closed on corruption but leaves corrupt state untouched during teardown", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* acquireDatabaseOwner(db)
    yield* seed(db, "not-json")
    const result = yield* acquireDatabaseOwner(db).pipe(Effect.result)
    expect(result._tag).toBe("Failure")
    yield* releaseDatabaseOwner(db, true)
    expect((yield* read(db))?.value).toBe("not-json")
  }),
)

it.effect("coordination survives a normal schema check without participating in migrations", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* acquireDatabaseOwner(db)
    const before = yield* read(db)
    yield* DatabaseMigration.apply(db)
    expect(yield* read(db)).toEqual(before)
    yield* releaseDatabaseOwner(db, true)
  }),
)
