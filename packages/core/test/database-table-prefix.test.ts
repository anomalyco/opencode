import { Database as BunDatabase } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import path from "path"
import { eq, inArray, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opencode/core/database/database"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import type { DurableObjectStorage } from "@opencode/core/database/sqlite.workerd"
import { KVTable } from "@opencode/core/kv/sql"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionTable } from "@opencode/core/session/sql"
import { Global } from "@opencode/util/global"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { tempGlobalLayer } from "./fixture/global"
import { tmpdir } from "./fixture/tmpdir"

const prefix = "opencode_"

// Tables an embedder created before OpenCode first booted, named like OpenCode's own.
const foreign = ["session", "kv", "cf_agents_state"]

const createForeign = (exec: (query: string) => unknown) => {
  foreign.forEach((name) => exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`))
  foreign.forEach((name) => exec(`INSERT INTO ${name} (id, value) VALUES ('host', 'kept')`))
  exec("CREATE INDEX session_value ON session (value)")
}

const objects = (storage: DurableObjectStorage) =>
  storage.sql
    .exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .toArray()
    .map((row) => ({ type: String(row.type), name: String(row.name) }))

const bootWorkerd = (storage: DurableObjectStorage, options?: Database.ClientOptions) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.db
        .insert(KVTable)
        .values({ key: "probe", value: { ok: true } })
        .onConflictDoNothing()
      return yield* database.db.select().from(KVTable).where(eq(KVTable.key, "probe")).get()
    }).pipe(
      Effect.provide(
        Database.layerFromClient(options).pipe(Layer.provide(sqliteLayer({ storage })), Layer.provide(tempGlobalLayer)),
      ),
    ),
  )

describe("database table prefix", () => {
  test("renders every table reference under the prefix, leaving columns that share a table's name", async () => {
    const queries = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults({ tablePrefix: prefix })
        return [
          db
            .select({ id: SessionTable.id, worktree: ProjectTable.worktree })
            .from(SessionTable)
            .innerJoin(ProjectTable, eq(SessionTable.project_id, ProjectTable.id))
            .toSQL().sql,
          db.update(ProjectTable).set({ time_active: 1 }).where(eq(ProjectTable.time_active, 0)).toSQL().sql,
          db
            .insert(KVTable)
            .values({ key: "k", value: 1 })
            .onConflictDoUpdate({ target: KVTable.key, set: { value: 2 } })
            .toSQL().sql,
          db.delete(KVTable).where(eq(KVTable.key, "k")).toSQL().sql,
          db
            .select({ count: sql<number>`count(${KVTable.key})` })
            .from(KVTable)
            .where(inArray(KVTable.key, db.select({ id: ProjectTable.id }).from(ProjectTable)))
            .toSQL().sql,
        ]
      }).pipe(Effect.provide(sqliteLayer({ storage: makeDurableObjectStorage() }))),
    )
    expect(queries).toEqual([
      `select "opencode_session_v2"."id", "opencode_project"."worktree" from "opencode_session_v2" inner join "opencode_project" on "opencode_session_v2"."project_id" = "opencode_project"."id"`,
      `update "opencode_project" set "time_updated" = ?, "time_active" = ? where "opencode_project"."time_active" = ?`,
      `insert into "opencode_kv" ("key", "value", "time_created", "time_updated") values (?, ?, ?, ?) on conflict ("opencode_kv"."key") do update set "value" = ?, "time_updated" = ?`,
      `delete from "opencode_kv" where "opencode_kv"."key" = ?`,
      `select count("key") from "opencode_kv" where "opencode_kv"."key" in (select "id" from "opencode_project")`,
    ])
  })

  test("rejects prefixes that are not plain identifiers", async () => {
    for (const invalid of ["open-code_", "sqlite_x", "1x"]) {
      const exit = await Effect.runPromiseExit(
        Layer.build(
          Database.layerFromClient({ prefix: invalid }).pipe(
            Layer.provide(sqliteLayer({ storage: makeDurableObjectStorage() })),
            Layer.provide(tempGlobalLayer),
          ),
        ).pipe(Effect.scoped),
      )
      expect(exit._tag).toBe("Failure")
    }
  })

  test("boots workerd storage under a prefix beside the host's tables", async () => {
    const storage = makeDurableObjectStorage()
    createForeign((query) => storage.sql.exec(query))

    expect(await bootWorkerd(storage, { prefix })).toMatchObject({ key: "probe", value: { ok: true } })
    // A second boot takes the migration path over the existing prefixed schema.
    expect(await bootWorkerd(storage, { prefix })).toMatchObject({ key: "probe", value: { ok: true } })

    const all = objects(storage)
    const owned = all.filter((item) => item.name.startsWith(prefix))
    expect(owned.map((item) => item.name)).toEqual(
      expect.arrayContaining(["opencode_migration", "opencode_session_v2"]),
    )
    expect(owned.some((item) => item.type === "index")).toBe(true)
    expect(all.filter((item) => !item.name.startsWith(prefix))).toEqual([
      { type: "table", name: "cf_agents_state" },
      { type: "table", name: "kv" },
      { type: "table", name: "session" },
      { type: "index", name: "session_value" },
    ])
    foreign.forEach((name) =>
      expect(storage.sql.exec(`SELECT id, value FROM ${name}`).toArray()).toEqual([{ id: "host", value: "kept" }]),
    )
  })

  test("creates the same schema under a prefix as without one", async () => {
    const plain = makeDurableObjectStorage()
    const prefixed = makeDurableObjectStorage()
    await bootWorkerd(plain)
    await bootWorkerd(prefixed, { prefix })

    expect(objects(prefixed).map((item) => ({ ...item, name: item.name.slice(prefix.length) }))).toEqual(objects(plain))
  })

  test("boots a shared database file under a prefix", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "shared.db")
    const host = new BunDatabase(filename)
    createForeign((query) => host.run(query))
    host.close()

    await Effect.runPromise(
      Layer.build(Database.layer({ path: filename, prefix })).pipe(
        Effect.scoped,
        Effect.provideService(Global.Service, Global.make({ data: tmp.path })),
      ),
    )

    const shared = new BunDatabase(filename, { readonly: true })
    const names = shared
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name)
    expect(names.filter((name) => !name.startsWith(prefix))).toEqual([
      "cf_agents_state",
      "kv",
      "session",
      "session_value",
    ])
    expect(names).toContain("opencode_session_v2")
    expect(shared.query("SELECT id, value FROM kv").all()).toEqual([{ id: "host", value: "kept" }])
    shared.close()
  })
})
