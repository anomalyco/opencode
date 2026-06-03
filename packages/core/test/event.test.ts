import { describe, expect } from "bun:test"
import { DateTime, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { V2Schema } from "@opencode-ai/core/v2-schema"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("project"), workspaceID: WorkspaceV2.ID.make("wrk_test") })),
)
const eventLayer = Layer.mergeAll(EventV2.defaultLayer, Database.defaultLayer)
const it = testEffect(eventLayer.pipe(Layer.provideMerge(locationLayer)))
const itWithoutLocation = testEffect(eventLayer)

const Message = EventV2.define({
  type: "test.message",
  schema: {
    text: Schema.String,
  },
})

const SyncMessage = EventV2.define({
  type: "test.sync",
  sync: {
    version: 1,
    aggregate: "id",
  },
  schema: {
    id: Schema.String,
    text: Schema.String,
  },
})

const SyncSent = EventV2.define({
  type: "test.sent",
  sync: {
    version: 1,
    aggregate: "messageID",
  },
  schema: {
    messageID: Schema.String,
    text: Schema.String,
  },
})

const GlobalMessage = EventV2.define({
  type: "test.global",
  schema: {
    text: Schema.String,
  },
})

const VersionedMessage = EventV2.define({
  type: "test.versioned",
  sync: {
    version: 2,
    aggregate: "id",
  },
  schema: {
    id: Schema.String,
    text: Schema.String,
  },
})

const SyncTimestamp = EventV2.define({
  type: "test.timestamp",
  sync: {
    version: 1,
    aggregate: "id",
  },
  schema: {
    id: Schema.String,
    timestamp: V2Schema.DateTimeUtcFromMillis,
  },
})

