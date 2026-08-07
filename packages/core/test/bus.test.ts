import { describe, expect } from "bun:test"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Schema, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/event"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { eq } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location({ directory: AbsolutePath.make("project"), workspaceID: Workspace.ID.make("wrk_test") }),
  ),
)
const Message = Bus.ephemeral({
  type: "test.message",
  schema: {
    text: Schema.String,
  },
})

const SyncMessage = Bus.durable({
  type: "test.sync",
  durable: {
    version: 1,
    aggregate: "id",
  },
  schema: {
    id: Schema.String,
    text: Schema.String,
  },
})

const SyncSent = Bus.durable({
  type: "test.sent",
  durable: {
    version: 1,
    aggregate: "messageID",
  },
  schema: {
    messageID: Schema.String,
    text: Schema.String,
  },
})

const VersionedMessageV1 = Bus.durable({
  type: "test.versioned",
  durable: { version: 1, aggregate: "id" },
  schema: { id: Schema.String },
})
const VersionedMessageV2 = Bus.durable({
  type: "test.versioned",
  durable: { version: 2, aggregate: "id" },
  schema: { id: Schema.String },
})

const GlobalMessage = Bus.ephemeral({
  type: "test.global",
  schema: {
    text: Schema.String,
  },
})
const CountMessage = Bus.ephemeral({
  type: "test.count",
  schema: {
    count: Schema.Number,
  },
})

const VersionedMessage = Bus.durable({
  type: "test.versioned",
  durable: {
    version: 2,
    aggregate: "id",
  },
  schema: {
    id: Schema.String,
    text: Schema.String,
  },
})

const DurableMessage = SessionEvent.Renamed
const durableData = (sessionID: Session.ID, text: string) => ({
  sessionID,
  title: text,
})

/** Followed log read without markers: the old `durable` stream shape. */
const tail = (bus: Bus.Interface, input: { aggregateID: string; after?: number }) =>
  bus.log({ ...input, follow: true }).pipe(Stream.filter((item): item is Event.Payload => !Bus.isSynced(item)))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Location.node]), [
    [Location.node, locationLayer],
    [Bus.node, Bus.configured({ persist: true })],
  ]),
)
const itWithoutLocation = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    [Bus.node, Bus.configured({ persist: true })],
  ]),
)
const itWithoutPersistence = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node])),
)

