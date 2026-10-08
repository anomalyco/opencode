import { describe, expect, test } from "bun:test"
import { Database as Native } from "bun:sqlite"
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { Database } from "@opencode/core/database/database"
import { StorageRetry } from "@opencode/core/database/storage-retry"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Job } from "@opencode/core/job"
import { KV } from "@opencode/core/kv"
import { SessionSchema } from "@opencode/core/session/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"
import { StorageFault } from "./lib/storage-fault"

const disk = StorageFault.make()
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Job.node, KV.node]), [
    Database.node.replace(disk.node),
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)

const Noted = Bus.durable({
  type: "test.storage.noted",
  durable: { version: 1, aggregate: "id" },
  schema: { id: Schema.String, text: Schema.String },
})

const stored = (id: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, id)).all().pipe(Effect.orDie)
  })

const finishShellOnFullDisk = (shellID: string) =>
  Effect.gen(function* () {
    const jobs = yield* Job.Service
    const release = yield* Deferred.make<void>()
    yield* jobs.start({
      id: shellID,
      type: "shell",
      recovery: {
        kind: "shell",
        sessionID: SessionSchema.ID.make(`ses_${shellID}`),
        shellID,
        command: "echo done",
      },
      run: Deferred.await(release).pipe(Effect.as("done")),
    })
    yield* jobs.background(shellID)
    const waiting = yield* jobs.wait({ id: shellID }).pipe(Effect.forkScoped)
    yield* disk.fill
    yield* Deferred.succeed(release, undefined)
    return { jobs, waiting }
  })

describe("StorageRetry", () => {
  test("treats a full, busy, or failing disk as transient and other SQLite errors as permanent", () => {
    const native = new Native(":memory:")
    native.run("CREATE TABLE once (id INTEGER PRIMARY KEY)")
    native.run("INSERT INTO once (id) VALUES (1)")
    const thrown = (statement: () => void) => {
      try {
        statement()
      } catch (cause) {
        return cause
      }
      throw new Error("Expected the statement to fail")
    }
    const constraint = thrown(() => native.run("INSERT INTO once (id) VALUES (1)"))
    native.run("PRAGMA max_page_count = 2")
    const full = thrown(() => native.run("CREATE TABLE filler (value TEXT)"))

    expect(StorageRetry.isTransient(Cause.die(full))).toBe(true)
    expect(
      StorageRetry.isTransient(Cause.fail({ cause: Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }) })),
    ).toBe(true)
    expect(StorageRetry.isTransient(Object.assign(new Error("write"), { code: "SQLITE_IOERR_WRITE" }))).toBe(true)
    expect(
      StorageRetry.isTransient(Object.assign(new Error("node write"), { code: "ERR_SQLITE_ERROR", errcode: 778 })),
    ).toBe(true)
    expect(StorageRetry.isTransient(Cause.die(constraint))).toBe(false)
    expect(StorageRetry.isTransient(Cause.combine(Cause.die(full), Cause.interrupt()))).toBe(false)
    expect(StorageRetry.message(Cause.die({ cause: full }))).toBe("database or disk is full")
    expect(StorageRetry.message(Cause.die(constraint))).toBeUndefined()
  })

  it.effect("a durable publish waits out a full disk and commits once", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      yield* disk.fill
      const publishing = yield* bus.publish(Noted, { id: "agg_single", text: "kept" }).pipe(Effect.forkScoped)
      const batching = yield* bus
        .publishAll([
          [Noted, { id: "agg_batch", text: "first" }],
          [Noted, { id: "agg_batch", text: "second" }],
        ])
        .pipe(Effect.forkScoped)

      yield* StorageFault.elapse(10_000)
      expect(publishing.pollUnsafe()).toBeUndefined()
      expect(batching.pollUnsafe()).toBeUndefined()
      expect(yield* stored("agg_single")).toEqual([])
      expect(yield* disk.failures).toBeGreaterThan(2)

      yield* disk.free
      yield* StorageFault.elapse(3_000)
      expect((yield* Fiber.join(publishing)).durable?.seq).toBe(Event.Seq.make(0))
      expect((yield* Fiber.join(batching)).map((event) => event.durable?.seq)).toEqual([
        Event.Seq.make(0),
        Event.Seq.make(1),
      ])
      expect((yield* stored("agg_single")).map((row) => row.data)).toEqual([{ id: "agg_single", text: "kept" }])
      expect((yield* stored("agg_batch")).map((row) => row.seq)).toEqual([0, 1])
    }),
  )

  it.effect("a disk that stays full fails the publish after the retry window", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      yield* disk.fill
      const publishing = yield* bus
        .publish(Noted, { id: "agg_lost", text: "lost" })
        .pipe(Effect.exit, Effect.forkScoped)

      yield* StorageFault.elapse(40_000)
      const exit = yield* Fiber.join(publishing)
      expect(Exit.isFailure(exit) && StorageRetry.isTransient(exit.cause)).toBe(true)
      yield* disk.free
      expect(yield* stored("agg_lost")).toEqual([])
    }),
  )

  it.effect("a background job settles even when its outcome cannot be persisted", () =>
    Effect.gen(function* () {
      const { waiting } = yield* finishShellOnFullDisk("sh_disk_full")
      yield* StorageFault.elapse(40_000)
      expect((yield* Fiber.join(waiting)).info).toMatchObject({ status: "completed", output: "done" })
      yield* disk.free
    }),
  )

  it.effect("a background job persists its outcome once a briefly full disk frees", () =>
    Effect.gen(function* () {
      const { jobs, waiting } = yield* finishShellOnFullDisk("sh_disk_brief")
      yield* StorageFault.elapse(5_000)
      yield* disk.free
      yield* StorageFault.elapse(3_000)
      expect((yield* Fiber.join(waiting)).info).toMatchObject({ status: "completed" })
      expect((yield* jobs.pendingBackground).find((item) => item.id === "sh_disk_brief")).toMatchObject({
        status: "completed",
        output: "done",
      })
    }),
  )
})
