import { describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventExact } from "@opencode-ai/core/event-exact"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Exit, Fiber, Layer, Ref, Schema, Stream } from "effect"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosureRecord } from "@/session/closure/record"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { itBounded as it } from "../lib/effect"

const ExactMessage = EventV2.define({
  type: "test.closure.exact-handoff",
  durable: { version: 1, aggregate: "aggregateID" },
  schema: { aggregateID: Schema.String, text: Schema.String },
})

const authority = (kind: "message" | "part" = "message"): EventExact.Authority => ({
  instance: "instance",
  operation: "operation",
  repair: "repair",
  operationRevision: 1n,
  freezeOwner: "operation",
  generation: 1,
  fact: "fact",
  pair: "pair",
  kind,
})

const pair = (): Model.FrozenPair => {
  const identity: Model.Identity = {
    source: "session_identity",
    agent: "build",
    model: { providerID: "provider", modelID: "model", variant: { present: false } },
  }
  const fact: Model.FactView = {
    type: "edge",
    id: Model.id("fact", "fact_interrupted"),
    key: "edge:interrupted",
    subject: Model.id("session", "ses_interrupted_child"),
    owner: Model.id("session", "ses_interrupted_owner"),
    child: Model.id("session", "ses_interrupted_child"),
    outcome: "completed",
    yielded: false,
  }
  const value = {
    fact,
    freezeOwner: Model.id("operation", "op_interrupted"),
    generation: 1,
    identity,
    message: Model.id("message", "msg_interrupted"),
    part: Model.id("part", "prt_interrupted"),
    messageEvent: Model.id("event", "evt_interrupted_message"),
    partEvent: Model.id("event", "evt_interrupted_part"),
    messageTime: 100,
    partTime: 101,
    synthetic: true as const,
    text: "[Branch closure] interrupted",
    metadata: {
      version: 1 as const,
      freeze_owner_operation_id: Model.id("operation", "op_interrupted"),
      generation: 1,
      fact_key: "edge:interrupted",
      identity_source: "session_identity" as const,
      record_kind: "edge" as const,
      subject_session_id: Model.id("session", "ses_interrupted_child"),
      owner_session_id: Model.id("session", "ses_interrupted_owner"),
      child_session_id: Model.id("session", "ses_interrupted_child"),
      terminal_outcome: "completed" as const,
    },
  }
  return {
    ...value,
    messageBytes: JSON.stringify({
      id: value.message,
      event: value.messageEvent,
      time: value.messageTime,
      synthetic: true,
      identity,
    }),
    partBytes: JSON.stringify({
      id: value.part,
      event: value.partEvent,
      time: value.partTime,
      synthetic: true,
      text: value.text,
      metadata: value.metadata,
    }),
  }
}

const command = {
  type: "pair.write" as const,
  instance: Model.id("instance", "instance_interrupted"),
  permit: Model.id("pair", "pair_interrupted"),
  candidate: {
    type: "pair.candidate" as const,
    instance: Model.id("instance", "instance_interrupted"),
    operation: Model.id("operation", "op_interrupted"),
    repair: Model.id("repair", "repair_interrupted"),
    revision: 7n,
    freezeOwner: Model.id("operation", "op_interrupted"),
    generation: 1,
    fact: Model.id("fact", "fact_interrupted"),
    expectedPrefix: 0,
  },
}