describe("EventV2", () => {
  it.effect("derives stable namespaced external IDs", () =>
    Effect.sync(() => {
      const input = { namespace: "opencord.agent-input", key: "input-1" }

      expect(EventV2.ID.fromExternal(input)).toBe(EventV2.ID.fromExternal(input))
      expect(EventV2.ID.fromExternal(input)).toMatch(/^evt_[a-f0-9]{64}$/)
      expect(EventV2.ID.fromExternal({ ...input, namespace: "another-app" })).not.toBe(EventV2.ID.fromExternal(input))
    }),
  )

  it.effect("publishes events with the current location", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const fiber = yield* events.subscribe(Message).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const event = yield* events.publish(Message, { text: "hello" })
      const received = Array.from(yield* Fiber.join(fiber))

      expect(received).toEqual([event])
      expect(event.type).toBe("test.message")
      expect(event).not.toHaveProperty("version")
      expect(event.data).toEqual({ text: "hello" })
      expect(event.location).toEqual({ directory: AbsolutePath.make("project"), workspaceID: WorkspaceV2.ID.make("wrk_test") })
    }),
  )

  itWithoutLocation.effect("omits location when no location is available", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const event = yield* events.publish(GlobalMessage, { text: "hello" })

      expect(event).not.toHaveProperty("location")
      expect(event.type).toBe("test.global")
    }),
  )

  it.effect("publishes definition version", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const event = yield* events.publish(VersionedMessage, { id: "one", text: "hello" })

      expect(event.type).toBe("test.versioned")
      expect(event.version).toBe(2)
    }),
  )

  it.effect("stores definitions in the exported registry", () =>
    Effect.sync(() => {
      expect(EventV2.registry.get(Message.type)).toBe(Message)
    }),
  )

  it.effect("keeps the latest sync definition in the registry", () =>
    Effect.sync(() => {
      const latest = EventV2.define({
        type: "test.out-of-order",
        sync: { version: 2, aggregate: "id" },
        schema: { id: Schema.String },
      })
      EventV2.define({
        type: "test.out-of-order",
        sync: { version: 1, aggregate: "id" },
        schema: { id: Schema.String },
      })

      expect(EventV2.registry.get("test.out-of-order")).toBe(latest)
    }),
  )

  it.effect("publishes to typed and wildcard subscriptions", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const typed = yield* events.subscribe(Message).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const wildcard = yield* events.all().pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const event = yield* events.publish(Message, { text: "hello" })

      expect(Array.from(yield* Fiber.join(typed))).toEqual([event])
      expect(Array.from(yield* Fiber.join(wildcard))).toEqual([event])
    }),
  )

  it.effect("runs projectors inline", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<EventV2.Payload>()
      yield* events.project(SyncMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      const event = yield* events.publish(SyncMessage, { id: "one", text: "hello" })
      yield* events.publish(SyncMessage, { id: "one", text: "after unsubscribe" })

      expect(received[0]).toEqual(event)
      expect(received[1]?.data).toEqual({ id: "one", text: "after unsubscribe" })
    }),
  )

  it.effect("runs projectors before publishing to streams", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<string>()
      const fiber = yield* events.all().pipe(
        Stream.take(1),
        Stream.runForEach(() => Effect.sync(() => received.push("stream"))),
        Effect.forkScoped,
      )
      yield* events.project(SyncMessage, (event) =>
        Effect.sync(() => {
          received.push(event.type)
        }),
      )

      yield* Effect.yieldNow
      yield* events.publish(SyncMessage, { id: "one", text: "hello" })
      yield* Fiber.join(fiber)

      expect(received).toEqual([SyncMessage.type, "stream"])
    }),
  )

  it.effect("runs listeners inline after projectors", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<string>()
      yield* events.project(SyncMessage, () =>
        Effect.sync(() => {
          received.push("projector")
        }),
      )
      const unsubscribe = yield* events.listen(() =>
        Effect.sync(() => {
          received.push("listener")
        }),
      )

      yield* events.publish(SyncMessage, { id: "one", text: "hello" })
      yield* unsubscribe
      yield* events.publish(SyncMessage, { id: "one", text: "after unsubscribe" })

      expect(received).toEqual(["projector", "listener", "projector"])
    }),
  )

  it.effect("does not synchronize live-only events", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const synchronized = new Array<string>()
      const unsubscribe = yield* events.sync((event) =>
        Effect.sync(() => {
          synchronized.push(event.type)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* events.publish(Message, { text: "live only" })
      yield* events.publish(SyncMessage, { id: "one", text: "durable" })

      expect(synchronized).toEqual([SyncMessage.type])
    }),
  )

  it.effect("inserts sync event rows on publish", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      yield* events.publish(SyncMessage, { id: aggregateID, text: "first" })
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.type).toBe(EventV2.versionedType(SyncMessage.type, 1))
      expect(rows[0]?.aggregate_id).toBe(aggregateID)
    }),
  )

  it.effect("increments sync event seq per aggregate", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      yield* events.publish(SyncMessage, { id: aggregateID, text: "first" })
      yield* events.publish(SyncMessage, { id: aggregateID, text: "second" })
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)

      expect(rows.map((row) => row.seq)).toEqual([0, 1])
    }),
  )

  it.effect("replays durable aggregate events after a cursor and tails new events", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = EventV2.ID.create()
      yield* events.publish(SyncMessage, { id: aggregateID, text: "zero" })
      yield* events.publish(SyncMessage, { id: aggregateID, text: "one" })
      const fiber = yield* events.events({ aggregateID, after: 0 }).pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* events.publish(SyncMessage, { id: aggregateID, text: "two" })

      expect(Array.from(yield* Fiber.join(fiber)).map((event) => [event.cursor, event.event.data])).toEqual([
        [1, { id: aggregateID, text: "one" }],
        [2, { id: aggregateID, text: "two" }],
      ])
    }),
  )

  it.effect("catches durable aggregate events published during replay handoff", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = EventV2.ID.create()
      yield* events.publish(SyncMessage, { id: aggregateID, text: "zero" })
      const fiber = yield* events.events({ aggregateID }).pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)

      yield* events.publish(SyncMessage, { id: aggregateID, text: "one" })

      expect(Array.from(yield* Fiber.join(fiber)).map((event) => [event.cursor, (event.event.data as { text: string }).text])).toEqual([
        [0, "zero"],
        [1, "one"],
      ])
    }),
  )

  it.effect("omits live-only events from durable aggregate streams", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = EventV2.ID.create()
      const fiber = yield* events.events({ aggregateID }).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* events.publish(Message, { text: "live only" })
      yield* events.publish(SyncMessage, { id: aggregateID, text: "durable" })

      expect(Array.from(yield* Fiber.join(fiber)).map((event) => event.event.type)).toEqual([SyncMessage.type])
    }),
  )

  it.effect("uses custom sync aggregate field", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      yield* events.publish(SyncSent, { messageID: aggregateID, text: "sent" })
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.aggregate_id).toBe(aggregateID)
    }),
  )

  it.effect("replays sync events through projectors", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<EventV2.Payload>()
      yield* events.project(SyncMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )
      const aggregateID = EventV2.ID.create()

      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SyncMessage.type, 1),
        seq: 0,
        aggregateID,
        data: { id: aggregateID, text: "hello" },
      })

      expect(received[0]?.type).toBe(SyncMessage.type)
      expect(received[0]?.data).toEqual({ id: aggregateID, text: "hello" })
    }),
  )

  it.effect("replay inserts external event rows", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SyncMessage.type, 1),
        seq: 0,
        aggregateID,
        data: { id: aggregateID, text: "replayed" },
      })
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.aggregate_id).toBe(aggregateID)
    }),
  )

  it.effect("replay defects on sequence mismatch", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = EventV2.ID.create()

      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SyncMessage.type, 1),
        seq: 0,
        aggregateID,
        data: { id: aggregateID, text: "first" },
      })
      const exit = yield* events
        .replay({
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 5,
          aggregateID,
          data: { id: aggregateID, text: "bad" },
        })
        .pipe(Effect.exit)

      expect(String(exit)).toContain("Sequence mismatch")
    }),
  )

  it.effect("replay decodes synchronized transformed values before projection", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = EventV2.ID.create()
      const received = new Array<typeof SyncTimestamp.Type>()
      yield* events.project(SyncTimestamp, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SyncTimestamp.type, 1),
        seq: 0,
        aggregateID,
        data: { id: aggregateID, timestamp: 0 },
      })

      expect(received[0]?.data.timestamp).toEqual(DateTime.makeUnsafe(0))
    }),
  )

  it.effect("replay defects on unknown event type", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const exit = yield* events
        .replay({
          id: EventV2.ID.create(),
          type: "unknown.event.1",
          seq: 0,
          aggregateID: EventV2.ID.create(),
          data: {},
        })
        .pipe(Effect.exit)

      expect(String(exit)).toContain("Unknown sync event type")
    }),
  )

  it.effect("replayAll validates contiguous aggregate events", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = EventV2.ID.create()
      const source = yield* events.replayAll([
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 0,
          aggregateID,
          data: { id: aggregateID, text: "one" },
        },
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 1,
          aggregateID,
          data: { id: aggregateID, text: "two" },
        },
      ])

      expect(source).toBe(aggregateID)
    }),
  )

  it.effect("replayAll accepts later chunks after the first batch", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      const one = yield* events.replayAll([
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 0,
          aggregateID,
          data: { id: aggregateID, text: "one" },
        },
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 1,
          aggregateID,
          data: { id: aggregateID, text: "two" },
        },
      ])
      const two = yield* events.replayAll([
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 2,
          aggregateID,
          data: { id: aggregateID, text: "three" },
        },
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 3,
          aggregateID,
          data: { id: aggregateID, text: "four" },
        },
      ])
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)

      expect(one).toBe(aggregateID)
      expect(two).toBe(aggregateID)
      expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3])
    }),
  )

  it.effect("claim fences replay owners", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<EventV2.Payload>()
      const aggregateID = EventV2.ID.create()
      yield* events.publish(SyncMessage, { id: aggregateID, text: "seed" })
      yield* events.claim(aggregateID, "owner-a")
      yield* events.project(SyncMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      yield* events.replay(
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 1,
          aggregateID,
          data: { id: aggregateID, text: "ignored" },
        },
        { ownerID: "owner-b" },
      )

      expect(received).toHaveLength(0)
    }),
  )

  it.effect("replay with owner claims an unowned sequence", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      yield* events.replay(
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 0,
          aggregateID,
          data: { id: aggregateID, text: "owned" },
        },
        { ownerID: "owner-1" },
      )
      const row = yield* db
        .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, aggregateID))
        .get()
        .pipe(Effect.orDie)

      expect(row).toEqual({ seq: 0, ownerID: "owner-1" })
    }),
  )

  it.effect("replay from a different owner leaves claimed sequence unchanged", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      yield* events.replay(
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 0,
          aggregateID,
          data: { id: aggregateID, text: "first" },
        },
        { ownerID: "owner-1" },
      )
      yield* events.replay(
        {
          id: EventV2.ID.create(),
          type: EventV2.versionedType(SyncMessage.type, 1),
          seq: 1,
          aggregateID,
          data: { id: aggregateID, text: "ignored" },
        },
        { ownerID: "owner-2" },
      )
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)
      const sequence = yield* db
        .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, aggregateID))
        .get()
        .pipe(Effect.orDie)

      expect(rows).toHaveLength(1)
      expect(sequence).toEqual({ seq: 0, ownerID: "owner-1" })
    }),
  )

  it.effect("claim updates the event sequence owner", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const aggregateID = EventV2.ID.create()

      yield* events.publish(SyncMessage, { id: aggregateID, text: "claimed" })
      yield* events.claim(aggregateID, "owner-1")
      yield* events.claim(aggregateID, "owner-2")
      const row = yield* db
        .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, aggregateID))
        .get()
        .pipe(Effect.orDie)

      expect(row).toEqual({ seq: 0, ownerID: "owner-2" })
    }),
  )

  it.effect("remove clears sync event sequence", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<EventV2.Payload>()
      const aggregateID = EventV2.ID.create()
      yield* events.publish(SyncMessage, { id: aggregateID, text: "seed" })
      yield* events.remove(aggregateID)
      yield* events.project(SyncMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      yield* events.replay({
        id: EventV2.ID.create(),
        type: EventV2.versionedType(SyncMessage.type, 1),
        seq: 0,
        aggregateID,
        data: { id: aggregateID, text: "replayed" },
      })

      expect(received[0]?.data).toEqual({ id: aggregateID, text: "replayed" })
    }),
  )
})
