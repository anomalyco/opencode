import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import z from "zod"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { SyncEvent } from "../../src/sync"
import { Database } from "../../src/storage"
import { EventTable } from "../../src/sync/event.sql"
import { Identifier } from "../../src/id/id"
import { Flag } from "../../src/flag/flag"
import { initProjectors } from "../../src/server/projectors"

const original = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

beforeEach(() => {
  Database.close()

  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
})

afterEach(() => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original
})

function withInstance(fn: () => void | Promise<void>) {
  return async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fn()
      },
    })
  }
}

describe("SyncEvent", () => {
  function setup() {
    SyncEvent.reset()

    const Created = SyncEvent.define({
      type: "item.created",
      version: 1,
      aggregate: "id",
      schema: z.object({ id: z.string(), name: z.string() }),
    })
    const Sent = SyncEvent.define({
      type: "item.sent",
      version: 1,
      aggregate: "item_id",
      schema: z.object({ item_id: z.string(), to: z.string() }),
    })

    SyncEvent.init({
      projectors: [SyncEvent.project(Created, () => {}), SyncEvent.project(Sent, () => {})],
    })

    return { Created, Sent }
  }

  afterAll(() => {
    SyncEvent.reset()
    initProjectors()
  })

  describe("run", () => {
    test(
      "inserts event row",
      withInstance(() => {
        const { Created } = setup()
        SyncEvent.run(Created, { id: "evt_1", name: "first" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(1)
        expect(rows[0].type).toBe("item.created.1")
        expect(rows[0].aggregate_id).toBe("evt_1")
      }),
    )

    test(
      "increments seq per aggregate",
      withInstance(() => {
        const { Created } = setup()
        SyncEvent.run(Created, { id: "evt_1", name: "first" })
        SyncEvent.run(Created, { id: "evt_1", name: "second" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(2)
        expect(rows[1].seq).toBe(rows[0].seq + 1)
      }),
    )

    test(
      "uses custom aggregate field from agg()",
      withInstance(() => {
        const { Sent } = setup()
        SyncEvent.run(Sent, { item_id: "evt_1", to: "james" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(1)
        expect(rows[0].aggregate_id).toBe("evt_1")
      }),
    )

    test(
      "emits events",
      withInstance(async () => {
        const { Created } = setup()
        const events: Array<{
          type: string
          properties: { id: string; name: string }
        }> = []
        const received = new Promise<void>((resolve) => {
          Bus.subscribeAll((event) => {
            events.push(event)
            resolve()
          })
        })

        SyncEvent.run(Created, { id: "evt_1", name: "test" })

        await received
        expect(events).toHaveLength(1)
        expect(events[0]).toEqual({
          type: "item.created",
          properties: {
            id: "evt_1",
            name: "test",
          },
        })
      }),
    )
  })

  describe("replay", () => {
    test(
      "inserts event from external payload",
      withInstance(() => {
        const id = Identifier.descending("message")
        SyncEvent.replay({
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
    )

    test(
      "throws on sequence mismatch",
      withInstance(() => {
        const id = Identifier.descending("message")
        SyncEvent.replay({
          id: "evt_1",
          type: "item.created.1",
          seq: 0,
          aggregateID: id,
          data: { id, name: "first" },
        })
        expect(() =>
          SyncEvent.replay({
            id: "evt_1",
            type: "item.created.1",
            seq: 5,
            aggregateID: id,
            data: { id, name: "bad" },
          }),
        ).toThrow(/Sequence mismatch/)
      }),
    )

    test(
      "throws on unknown event type",
      withInstance(() => {
        expect(() =>
          SyncEvent.replay({
            id: "evt_1",
            type: "unknown.event.1",
            seq: 0,
            aggregateID: "x",
            data: {},
          }),
        ).toThrow(/Unknown event type/)
      }),
    )

    test(
      "replayAll accepts later chunks after the first batch",
      withInstance(() => {
        const { Created } = setup()
        const id = Identifier.descending("message")

        const one = SyncEvent.replayAll([
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

        const two = SyncEvent.replayAll([
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
    )
  })
})