describe("Bus", () => {
  it.effect("subscribes to multiple event definitions with a discriminated payload union", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      // @ts-expect-error multi-definition subscriptions require at least one definition
      bus.subscribe([])
      const fiber = yield* bus
        .subscribe([Message, CountMessage])
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* bus.publish(Message, { text: "hello" })
      yield* bus.publish(CountMessage, { count: 2 })

      const received = Array.from(yield* Fiber.join(fiber)).map((event) =>
        event.type === "test.message" ? event.data.text : event.data.count,
      )
      expect(received).toEqual(["hello", 2])
    }),
  )

  it.effect("publishes events with the current location", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const fiber = yield* bus.subscribe(Message).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const event = yield* bus.publish(Message, { text: "hello" })
      const received = Array.from(yield* Fiber.join(fiber))

      expect(received).toEqual([event])
      expect(event.type).toBe("test.message")
      expect(event).not.toHaveProperty("version")
      expect(event.data).toEqual({ text: "hello" })
      expect(event.location).toEqual({
        directory: AbsolutePath.make("project"),
        workspaceID: Workspace.ID.make("wrk_test"),
      })
    }),
  )

  itWithoutLocation.effect("omits location when no location is available", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const event = yield* bus.publish(GlobalMessage, { text: "hello" })

      expect(event).not.toHaveProperty("location")
      expect(event.type).toBe("test.global")
    }),
  )

  it.effect("publishes definition version", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const event = yield* bus.publish(VersionedMessage, { id: "one", text: "hello" })

      expect(event.type).toBe("test.versioned")
      expect(event.durable?.version).toBe(Event.Version.make(2))
    }),
  )

  it.effect("selects the latest durable definition independent of declaration order", () =>
    Effect.sync(() => {
      const latest = Bus.durable({
        type: "test.out-of-order",
        durable: { version: 2, aggregate: "id" },
        schema: { id: Schema.String },
      })
      const historical = Bus.durable({
        type: "test.out-of-order",
        durable: { version: 1, aggregate: "id" },
        schema: { id: Schema.String },
      })

      expect(Event.latest([latest, historical]).get("test.out-of-order")).toBe(latest)
      expect(Event.latest([historical, latest]).get("test.out-of-order")).toBe(latest)
    }),
  )

  it.effect("publishes to typed and wildcard subscriptions", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const typed = yield* bus.subscribe(Message).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const wildcard = yield* bus.subscribe().pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const event = yield* bus.publish(Message, { text: "hello" })

      expect(Array.from(yield* Fiber.join(typed))).toEqual([event])
      expect(Array.from(yield* Fiber.join(wildcard))).toEqual([event])
    }),
  )

  it.effect("runs projectors inline", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<Event.Payload>()
      yield* bus.project(SyncMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      const event = yield* bus.publish(SyncMessage, { id: "one", text: "hello" })
      yield* bus.publish(SyncMessage, { id: "one", text: "after unsubscribe" })

      expect(received[0]).toEqual(event)
      expect(received[1]?.data).toEqual({ id: "one", text: "after unsubscribe" })
    }),
  )

  it.effect("commits local operational state inside a new durable event transaction", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<string>()
      const aggregateID = Event.ID.create()
      yield* bus.project(SyncMessage, () => Effect.sync(() => received.push("projector")))

      yield* bus.publish(
        SyncMessage,
        { id: aggregateID, text: "hello" },
        { commit: (seq) => Effect.sync(() => received.push(`commit:${seq}`)) },
      )

      expect(received).toEqual(["projector", "commit:0"])
    }),
  )

  it.effect("rolls back the durable event and projector when the local commit fails", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Event.ID.create()
      yield* db.run("CREATE TABLE IF NOT EXISTS event_commit_probe (value text NOT NULL)")
      yield* db.run("DELETE FROM event_commit_probe")
      yield* bus.project(SyncMessage, () =>
        db.run("INSERT INTO event_commit_probe (value) VALUES ('projected')").pipe(Effect.orDie, Effect.asVoid),
      )

      const exit = yield* bus
        .publish(SyncMessage, { id: aggregateID, text: "hello" }, { commit: () => Effect.die("commit failed") })
        .pipe(Effect.exit)

      expect(String(exit)).toContain("commit failed")
      expect(yield* db.all("SELECT value FROM event_commit_probe")).toEqual([])
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).all()).toEqual([])
      expect(
        yield* db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, aggregateID)).all(),
      ).toEqual([])
    }),
  )

  itWithoutPersistence.effect("projects durable events without retaining their payloads", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Event.ID.create()
      yield* db.run("CREATE TABLE IF NOT EXISTS event_commit_probe (value text NOT NULL)")
      yield* bus.project(SyncMessage, () =>
        db.run("INSERT INTO event_commit_probe (value) VALUES ('projected')").pipe(Effect.orDie, Effect.asVoid),
      )

      const event = yield* bus.publish(SyncMessage, { id: aggregateID, text: "hello" })

      expect(event.durable?.seq).toBe(Event.Seq.make(0))
      expect(yield* db.all("SELECT value FROM event_commit_probe")).toEqual([{ value: "projected" }])
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).all()).toEqual([])
      expect(
        yield* db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, aggregateID)).all(),
      ).toEqual([{ aggregate_id: aggregateID, seq: 0, owner_id: null }])
    }),
  )

  it.effect("rejects local commit hooks on live-only events", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const exit = yield* bus.publish(Message, { text: "hello" }, { commit: () => Effect.void }).pipe(Effect.exit)

      expect(String(exit)).toContain("Local commit hooks require a durable event")
    }),
  )

  it.effect("runs projectors before publishing to streams", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<string>()
      const fiber = yield* bus.subscribe().pipe(
        Stream.take(1),
        Stream.runForEach(() => Effect.sync(() => received.push("stream"))),
        Effect.forkScoped,
      )
      yield* bus.project(SyncMessage, (event) =>
        Effect.sync(() => {
          received.push(event.type)
        }),
      )

      yield* Effect.yieldNow
      yield* bus.publish(SyncMessage, { id: "one", text: "hello" })
      yield* Fiber.join(fiber)

      expect(received).toEqual([SyncMessage.type, "stream"])
    }),
  )

  it.effect("runs listeners inline after projectors", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<string>()
      yield* bus.project(SyncMessage, () =>
        Effect.sync(() => {
          received.push("projector")
        }),
      )
      const unsubscribe = yield* bus.listen(() =>
        Effect.sync(() => {
          received.push("listener")
        }),
      )

      yield* bus.publish(SyncMessage, { id: "one", text: "hello" })
      yield* unsubscribe
      yield* bus.publish(SyncMessage, { id: "one", text: "after unsubscribe" })

      expect(received).toEqual(["projector", "listener", "projector"])
    }),
  )

  it.effect("isolates observer defects after durable events commit", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<string>()
      yield* bus.listen(() => {
        throw new Error("listener defect")
      })
      yield* bus.listen((event) =>
        Effect.sync(() => {
          received.push(event.type)
        }),
      )

      const event = yield* bus.publish(SyncMessage, { id: "one", text: "hello" })

      expect(received).toEqual([SyncMessage.type])
      expect(event.durable?.seq).toBeNumber()
    }),
  )

  it.effect("notifies global listeners only after a durable event is committed", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Event.ID.create()
      const observed = new Array<{ id: string; seq: number }>()
      yield* bus.listen((event) =>
        event.type !== SyncMessage.type
          ? Effect.void
          : db
              .select({ id: EventTable.id, seq: EventTable.seq })
              .from(EventTable)
              .where(eq(EventTable.id, event.id))
              .get()
              .pipe(
                Effect.orDie,
                Effect.tap((row) =>
                  Effect.sync(() => {
                    if (row) observed.push(row)
                  }),
                ),
                Effect.asVoid,
              ),
      )

      const event = yield* bus.publish(SyncMessage, { id: aggregateID, text: "committed" })
      if (!event.durable) throw new Error("Expected durable event metadata")

      expect(observed).toEqual([{ id: event.id, seq: event.durable.seq }])
    }),
  )

  it.effect("preserves observer interruption", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      yield* bus.listen(() => Effect.interrupt)

      const exit = yield* bus.publish(SyncMessage, { id: "interrupted", text: "hello" }).pipe(Effect.exit)
      const committed = yield* db
        .select({ id: EventTable.id })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, "interrupted"))
        .get()
        .pipe(Effect.orDie)

      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBeTrue()
      expect(committed).toBeDefined()
    }),
  )

  it.effect("keeps live-only listener defects fail-fast", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const defect = new Error("listener defect")
      yield* bus.listen(() => Effect.die(defect))

      expect(yield* bus.publish(Message, { text: "hello" }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  it.effect("inserts durable event rows on publish", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Event.ID.create()

      yield* bus.publish(SyncMessage, { id: aggregateID, text: "first" })
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)

      expect(rows).toHaveLength(1)
      expect(rows[0]?.type).toBe(Bus.versionedType(SyncMessage.type, 1))
      expect(rows[0]?.aggregate_id).toBe(aggregateID)
    }),
  )

  it.effect("increments durable event seq per aggregate", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Event.ID.create()

      yield* bus.publish(SyncMessage, { id: aggregateID, text: "first" })
      yield* bus.publish(SyncMessage, { id: aggregateID, text: "second" })
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)

      expect(rows.map((row) => row.seq)).toEqual([0, 1])
    }),
  )

  it.effect("replays durable aggregate events after a sequence and tails new events", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      yield* bus.publish(DurableMessage, durableData(aggregateID, "zero"))
      yield* bus.publish(DurableMessage, durableData(aggregateID, "one"))
      const fiber = yield* tail(bus, { aggregateID, after: 0 }).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkScoped,
      )
      yield* Effect.yieldNow

      yield* bus.publish(DurableMessage, durableData(aggregateID, "two"))

      expect(Array.from(yield* Fiber.join(fiber)).map((event) => [event.durable?.seq, event.data])).toEqual([
        [1, durableData(aggregateID, "one")],
        [2, durableData(aggregateID, "two")],
      ])
    }),
  )

  it.effect("catches durable aggregate events published during replay handoff", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      yield* bus.publish(DurableMessage, durableData(aggregateID, "zero"))
      const fiber = yield* tail(bus, { aggregateID }).pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)

      yield* bus.publish(DurableMessage, durableData(aggregateID, "one"))

      expect(Array.from(yield* Fiber.join(fiber)).map((event) => [event.durable?.seq, event.data])).toEqual([
        [0, durableData(aggregateID, "zero")],
        [1, durableData(aggregateID, "one")],
      ])
    }),
  )

  it.effect("retains a durable wake committed while historical replay is paused", () =>
    Effect.gen(function* () {
      const readStarted = yield* Deferred.make<void>()
      const continueRead = yield* Deferred.make<void>()
      let pause = true
      const eventLayer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
        [
          Bus.node,
          Bus.configured({
            persist: true,
            beforeAggregateRead: () =>
              pause
                ? Deferred.succeed(readStarted, undefined).pipe(Effect.andThen(Deferred.await(continueRead)))
                : Effect.void,
          }),
        ],
      ])

      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        const aggregateID = Session.ID.create()
        const fiber = yield* tail(bus, { aggregateID }).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
        yield* Deferred.await(readStarted)

        pause = false
        yield* bus.publish(DurableMessage, durableData(aggregateID, "during handoff"))
        yield* Deferred.succeed(continueRead, undefined)

        expect(Array.from(yield* Fiber.join(fiber)).map((event) => [event.durable?.seq, event.data])).toEqual([
          [0, durableData(aggregateID, "during handoff")],
        ])
      }).pipe(Effect.provide(eventLayer))
    }),
  )

  it.effect("coalesces durable aggregate wakes while draining every committed event", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      const count = 64
      const fiber = yield* tail(bus, { aggregateID }).pipe(Stream.take(count), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      for (let index = 0; index < count; index++) {
        yield* bus.publish(DurableMessage, durableData(aggregateID, String(index)))
      }

      expect(Array.from(yield* Fiber.join(fiber)).map((event) => [event.durable?.seq, event.data])).toEqual(
        Array.from({ length: count }, (_, index) => [index, durableData(aggregateID, String(index))]),
      )
    }),
  )

  it.effect("omits live-only events from durable aggregate streams", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      const fiber = yield* tail(bus, { aggregateID }).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* bus.publish(Message, { text: "live only" })
      yield* bus.publish(DurableMessage, durableData(aggregateID, "durable"))

      expect(Array.from(yield* Fiber.join(fiber)).map((event) => event.type)).toEqual([DurableMessage.type])
    }),
  )

  it.effect("uses custom sync aggregate field", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Event.ID.create()

      yield* bus.publish(SyncSent, { messageID: aggregateID, text: "sent" })
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

  it.effect("replays durable events through projectors", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<Event.Payload>()
      yield* bus.project(DurableMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )
      const aggregateID = Session.ID.create()

      yield* bus.replay({
        id: Event.ID.create(),
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "hello"),
      })

      expect(received[0]?.type).toBe(DurableMessage.type)
      expect(received[0]?.data).toEqual(durableData(aggregateID, "hello"))
    }),
  )

  it.effect("replay inserts external event rows", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Session.ID.create()

      yield* bus.replay({
        id: Event.ID.create(),
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "replayed"),
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

  it.effect(
    "replay rejects an envelope aggregate that differs from its payload without mutating the payload aggregate",
    () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const { db } = yield* Database.Service
        const envelopeAggregateID = Session.ID.create()
        const payloadAggregateID = Session.ID.create()
        const received = new Array<Event.Payload>()
        yield* bus.publish(DurableMessage, durableData(payloadAggregateID, "seed"))
        yield* bus.project(DurableMessage, (event) =>
          Effect.sync(() => {
            received.push(event)
          }),
        )

        const exit = yield* bus
          .replay({
            id: Event.ID.create(),
            created: DateTime.makeUnsafe(0),
            type: Bus.versionedType(DurableMessage.type, 1),
            seq: 1,
            aggregateID: envelopeAggregateID,
            data: durableData(payloadAggregateID, "replayed"),
          })
          .pipe(Effect.exit)
        const rows = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, payloadAggregateID))
          .all()
          .pipe(Effect.orDie)
        const sequence = yield* db
          .select({ seq: EventSequenceTable.seq })
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, payloadAggregateID))
          .get()
          .pipe(Effect.orDie)

        expect(String(exit)).toContain("Aggregate mismatch")
        expect(received).toHaveLength(0)
        expect(rows).toHaveLength(1)
        expect(sequence).toEqual({ seq: 0 })
      }),
  )

  it.effect("replay defects on sequence mismatch", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()

      yield* bus.replay({
        id: Event.ID.create(),
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "first"),
      })
      const exit = yield* bus
        .replay({
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 5,
          aggregateID,
          data: durableData(aggregateID, "bad"),
        })
        .pipe(Effect.exit)

      expect(String(exit)).toContain("Sequence mismatch")
    }),
  )

  it.effect("replay decodes synchronized transformed values before projection", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      const received = new Array<typeof SessionEvent.InstructionsUpdated.Type>()
      yield* bus.project(SessionEvent.InstructionsUpdated, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      yield* bus.replay({
        id: Event.ID.create(),
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(SessionEvent.InstructionsUpdated.type, 2),
        seq: 0,
        aggregateID,
        data: { sessionID: aggregateID, delta: { "core/context": "0".repeat(64) } },
      })

      expect(received[0]?.created).toEqual(DateTime.makeUnsafe(0))
    }),
  )

  it.effect("dispatches durable projectors by exact event version", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      const received = new Array<typeof VersionedMessageV2.Type>()
      yield* bus.project(VersionedMessageV2, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      yield* bus.publish(VersionedMessageV1, { id: aggregateID })
      yield* bus.publish(VersionedMessageV2, { id: aggregateID })

      expect(received).toHaveLength(1)
      expect(received[0]?.durable.version).toBe(Event.Version.make(2))
    }),
  )

  it.effect("replay defects on unknown event type", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const exit = yield* bus
        .replay({
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: "unknown.event.1",
          seq: 0,
          aggregateID: Event.ID.create(),
          data: {},
        })
        .pipe(Effect.exit)

      expect(String(exit)).toContain("Unknown durable event type")
    }),
  )

  it.effect("replayAll validates contiguous aggregate events", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      const source = yield* bus.replayAll([
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 0,
          aggregateID,
          data: durableData(aggregateID, "one"),
        },
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 1,
          aggregateID,
          data: durableData(aggregateID, "two"),
        },
      ])

      expect(source).toBe(aggregateID)
    }),
  )

  it.effect("replayAll accepts later chunks after the first batch", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Session.ID.create()

      const one = yield* bus.replayAll([
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 0,
          aggregateID,
          data: durableData(aggregateID, "one"),
        },
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 1,
          aggregateID,
          data: durableData(aggregateID, "two"),
        },
      ])
      const two = yield* bus.replayAll([
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 2,
          aggregateID,
          data: durableData(aggregateID, "three"),
        },
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 3,
          aggregateID,
          data: durableData(aggregateID, "four"),
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
      const bus = yield* Bus.Service
      const received = new Array<Event.Payload>()
      const aggregateID = Session.ID.create()
      yield* bus.publish(DurableMessage, durableData(aggregateID, "seed"))
      yield* bus.claim(aggregateID, "owner-a")
      yield* bus.project(DurableMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      yield* bus.replay(
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 1,
          aggregateID,
          data: durableData(aggregateID, "ignored"),
        },
        { ownerID: "owner-b" },
      )

      expect(received).toHaveLength(0)
    }),
  )

  it.effect("strict owner fences exact replay", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      const id = Event.ID.create()
      const replayed = {
        id,
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "owned"),
      }
      yield* bus.replay(replayed, { ownerID: "owner-a" })

      const exit = yield* bus.replay(replayed, { ownerID: "owner-b", strictOwner: true }).pipe(Effect.exit)

      expect(String(exit)).toContain("Replay owner mismatch")
    }),
  )

  it.effect("exact replay claims an unowned aggregate", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Session.ID.create()
      const published = yield* bus.publish(DurableMessage, durableData(aggregateID, "owned"))
      const replayed = {
        id: published.id,
        created: published.created,
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: published.durable!.seq,
        aggregateID,
        data: published.data,
      }

      yield* bus.replay(replayed, { ownerID: "owner-a", strictOwner: true })
      const row = yield* db
        .select({ ownerID: EventSequenceTable.owner_id })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, aggregateID))
        .get()
        .pipe(Effect.orDie)

      expect(row?.ownerID).toBe("owner-a")
      const exit = yield* bus
        .replay(
          { ...replayed, id: Event.ID.create(), seq: 1, data: durableData(aggregateID, "conflict") },
          { ownerID: "owner-b", strictOwner: true },
        )
        .pipe(Effect.exit)
      expect(String(exit)).toContain("Replay owner mismatch")
    }),
  )

  it.effect("replay with owner claims an unowned sequence", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Session.ID.create()

      yield* bus.replay(
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 0,
          aggregateID,
          data: durableData(aggregateID, "owned"),
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

  it.effect("replay claims an existing unowned sequence before fencing a different owner", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Session.ID.create()
      yield* bus.publish(DurableMessage, durableData(aggregateID, "local"))

      yield* bus.replay(
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 1,
          aggregateID,
          data: durableData(aggregateID, "claimed"),
        },
        { ownerID: "owner-1" },
      )
      yield* bus.replay(
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 2,
          aggregateID,
          data: durableData(aggregateID, "fenced"),
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

      expect(rows.map((row) => row.seq)).toEqual([0, 1])
      expect(sequence).toEqual({ seq: 1, ownerID: "owner-1" })
    }),
  )

  it.effect("strict replay rejects an owner conflict instead of silently skipping it", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      yield* bus.replay(
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 0,
          aggregateID,
          data: durableData(aggregateID, "claimed"),
        },
        { ownerID: "owner-1" },
      )

      const exit = yield* bus
        .replay(
          {
            id: Event.ID.create(),
            created: DateTime.makeUnsafe(0),
            type: Bus.versionedType(DurableMessage.type, 1),
            seq: 1,
            aggregateID,
            data: durableData(aggregateID, "conflict"),
          },
          { ownerID: "owner-2", strictOwner: true },
        )
        .pipe(Effect.exit)

      expect(String(exit)).toContain("Replay owner mismatch")
    }),
  )

  it.effect("publishes accepted replay with its durable sequence and suppresses stale replay", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<Event.Payload>()
      const aggregateID = Session.ID.create()
      yield* bus.listen((event) => Effect.sync(() => received.push(event)))
      const replayed = {
        id: Event.ID.create(),
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "replayed"),
      }

      yield* bus.replay(replayed, { publish: true })
      yield* bus.replay(replayed, { publish: true })

      expect(received).toMatchObject([{ id: replayed.id, durable: { seq: 0, version: 1 }, data: replayed.data }])
    }),
  )

  it.effect("rejects divergent stale replay without publishing it", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<Event.Payload>()
      const aggregateID = Session.ID.create()
      const replayed = {
        id: Event.ID.create(),
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "original"),
      }
      yield* bus.listen((event) => Effect.sync(() => received.push(event)))
      yield* bus.replay(replayed, { publish: true })

      const exit = yield* bus
        .replay({ ...replayed, data: durableData(aggregateID, "divergent") }, { publish: true })
        .pipe(Effect.exit)

      expect(String(exit)).toContain("Replay diverged")
      expect(received).toHaveLength(1)
    }),
  )

  it.effect("rejects an event ID reused at another aggregate position", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      const id = Event.ID.create()
      yield* bus.replay({
        id,
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "first"),
      })

      const exit = yield* bus
        .replay({
          id,
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 1,
          aggregateID,
          data: durableData(aggregateID, "second"),
        })
        .pipe(Effect.exit)

      expect(String(exit)).toContain(`Event ${id} already exists`)
    }),
  )

  it.effect("replay from a different owner leaves claimed sequence unchanged", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Session.ID.create()
      const received = new Array<Event.Payload>()
      yield* bus.listen((event) => Effect.sync(() => received.push(event)))

      yield* bus.replay(
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 0,
          aggregateID,
          data: durableData(aggregateID, "first"),
        },
        { ownerID: "owner-1" },
      )
      yield* bus.replay(
        {
          id: Event.ID.create(),
          created: DateTime.makeUnsafe(0),
          type: Bus.versionedType(DurableMessage.type, 1),
          seq: 1,
          aggregateID,
          data: durableData(aggregateID, "ignored"),
        },
        { ownerID: "owner-2", publish: true },
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
      expect(received).toHaveLength(0)
    }),
  )

  it.effect("claim updates the event sequence owner", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const aggregateID = Event.ID.create()

      yield* bus.publish(SyncMessage, { id: aggregateID, text: "claimed" })
      yield* bus.claim(aggregateID, "owner-1")
      yield* bus.claim(aggregateID, "owner-2")
      const row = yield* db
        .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, aggregateID))
        .get()
        .pipe(Effect.orDie)

      expect(row).toEqual({ seq: 0, ownerID: "owner-2" })
    }),
  )

  it.effect("remove clears durable event sequence", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received = new Array<Event.Payload>()
      const aggregateID = Session.ID.create()
      yield* bus.publish(DurableMessage, durableData(aggregateID, "seed"))
      yield* bus.remove(aggregateID)
      yield* bus.project(DurableMessage, (event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      yield* bus.replay({
        id: Event.ID.create(),
        created: DateTime.makeUnsafe(0),
        type: Bus.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "replayed"),
      })

      expect(received[0]?.data).toEqual(durableData(aggregateID, "replayed"))
    }),
  )

  it.effect("log without follow replays events and completes with a synced marker", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      yield* bus.publish(DurableMessage, durableData(aggregateID, "zero"))
      yield* bus.publish(DurableMessage, durableData(aggregateID, "one"))

      const items = Array.from(yield* Stream.runCollect(bus.log({ aggregateID })))

      expect(items.map((item) => (Bus.isSynced(item) ? item.type : item.durable?.seq))).toEqual([
        Event.Seq.make(0),
        Event.Seq.make(1),
        "log.synced",
      ])
      expect(items.at(-1)).toEqual({ type: "log.synced", aggregateID, seq: Event.Seq.make(1) })
    }),
  )

  it.effect("log synced marker omits seq for an empty log and keeps the cursor otherwise", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()

      const empty = Array.from(yield* Stream.runCollect(bus.log({ aggregateID })))
      yield* bus.publish(DurableMessage, durableData(aggregateID, "zero"))
      const drained = Array.from(yield* Stream.runCollect(bus.log({ aggregateID, after: 0 })))

      expect(empty).toEqual([{ type: "log.synced", aggregateID }])
      expect(empty[0]).not.toHaveProperty("seq")
      expect(drained).toEqual([{ type: "log.synced", aggregateID, seq: Event.Seq.make(0) }])
    }),
  )

  it.effect("log with follow emits the synced marker at the replay-to-live boundary", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const aggregateID = Session.ID.create()
      yield* bus.publish(DurableMessage, durableData(aggregateID, "zero"))
      const fiber = yield* bus
        .log({ aggregateID, follow: true })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* bus.publish(DurableMessage, durableData(aggregateID, "one"))

      const items = Array.from(yield* Fiber.join(fiber))
      expect(items.map((item) => (Bus.isSynced(item) ? item : item.durable?.seq))).toEqual([
        Event.Seq.make(0),
        { type: "log.synced", aggregateID, seq: Event.Seq.make(0) },
        Event.Seq.make(1),
      ])
    }),
  )

  it.effect("log replays across configured read pages", () =>
    Effect.gen(function* () {
      const eventLayer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
        [Bus.node, Bus.configured({ persist: true, logReadPageSize: 2 })],
      ])

      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        const aggregateID = Session.ID.create()
        yield* bus.publish(DurableMessage, durableData(aggregateID, "zero"))
        yield* bus.publish(DurableMessage, durableData(aggregateID, "one"))
        yield* bus.publish(DurableMessage, durableData(aggregateID, "two"))
        yield* bus.publish(DurableMessage, durableData(aggregateID, "three"))
        yield* bus.publish(DurableMessage, durableData(aggregateID, "four"))

        const items = Array.from(yield* Stream.runCollect(bus.log({ aggregateID })))

        expect(items.map((item) => (Bus.isSynced(item) ? item.type : item.durable?.seq))).toEqual([
          Event.Seq.make(0),
          Event.Seq.make(1),
          Event.Seq.make(2),
          Event.Seq.make(3),
          Event.Seq.make(4),
          "log.synced",
        ])
        expect(items.at(-1)).toEqual({ type: "log.synced", aggregateID, seq: Event.Seq.make(4) })
      }).pipe(Effect.provide(eventLayer))
    }),
  )

  it.effect("log with follow emits events committed during replay after the synced marker", () =>
    Effect.gen(function* () {
      const readStarted = yield* Deferred.make<void>()
      const releaseRead = yield* Deferred.make<void>()
      const firstRead = yield* Ref.make(true)
      const eventLayer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
        [
          Bus.node,
          Bus.configured({
            persist: true,
            beforeAggregateRead: () =>
              Ref.getAndSet(firstRead, false).pipe(
                Effect.flatMap((shouldBlock) => {
                  if (!shouldBlock) return Effect.void
                  return Deferred.succeed(readStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseRead)))
                }),
              ),
          }),
        ],
      ])

      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        const aggregateID = Session.ID.create()
        yield* bus.publish(DurableMessage, durableData(aggregateID, "zero"))
        const fiber = yield* bus
          .log({ aggregateID, follow: true })
          .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)

        yield* Deferred.await(readStarted)
        yield* bus.publish(DurableMessage, durableData(aggregateID, "one"))
        yield* Deferred.succeed(releaseRead, undefined)

        const items = Array.from(yield* Fiber.join(fiber))
        expect(items.map((item) => (Bus.isSynced(item) ? item : item.durable?.seq))).toEqual([
          Event.Seq.make(0),
          { type: "log.synced", aggregateID, seq: Event.Seq.make(0) },
          Event.Seq.make(1),
        ])
      }).pipe(Effect.provide(eventLayer))
    }),
  )

})
