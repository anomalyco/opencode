import { describe, expect } from "bun:test"
import path from "path"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { DateTime, Effect, Layer } from "effect"
import { asc, eq } from "drizzle-orm"
import { tmpdirScoped } from "./fixture/tmpdir"
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
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Session.view", () => {
  it.effect("copies the latest idle time without changing session recency", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(created.time.idle).toBeUndefined()
      expect(created.time.viewed).toBeUndefined()
      expect(created.outcome).toBeUndefined()

      yield* session.view({ sessionID: created.id, idle: 0 })
      expect((yield* session.get(created.id)).time.viewed).toBeUndefined()

      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: created.id })
      const idle = yield* session.get(created.id)
      expect(idle.time.idle).toBeDefined()
      expect(idle.time.viewed).toBeUndefined()
      expect(idle.time.updated).toEqual(created.time.updated)
      expect(idle.outcome).toBe("succeeded")

      if (!idle.time.idle) return yield* Effect.die(new Error("Expected idle time"))
      yield* session.view({ sessionID: created.id, idle: DateTime.toEpochMillis(idle.time.idle) })
      const viewed = yield* session.get(created.id)
      if (!viewed.time.idle || !viewed.time.viewed) return yield* Effect.die(new Error("Expected attention times"))
      expect(viewed.time.viewed).toEqual(viewed.time.idle)
      expect(viewed.time.updated).toEqual(created.time.updated)
      expect(
        yield* db
          .select({ idle: SessionTable.time_idle, viewed: SessionTable.time_viewed })
          .from(SessionTable)
          .where(eq(SessionTable.id, created.id))
          .get(),
      ).toEqual({
        idle: DateTime.toEpochMillis(viewed.time.idle),
        viewed: DateTime.toEpochMillis(viewed.time.viewed),
      })
      expect((yield* session.list()).data.find((item) => item.id === created.id)?.time).toEqual(viewed.time)

      yield* session.view({ sessionID: created.id, idle: DateTime.toEpochMillis(viewed.time.idle) })
      expect((yield* session.get(created.id)).time).toEqual(viewed.time)

      yield* bus.publish(SessionEvent.Execution.Failed, {
        sessionID: created.id,
        error: { type: "unknown", message: "failed" },
      })
      const unread = yield* session.get(created.id)
      if (!unread.time.idle || !unread.time.viewed) return yield* Effect.die(new Error("Expected attention times"))
      expect(DateTime.toEpochMillis(unread.time.idle)).toBeGreaterThan(DateTime.toEpochMillis(unread.time.viewed))
      expect(unread.outcome).toBe("failed")

      yield* session.view({ sessionID: created.id, idle: DateTime.toEpochMillis(unread.time.idle) })
      expect((yield* session.get(created.id)).time.viewed).toEqual(unread.time.idle)

      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: created.id, reason: "shutdown" })
      expect((yield* session.get(created.id)).time.idle).toEqual(unread.time.idle)
      expect((yield* session.get(created.id)).outcome).toBe("failed")

      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: created.id, reason: "user" })
      const interrupted = yield* session.get(created.id)
      if (!interrupted.time.idle || !interrupted.time.viewed)
        return yield* Effect.die(new Error("Expected attention times"))
      expect(DateTime.toEpochMillis(interrupted.time.idle)).toBeGreaterThan(
        DateTime.toEpochMillis(interrupted.time.viewed),
      )
      expect(interrupted.outcome).toBe("interrupted")
      expect(
        (yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, created.id))
          .all()).filter((event) => event.type === Bus.versionedType(SessionEvent.Viewed.type, 1)),
      ).toHaveLength(2)
    }),
  )

  it.effect("keeps a newer completion unread when the viewed watermark is stale", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: created.id })
      const observed = (yield* session.get(created.id)).time.idle
      if (!observed) return yield* Effect.die(new Error("Expected idle time"))

      // A failure commits between the viewer's observation and the viewed event.
      yield* bus.publish(SessionEvent.Execution.Failed, {
        sessionID: created.id,
        error: { type: "unknown", message: "failed" },
      })
      yield* session.view({ sessionID: created.id, idle: DateTime.toEpochMillis(observed) })
      const stale = yield* session.get(created.id)
      if (!stale.time.idle || !stale.time.viewed) return yield* Effect.die(new Error("Expected attention times"))
      expect(stale.time.viewed).toEqual(observed)
      expect(DateTime.toEpochMillis(stale.time.idle)).toBeGreaterThan(DateTime.toEpochMillis(stale.time.viewed))

      yield* session.view({ sessionID: created.id, idle: DateTime.toEpochMillis(stale.time.idle) + 1 })
      expect((yield* session.get(created.id)).time.viewed).toEqual(observed)

      // A duplicate stale watermark never regresses a newer acknowledgement.
      yield* session.view({ sessionID: created.id, idle: DateTime.toEpochMillis(stale.time.idle) })
      const acked = yield* session.get(created.id)
      expect(acked.time.viewed).toEqual(acked.time.idle)
      yield* bus.publish(SessionEvent.Viewed, { sessionID: created.id, idle: DateTime.toEpochMillis(observed) })
      expect((yield* session.get(created.id)).time.viewed).toEqual(acked.time.viewed)
    }),
  )

  it.effect("rejects an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing_view")
      expect(yield* Effect.flip(session.view({ sessionID, idle: 0 }))).toEqual(new Session.NotFoundError({ sessionID }))
    }),
  )

  it.effect("replays viewed state into a fresh database", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: Session.ID.make("ses_view_replay"), location })
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: created.id })
      const idle = (yield* session.get(created.id)).time.idle
      if (!idle) return yield* Effect.die(new Error("Expected idle time"))
      yield* session.view({ sessionID: created.id, idle: DateTime.toEpochMillis(idle) })
      yield* bus.publish(SessionEvent.Execution.Failed, {
        sessionID: created.id,
        error: { type: "unknown", message: "failed" },
      })
      const expected = yield* session.get(created.id)
      if (!expected.time.idle || !expected.time.viewed) return yield* Effect.die(new Error("Expected attention times"))
      const expectedIdle = DateTime.toEpochMillis(expected.time.idle)
      const expectedViewed = DateTime.toEpochMillis(expected.time.viewed)
      const serialized = (yield* sourceDb
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        created: event.created,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))
      const tmp = yield* tmpdirScoped()
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]),
        [
          [Database.node, Database.configured({ path: path.join(tmp.path, "target.sqlite") })],
          [Bus.node, Bus.configured({ persist: true })],
        ],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const targetBus = yield* Bus.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)
        yield* Effect.forEach(serialized, (event) => targetBus.replay(event), { discard: true })

        const replayed = yield* store.get(created.id)
        expect(replayed?.time).toEqual(expected.time)
        expect(replayed?.outcome).toBe("failed")
        expect(expected.time.updated).toEqual(created.time.updated)
        expect(expectedIdle).toBeGreaterThan(expectedViewed)
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )
})
