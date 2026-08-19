import { describe, expect } from "bun:test"
import { Effect, Fiber, Schema, Stream } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { and, eq } from "drizzle-orm"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { testEffect } from "./lib/effect"
import { globalProjectLayer } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [Project.node, globalProjectLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
// Default bus: durable payloads are not retained (`events.persist` off).
const itVolatile = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Project.node, globalProjectLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Session.log", () => {
  it.effect("replays public session events and marks synced at the aggregate watermark", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      yield* session.rename({ sessionID: created.id, title: "session.renamed" })

      const items = Array.from(yield* Stream.runCollect(session.log({ sessionID: created.id })))

      expect(items.map((item) => item.type)).toEqual(["session.created", "session.renamed", "log.synced"])
      expect(items.at(-1)).toEqual({ type: "log.synced", aggregateID: created.id, seq: Event.Seq.make(1) })
    }),
  )

  it.effect("continues with live public events when following", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      const fiber = yield* session
        .log({ sessionID: created.id, after: Event.Seq.make(0), follow: true })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.rename({ sessionID: created.id, title: "renamed live" })

      const items = Array.from(yield* Fiber.join(fiber))
      expect(items.map((item) => item.type)).toEqual(["log.synced", "session.renamed"])
    }),
  )

  it.effect("accepts a cursor exactly at the aggregate head", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })

      const items = Array.from(
        yield* Stream.runCollect(session.log({ sessionID: created.id, after: Event.Seq.make(0) })),
      )

      expect(items).toEqual([{ type: "log.synced", aggregateID: created.id, seq: Event.Seq.make(0) }])
    }),
  )

  it.effect("fails with SeqUnavailable when the cursor is beyond the aggregate head", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })

      const errors = yield* Effect.forEach([1, 10], (after) =>
        Effect.flip(Stream.runCollect(session.log({ sessionID: created.id, after: Event.Seq.make(after) }))),
      )

      expect(errors.map((error) => error._tag)).toEqual([
        "Session.SeqUnavailableError",
        "Session.SeqUnavailableError",
      ])
      expect(errors.map((error) => (error._tag === "Session.SeqUnavailableError" ? error.after : undefined))).toEqual([
        Event.Seq.make(1),
        Event.Seq.make(10),
      ])
      expect(errors.map((error) => (error._tag === "Session.SeqUnavailableError" ? error.head : undefined))).toEqual([
        Event.Seq.make(0),
        Event.Seq.make(0),
      ])
    }),
  )

  it.effect("fails with NotFound for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const error = yield* Effect.flip(Stream.runCollect(session.log({ sessionID: Session.ID.create() })))
      expect(error._tag).toBe("Session.NotFoundError")
    }),
  )

  it.effect("orders live ephemeral deltas after their durable start", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const assistantMessageID = SessionMessage.ID.create()
      const fiber = yield* session
        .log({ sessionID: created.id, after: Event.Seq.make(0), follow: true, ephemeral: true })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* bus.publish(SessionEvent.Text.Started, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
      })
      yield* bus.publish(SessionEvent.Text.Delta, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
        delta: "hello",
      })

      expect(Array.from(yield* Fiber.join(fiber)).map((item) => item.type)).toEqual([
        "log.synced",
        "session.text.started",
        "session.text.delta",
      ])
    }),
  )

  it.effect("never includes ephemeral events in replay", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const assistantMessageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Text.Started, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
      })
      yield* bus.publish(SessionEvent.Text.Delta, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
        delta: "not retained",
      })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
        text: "complete",
      })

      const items = Array.from(yield* Stream.runCollect(session.log({ sessionID: created.id, ephemeral: true })))

      expect(items.map((item) => item.type)).toEqual([
        "session.created",
        "session.text.started",
        "session.text.ended",
        "log.synced",
      ])
    }),
  )

  it.effect("keeps the default follow stream durable-only", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const assistantMessageID = SessionMessage.ID.create()
      const fiber = yield* session
        .log({ sessionID: created.id, after: Event.Seq.make(0), follow: true })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* bus.publish(SessionEvent.Text.Started, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
      })
      yield* bus.publish(SessionEvent.Text.Delta, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
        delta: "filtered",
      })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID: created.id,
        assistantMessageID,
        ordinal: 0,
        text: "complete",
      })

      expect(Array.from(yield* Fiber.join(fiber)).map((item) => item.type)).toEqual([
        "log.synced",
        "session.text.started",
        "session.text.ended",
      ])
    }),
  )

  it.effect("reads across undecodable gaps in aggregate order and marks the true log position", () =>
    Effect.gen(function* () {
      const GapEvent = Bus.durable({
        type: "test.session.log.gap",
        durable: { aggregate: "sessionID", version: 1 },
        schema: { sessionID: Session.ID, value: Schema.String },
      })
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      yield* session.switchAgent({ sessionID: created.id, agent: Agent.ID.make("one") })
      // Not in the durable manifest, so reads must skip it without failing.
      yield* bus.publish(GapEvent, { sessionID: created.id, value: "filtered" })
      yield* session.switchAgent({ sessionID: created.id, agent: Agent.ID.make("two") })
      yield* session.switchAgent({ sessionID: created.id, agent: Agent.ID.make("three") })

      const items = Array.from(yield* Stream.runCollect(session.log({ sessionID: created.id, after: 1 })))

      expect(
        items.map((item): number | string | undefined =>
          Bus.isSynced(item) ? item.type : "durable" in item ? item.durable.seq : undefined,
        ),
      ).toEqual([3, 4, "log.synced"])
      expect(items.at(-1)).toEqual({ type: "log.synced", aggregateID: created.id, seq: Event.Seq.make(4) })
    }),
  )

  it.effect("fails with SeqUnavailable when the replay range is only partially retained", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      yield* session.rename({ sessionID: created.id, title: "pruned" })
      yield* db
        .delete(EventTable)
        .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.seq, 1)))
        .run()

      const error = yield* Effect.flip(
        Stream.runCollect(session.log({ sessionID: created.id, after: Event.Seq.make(0) })),
      )

      expect(error._tag).toBe("Session.SeqUnavailableError")
    }),
  )

  it.effect("completes with a bare synced marker for a migrated Session with no event sequence", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_empty_log")
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "empty-log",
          directory: "/project",
          title: "Empty log",
          version: "test",
        })
        .run()

      const items = Array.from(yield* Stream.runCollect(session.log({ sessionID })))

      expect(items).toEqual([{ type: "log.synced", aggregateID: sessionID }])
    }),
  )
})

