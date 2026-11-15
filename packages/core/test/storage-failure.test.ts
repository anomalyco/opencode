import { describe, expect, test } from "bun:test"
import path from "path"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { StorageFailure } from "@opencode/core/database/storage-failure"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Session } from "@opencode/core/session"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { SessionEvent } from "@opencode/schema/session-event"
import { StorageEvent } from "@opencode/schema/storage-event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Cause, Context, Effect, Exit, Layer } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

type Db = Database.Interface["db"]

// A real SQLITE_FULL: the database may not grow past its current size, so writes that need a new page fail with
// "database or disk is full" while writes that fit still land.
const fillDisk = (db: Db) =>
  Effect.gen(function* () {
    const rows = yield* db.all<{ page_count: number }>("PRAGMA page_count").pipe(Effect.orDie)
    yield* db.run(`PRAGMA max_page_count = ${rows[0]!.page_count}`).pipe(Effect.orDie)
  })
const freeDisk = (db: Db) => db.run("PRAGMA max_page_count = 1073741823").pipe(Effect.orDie)

// A persisted event row is as large as its payload, so a large title needs new pages.
const large = "x".repeat(60_000)

const boot = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const context = yield* Layer.build(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
      Database.node.replace(Database.configured({ path: path.join(tmp.path, "storage.sqlite") })),
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
    ]),
  )
  const bus = Context.get(context, Bus.Service)
  const failures: string[] = []
  yield* bus.listen((event) =>
    Effect.sync(() => {
      if (event.type === StorageEvent.Failed.type) failures.push((event.data as { message: string }).message)
    }),
  )
  const sessionID = Session.ID.create()
  return {
    db: Context.get(context, Database.Service).db,
    failures,
    write: (title: string) => bus.publish(SessionEvent.Renamed, { sessionID, title }).pipe(Effect.exit),
  }
})

describe("StorageFailure", () => {
  test("reads each driver's error shape and ignores failures that are not the database's", () => {
    // bun:sqlite names the result code, extended ones included.
    expect(StorageFailure.message({ code: "SQLITE_IOERR_WRITE", message: "disk I/O error" })).toBe(
      "Storage error: disk I/O error",
    )
    // node:sqlite reports the number, whose low byte is the primary code.
    expect(StorageFailure.message({ code: "ERR_SQLITE_ERROR", errcode: 8, message: "" })).toBe(
      "Storage error: attempt to write a readonly database",
    )
    expect(StorageFailure.message(new Error("outer", { cause: { code: "SQLITE_FULL", message: "" } }))).toBe(
      "Storage error: database or disk is full",
    )
    expect(StorageFailure.message({ code: "SQLITE_CONSTRAINT_PRIMARYKEY", message: "UNIQUE failed" })).toBeUndefined()
    expect(StorageFailure.message(new Error("plain"))).toBeUndefined()
  })
})

describe("storage.failed", () => {
  it.live("is sent once while writes fail, and again only after a write succeeded in between", () =>
    Effect.gen(function* () {
      const app = yield* boot
      yield* fillDisk(app.db)
      expect(Exit.isFailure(yield* app.write(large))).toBe(true)
      expect(Exit.isFailure(yield* app.write(large))).toBe(true)
      expect(app.failures).toEqual(["Storage error: database or disk is full"])

      yield* freeDisk(app.db)
      expect(Exit.isSuccess(yield* app.write("ok"))).toBe(true)
      yield* fillDisk(app.db)
      expect(Exit.isFailure(yield* app.write(large))).toBe(true)
      expect(app.failures).toHaveLength(2)
    }),
  )

  it.live("a transaction SQLite already rolled back fails with the full disk, not the rollback", () =>
    Effect.gen(function* () {
      const app = yield* boot
      yield* app.db.run("create table filler (id integer primary key, value text)").pipe(Effect.orDie)
      yield* fillDisk(app.db)
      const exit = yield* app.db
        .transaction(() => app.db.run(`insert into filler (value) values ('${large}')`), { behavior: "immediate" })
        .pipe(Effect.exit)
      if (!Exit.isFailure(exit)) return expect(Exit.isFailure(exit)).toBe(true)
      expect(Cause.pretty(exit.cause)).not.toContain("cannot rollback")
      expect(toSessionError(Cause.squash(exit.cause))).toEqual({
        type: "storage",
        message: "Storage error: database or disk is full",
      })
      // No transaction was left open: the connection takes the next one.
      yield* freeDisk(app.db)
      yield* app.db.transaction(() => app.db.run("insert into filler (value) values ('ok')")).pipe(Effect.orDie)
    }),
  )
})
