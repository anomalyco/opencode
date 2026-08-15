import { describe, expect } from "bun:test"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { DateTime, Effect } from "effect"
import { eq } from "drizzle-orm"
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

      yield* Effect.all([session.view({ sessionID: created.id }), session.view({ sessionID: created.id })], {
        concurrency: "unbounded",
        discard: true,
      })
      expect((yield* session.get(created.id)).time.viewed).toBeUndefined()

      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: created.id })
      const idle = yield* session.get(created.id)
      expect(idle.time.idle).toBeDefined()
      expect(idle.time.viewed).toBeUndefined()
      expect(idle.time.updated).toEqual(created.time.updated)

      yield* session.view({ sessionID: created.id })
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

      yield* session.view({ sessionID: created.id })
      expect((yield* session.get(created.id)).time).toEqual(viewed.time)

      yield* bus.publish(SessionEvent.Execution.Failed, {
        sessionID: created.id,
        error: { type: "unknown", message: "failed" },
      })
      const unread = yield* session.get(created.id)
      if (!unread.time.idle || !unread.time.viewed) return yield* Effect.die(new Error("Expected attention times"))
      expect(DateTime.toEpochMillis(unread.time.idle)).toBeGreaterThan(DateTime.toEpochMillis(unread.time.viewed))

      yield* session.view({ sessionID: created.id })
      expect((yield* session.get(created.id)).time.viewed).toEqual(unread.time.idle)

      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: created.id, reason: "shutdown" })
      expect((yield* session.get(created.id)).time.idle).toEqual(unread.time.idle)

      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: created.id, reason: "user" })
      const interrupted = yield* session.get(created.id)
      if (!interrupted.time.idle || !interrupted.time.viewed)
        return yield* Effect.die(new Error("Expected attention times"))
      expect(DateTime.toEpochMillis(interrupted.time.idle)).toBeGreaterThan(
        DateTime.toEpochMillis(interrupted.time.viewed),
      )
      expect(
        (yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, created.id))
          .all()).filter((event) => event.type === "session.viewed.1"),
      ).toHaveLength(2)
    }),
  )

  it.effect("rejects an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing_view")
      expect(yield* Effect.flip(session.view({ sessionID }))).toEqual(new Session.NotFoundError({ sessionID }))
    }),
  )
})