describe("closure record interruption and exact notification handoff", () => {
  it.live("K16/K58/K103: interruption detaches only the first waiter and exact retry joins one owned attempt", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const initialRead = yield* Deferred.make<void>()
      const wakeRead = yield* Deferred.make<void>()
      const reads = yield* Ref.make(0)
      const wakes = yield* Ref.make(0)
      const handoffs = yield* Ref.make(0)
      const events = EventV2.layerWith({
            beforeAggregateRead: () =>
              Ref.getAndUpdate(reads, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 0
                    ? Deferred.succeed(initialRead, undefined)
                    : count === 1
                      ? Deferred.succeed(wakeRead, undefined)
                      : Effect.void,
                ),
                Effect.asVoid,
              ),
            beforeDurableWake: () => Ref.update(wakes, (count) => count + 1),
            beforeExactNotification: () =>
              Ref.update(handoffs, (count) => count + 1).pipe(
                Effect.andThen(Deferred.succeed(entered, undefined)),
                Effect.andThen(Deferred.await(release)),
              ),
          }).pipe(Layer.provideMerge(LayerNode.compile(Database.node)))
      const layer = LayerNode.compile(LayerNode.group([EventV2Bridge.node, EventV2.node, Database.node]), [
        [EventV2.node, events],
      ])

      yield* Effect.gen(function* () {
        const events = yield* EventV2.Service
        const exact = yield* EventExact.Service
        const { db } = yield* Database.Service
        const eventID = EventV2.ID.make("evt_exact_handoff")
        const aggregateID = "aggregate_exact_handoff"
        const projected = new Array<number>()
        const committed = new Array<number>()
        const listened = new Array<string>()
        const typedSeen = new Array<string>()
        const allSeen = new Array<string>()
        const bus = new Array<GlobalEvent>()
        const onBus = (event: GlobalEvent) => {
          if (event.payload?.id === eventID || event.payload?.syncEvent?.id === eventID) bus.push(event)
        }
        GlobalBus.on("event", onBus)
        yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", onBus)))
        yield* events.listen((event) =>
          Effect.sync(() => {
            if (event.id === eventID) listened.push(event.id)
          }),
        )

        const typed = yield* events.subscribe(ExactMessage).pipe(
          Stream.tap((event) => Effect.sync(() => typedSeen.push(event.id))),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        const all = yield* events.all().pipe(
          Stream.tap((event) => Effect.sync(() => allSeen.push(event.id))),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        const durable = yield* events.durable({ aggregateID }).pipe(Stream.runDrain, Effect.forkScoped)
        yield* Deferred.await(initialRead)
        yield* Effect.yieldNow

        const token = yield* exact.issue({
          definition: ExactMessage,
          data: { aggregateID, text: "frozen" },
          id: eventID,
          authority: authority(),
          expectedRow: { text: "frozen" },
          projector: (event) => Effect.sync(() => projected.push(event.durable!.seq)),
          commit: (seq) => Effect.sync(() => committed.push(seq)),
        })
        const publisher = yield* exact.publish(token).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        yield* Deferred.await(wakeRead)

        // Positive producer: the first commit has already performed every transaction/wake effect.
        expect(projected).toEqual([0])
        expect(committed).toEqual([0])
        expect(yield* Ref.get(reads)).toBe(2)
        expect(yield* Ref.get(wakes)).toBe(1)
        expect(
          yield* db.select().from(EventTable).where(eq(EventTable.id, eventID)).get().pipe(Effect.orDie),
        ).toMatchObject({ aggregate_id: aggregateID, seq: 0, data: { aggregateID, text: "frozen" } })
        expect(
          yield* db
            .select()
            .from(EventSequenceTable)
            .where(eq(EventSequenceTable.aggregate_id, aggregateID))
            .get()
            .pipe(Effect.orDie),
        ).toMatchObject({ aggregate_id: aggregateID, seq: 0 })

        // The owned task is registered but paused before ordinary/typed/all/Bridge notification.
        expect(listened).toEqual([])
        expect(bus).toEqual([])
        expect(typedSeen).toEqual([])
        expect(allSeen).toEqual([])

        yield* Fiber.interrupt(publisher)
        const interrupted = yield* Fiber.await(publisher)
        expect(Exit.isFailure(interrupted)).toBe(true)
        const retryFiber = yield* exact.publish(token).pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        yield* Deferred.succeed(release, undefined)
        const retry = yield* Fiber.join(retryFiber)
        expect(retry.status).toBe("existing_exact")
        expect(retry.coordinate).toEqual({ aggregateID, seq: 0 })

        const typedEvents = Array.from(yield* Fiber.join(typed))
        const allEvents = Array.from(yield* Fiber.join(all))
        expect(typedEvents.map((event) => event.id)).toEqual([eventID])
        expect(allEvents.map((event) => event.id)).toEqual([eventID])
        expect(typedSeen).toEqual([eventID])
        expect(allSeen).toEqual([eventID])
        expect(listened).toEqual([eventID])
        expect(bus).toHaveLength(2)
        expect(bus.map((event) => event.payload.type)).toEqual([ExactMessage.type, "sync"])
        expect(bus[1]?.payload.syncEvent).toMatchObject({ id: eventID, aggregateID, seq: 0 })

        // Exact retry had live producers available for every effect above, but replayed none.
        expect(projected).toEqual([0])
        expect(committed).toEqual([0])
        expect(yield* Ref.get(reads)).toBe(2)
        expect(yield* Ref.get(wakes)).toBe(1)
        expect(yield* Ref.get(handoffs)).toBe(1)
        expect(yield* db.select().from(EventTable).all().pipe(Effect.orDie)).toHaveLength(1)
        expect(
          yield* db
            .select()
            .from(EventSequenceTable)
            .where(eq(EventSequenceTable.aggregate_id, aggregateID))
            .get()
            .pipe(Effect.orDie),
        ).toMatchObject({ aggregate_id: aggregateID, seq: 0 })
        yield* Fiber.interrupt(durable)
      }).pipe(Effect.provide(Layer.fresh(layer)))
    }),
  )

  it.live("K20: interrupted Message-only writer repairs the frozen pair without a second Message", () =>
    Effect.gen(function* () {
      const frozen = pair()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const messageNotified = yield* Deferred.make<void>()
      const handoffs = yield* Ref.make(0)
      const base = EventV2.layerWith({
        beforeExactNotification: (event) =>
          String(event.id) !== String(frozen.messageEvent)
            ? Effect.void
            : Ref.update(handoffs, (count) => count + 1).pipe(
                Effect.andThen(Deferred.succeed(entered, undefined)),
                Effect.andThen(Deferred.await(release)),
              ),
      }).pipe(Layer.provideMerge(LayerNode.compile(Database.node)))
      const coreLayer = LayerNode.compile(
        LayerNode.group([SessionProjector.node, EventV2.node, Database.node]),
        [[EventV2.node, base]],
      )

      yield* Effect.gen(function* () {
        if (frozen.fact.type !== "edge") return yield* Effect.die("expected the interrupted edge fixture")
        const owner = String(frozen.fact.owner)
        const child = String(frozen.fact.child)
        const { db } = yield* Database.Service
        const events = yield* EventV2.Service
        const core = yield* SessionProjector.ClosureRecordService
        const statuses = new Array<{
          readonly kind: "message" | "part"
          readonly status: string
          readonly seq: number
        }>()
        const observed = SessionProjector.ClosureRecordService.of({
          message: (input) =>
            core
              .message(input)
              .pipe(
                Effect.tap((result) =>
                  Effect.sync(() =>
                    statuses.push({ kind: "message", status: result.status, seq: result.coordinate.seq }),
                  ),
                ),
              ),
          part: (input) =>
            core
              .part(input)
              .pipe(
                Effect.tap((result) =>
                  Effect.sync(() => statuses.push({ kind: "part", status: result.status, seq: result.coordinate.seq })),
                ),
              ),
          verify: core.verify,
        })
        const writer = yield* Effect.gen(function* () {
          return yield* SessionClosureRecord.Service
        }).pipe(
          Effect.provide(
            SessionClosureRecord.layer.pipe(
              Layer.provide(Layer.succeed(SessionProjector.ClosureRecordService, observed)),
            ),
          ),
        )
        const notifications = new Array<string>()
        yield* events.listen((event) => {
          if (String(event.id) !== String(frozen.messageEvent) && String(event.id) !== String(frozen.partEvent))
            return Effect.void
          return Effect.sync(() => notifications.push(event.id)).pipe(
            Effect.andThen(
              String(event.id) === String(frozen.messageEvent)
                ? Deferred.succeed(messageNotified, undefined)
                : Effect.void,
            ),
          )
        })

        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: AbsolutePath.make("/closure-f2"), sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        for (const id of [owner, child]) {
          yield* db
            .insert(SessionTable)
            .values({
              id: SessionID.make(id),
              project_id: Project.ID.global,
              slug: id,
              directory: "/closure-f2",
              title: id,
              version: "test",
              time_created: 10,
              time_updated: 20,
            })
            .run()
            .pipe(Effect.orDie)
        }

        const original = yield* writer.write({ command, record: frozen }).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        expect(statuses).toEqual([])
        expect(
          yield* db
            .select()
            .from(MessageTable)
            .where(eq(MessageTable.id, MessageID.make(String(frozen.message))))
            .get()
            .pipe(Effect.orDie),
        ).toMatchObject({
          session_id: owner,
          time_created: frozen.messageTime,
          time_updated: frozen.messageTime,
          data: { role: "user", agent: frozen.identity.agent },
        })
        expect(
          yield* db
            .select()
            .from(PartTable)
            .where(eq(PartTable.id, PartID.make(String(frozen.part))))
            .get()
            .pipe(Effect.orDie),
        ).toBeUndefined()

        yield* Fiber.interrupt(original)
        const interrupted = yield* Fiber.await(original)
        expect(Exit.isFailure(interrupted)).toBe(true)
        yield* Deferred.succeed(release, undefined)
        yield* Deferred.await(messageNotified)
        expect(statuses).toEqual([])

        expect(yield* writer.write({ command, record: frozen })).toEqual({ message: "verified", part: "verified" })
        expect(statuses).toEqual([
          { kind: "message", status: "existing_exact", seq: 0 },
          { kind: "part", status: "committed_new", seq: 1 },
        ])
        expect(notifications).toEqual([String(frozen.messageEvent), String(frozen.partEvent)])
        expect(yield* Ref.get(handoffs)).toBe(1)

        const messages = yield* db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, MessageID.make(String(frozen.message))))
          .all()
          .pipe(Effect.orDie)
        const parts = yield* db
          .select()
          .from(PartTable)
          .where(eq(PartTable.id, PartID.make(String(frozen.part))))
          .all()
          .pipe(Effect.orDie)
        expect(messages).toHaveLength(1)
        expect(parts).toHaveLength(1)
        expect(messages[0]).toMatchObject({
          session_id: owner,
          time_created: frozen.messageTime,
          time_updated: frozen.messageTime,
          data: {
            role: "user",
            agent: frozen.identity.agent,
            model: { providerID: frozen.identity.model.providerID, modelID: frozen.identity.model.modelID },
          },
        })
        expect(parts[0]).toMatchObject({
          message_id: String(frozen.message),
          session_id: owner,
          time_created: frozen.partTime,
          time_updated: frozen.partTime,
          data: { text: frozen.text, metadata: { [CLOSURE_RECORD_METADATA_KEY]: frozen.metadata } },
        })
        expect(
          yield* db
            .select()
            .from(EventSequenceTable)
            .where(eq(EventSequenceTable.aggregate_id, owner))
            .get()
            .pipe(Effect.orDie),
        ).toMatchObject({ seq: 1 })
        expect(
          yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, owner)).all().pipe(Effect.orDie),
        ).toHaveLength(2)
      }).pipe(Effect.provide(Layer.fresh(coreLayer)))
    }),
  )
})
