import { describe, test, expect, beforeEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import z from "zod"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { SyncEvent } from "../../src/sync"
import { Database } from "../../src/storage/db"
import { EventTable } from "../../src/sync/event.sql"
import { Identifier } from "../../src/id/id"

beforeEach(() => {
  Database.Client.reset()
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
  const Created = SyncEvent.define({
    type: "item.created",
    version: "v1",
    aggregate: "id",
    schema: z.object({ id: z.string(), name: z.string() }),
  })
  const Sent = SyncEvent.define({
    type: "item.sent",
    version: "v1",
    aggregate: "item_id",
    schema: z.object({ item_id: z.string(), to: z.string() }),
  })

  SyncEvent.init([SyncEvent.project(Created, () => {}), SyncEvent.project(Sent, () => {})])

  describe("run", () => {
    test(
      "inserts event row",
      withInstance(() => {
        SyncEvent.run(Created, { id: "msg_1", name: "first" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(1)
        expect(rows[0].name).toBe("item.created.v1")
        expect(rows[0].aggregate_id).toBe("msg_1")
      }),
    )

    test(
      "increments seq per aggregate",
      withInstance(() => {
        SyncEvent.run(Created, { id: "msg_1", name: "first" })
        SyncEvent.run(Created, { id: "msg_1", name: "second" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(2)
        expect(rows[1].seq).toBe(rows[0].seq + 1)
      }),
    )

    test(
      "uses custom aggregate field from agg()",
      withInstance(() => {
        SyncEvent.run(Sent, { item_id: "msg_1", to: "james" })
        const rows = Database.use((db) => db.select().from(EventTable).all())
        expect(rows).toHaveLength(1)
        expect(rows[0].aggregate_id).toBe("msg_1")
      }),
    )

    test(
      "emits events",
      withInstance(async () => {
        const events: Array<{
          type: string
          properties: { seq: number; aggregateID: string; data: { id: string; name: string } }
        }> = []
        const unsub = Bus.subscribeAll((event) => events.push(event))

        SyncEvent.run(Created, { id: "msg_1", name: "test" })

        expect(events).toHaveLength(1)
        expect(events[0]).toEqual({
          type: "item.created.v1",
          properties: {
            seq: 0,
            aggregateID: "msg_1",
            data: {
              id: "msg_1",
              name: "test",
            },
          },
        })

        unsub()
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
          type: "item.created.v1",
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
          type: "item.created.v1",
          seq: 0,
          aggregateID: id,
          data: { id, name: "first" },
        })
        expect(() =>
          SyncEvent.replay({
            id: "evt_1",
            type: "item.created.v1",
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
  })
})
