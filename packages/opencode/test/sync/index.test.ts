import { describe, expect, beforeEach, afterEach, afterAll } from "bun:test"
import { provideTmpdirInstance } from "../fixture/fixture"
import { Effect, Layer, Schema } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { SyncEvent } from "../../src/sync"
import { Database } from "@/storage/db"
import { EventTable } from "../../src/sync/event.sql"
import { MessageID } from "../../src/session/schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { initProjectors } from "../../src/server/projectors"
import { testEffect } from "../lib/effect"

const original = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const it = testEffect(Layer.mergeAll(SyncEvent.defaultLayer, CrossSpawnSpawner.defaultLayer))

beforeEach(() => {
  Database.close()

  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
})

afterEach(() => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original
})

describe("SyncEvent", () => {
  function setup() {
    SyncEvent.reset()

    const Created = SyncEvent.define({
      type: "item.created",
      version: 1,
      aggregate: "id",
      schema: Schema.Struct({ id: Schema.String, name: Schema.String }),
    })
    const Sent = SyncEvent.define({
      type: "item.sent",
      version: 1,
      aggregate: "item_id",
      schema: Schema.Struct({ item_id: Schema.String, to: Schema.String }),
    })

    SyncEvent.init({
      projectors: [SyncEvent.project(Created, () => {}), SyncEvent.project(Sent, () => {})],
    })

    return { Created, Sent }
  }

  function expectDefect<A, E, R>(effect: Effect.Effect<A, E, R>, pattern: RegExp) {
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(effect)
      if (exit._tag === "Success") throw new Error("Expected effect to fail")
      expect(String(exit.cause)).toMatch(pattern)
    })
  }

  afterAll(() => {
    SyncEvent.reset()
    initProjectors()
  })

  describe("run", () => {
    it.live(
      "inserts event row",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          yield* SyncEvent.use.run(Created, { id: "evt_1", name: "first" })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(1)
          expect(rows[0].type).toBe("item.created.1")
          expect(rows[0].aggregate_id).toBe("evt_1")
        }),
      ),
    )

    it.live(
      "increments seq per aggregate",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          yield* SyncEvent.use.run(Created, { id: "evt_1", name: "first" })
          yield* SyncEvent.use.run(Created, { id: "evt_1", name: "second" })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(2)
          expect(rows[1].seq).toBe(rows[0].seq + 1)
        }),
      ),
    )

    it.live(
      "uses custom aggregate field from agg()",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Sent } = setup()
          yield* SyncEvent.use.run(Sent, { item_id: "evt_1", to: "james" })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(1)
          expect(rows[0].aggregate_id).toBe("evt_1")
        }),
      ),
    )

    it.live(
      "emits events",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          const events: Array<{
            type: string
            properties: { id: string; name: string }
          }> = []
          let resolve = () => {}
          const received = new Promise<void>((done) => {
            resolve = done
          })
          const dispose = Bus.subscribeAll((event) => {
            events.push(event)
            resolve()
          })
          try {
            yield* SyncEvent.use.run(Created, { id: "evt_1", name: "test" })
            yield* Effect.promise(() => received)
            expect(events).toHaveLength(1)
            expect(events[0]).toEqual({
              type: "item.created",
              properties: {
                id: "evt_1",
                name: "test",
              },
            })
          } finally {
            dispose()
          }
        }),
      ),
    )
  })

  describe("replay", () => {
    it.live(
      "inserts event from external payload",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const id = MessageID.ascending()
          yield* SyncEvent.use.replay({
            id: "evt_1",
            type: "item.created.1",
            seq: 0,
            aggregateID: id,
            data: { id, name: "replayed" },
          })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(1)
          expect(rows[0].aggregate_id).toBe(id)
        }),
      ),
    )

    it.live(
      "throws on sequence mismatch",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const id = MessageID.ascending()
          yield* SyncEvent.use.replay({
            id: "evt_1",
            type: "item.created.1",
            seq: 0,
            aggregateID: id,
            data: { id, name: "first" },
          })
          yield* expectDefect(
            SyncEvent.use.replay({
              id: "evt_1",
              type: "item.created.1",
              seq: 5,
              aggregateID: id,
              data: { id, name: "bad" },
            }),
            /Sequence mismatch/,
          )
        }),
      ),
    )

    it.live(
      "throws on unknown event type",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* expectDefect(
            SyncEvent.use.replay({
              id: "evt_1",
              type: "unknown.event.1",
              seq: 0,
              aggregateID: "x",
              data: {},
            }),
            /Unknown event type/,
          )
        }),
      ),
    )

    it.live(
      "replayAll accepts later chunks after the first batch",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          const id = MessageID.ascending()

          const one = yield* SyncEvent.use.replayAll([
            {
              id: "evt_1",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 0,
              aggregateID: id,
              data: { id, name: "first" },
            },
            {
              id: "evt_2",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 1,
              aggregateID: id,
              data: { id, name: "second" },
            },
          ])

          const two = yield* SyncEvent.use.replayAll([
            {
              id: "evt_3",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 2,
              aggregateID: id,
              data: { id, name: "third" },
            },
            {
              id: "evt_4",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 3,
              aggregateID: id,
              data: { id, name: "fourth" },
            },
          ])

          expect(one).toBe(id)
          expect(two).toBe(id)

          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3])
        }),
      ),
    )
  })
})