describe("Session.log without retained events", () => {
  itVolatile.effect("accepts a cursor exactly at the head", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      yield* session.rename({ sessionID: created.id, title: "at head" })

      const items = Array.from(
        yield* Stream.runCollect(session.log({ sessionID: created.id, after: Event.Seq.make(1) })),
      )

      expect(items).toEqual([{ type: "log.synced", aggregateID: created.id, seq: Event.Seq.make(1) }])
    }),
  )

  itVolatile.effect("fails with SeqUnavailable for a cursor behind the head", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      yield* session.rename({ sessionID: created.id, title: "behind head" })

      const error = yield* Effect.flip(
        Stream.runCollect(session.log({ sessionID: created.id, after: Event.Seq.make(0) })),
      )

      expect(error._tag).toBe("Session.SeqUnavailableError")
      expect(error._tag === "Session.SeqUnavailableError" ? error.head : undefined).toEqual(Event.Seq.make(1))
    }),
  )

  itVolatile.effect("replays nothing but stays live for a cursorless read", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      yield* session.rename({ sessionID: created.id, title: "cursorless" })

      const items = Array.from(yield* Stream.runCollect(session.log({ sessionID: created.id })))

      expect(items).toEqual([{ type: "log.synced", aggregateID: created.id, seq: Event.Seq.make(1) }])
    }),
  )
})
