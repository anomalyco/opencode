import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("SessionV2.log", () => {
  it.effect("replays public session events and marks synced at the aggregate watermark", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })
      yield* session.rename({ sessionID: created.id, title: "renamed" })

      const items = Array.from(yield* Stream.runCollect(session.log({ sessionID: created.id })))
      const watermark = (yield* events.sequences([created.id])).get(created.id)

      // Session creation commits a non-public durable event, so the marker's
      // seq covers more of the aggregate than the public events emitted.
      expect(items.map((item) => item.type)).toEqual(["session.next.renamed", "log.synced"])
      expect(items.at(-1)).toEqual({ type: "log.synced", aggregateID: created.id, seq: watermark })
    }),
  )

  it.effect("continues with live public events when following", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const fiber = yield* session
        .log({ sessionID: created.id, follow: true })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.rename({ sessionID: created.id, title: "renamed live" })

      const items = Array.from(yield* Fiber.join(fiber))
      expect(items.map((item) => item.type)).toEqual(["log.synced", "session.next.renamed"])
    }),
  )

  it.effect("fails with NotFound for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const error = yield* Effect.flip(Stream.runCollect(session.log({ sessionID: SessionV2.ID.create() })))
      expect(error._tag).toBe("Session.NotFoundError")
    }),
  )

  it.effect("reads across undecodable gaps in aggregate order and marks the true log position", () =>
    Effect.gen(function* () {
      const GapEvent = EventV2.define({
        type: "test.session.log.gap",
        durable: { aggregate: "sessionID", version: 1 },
        schema: { sessionID: SessionV2.ID, value: Schema.String },
      })
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })
      yield* session.switchAgent({ sessionID: created.id, agent: "one" })
      // Not in the durable manifest, so reads must skip it without failing.
      yield* events.publish(GapEvent, { sessionID: created.id, value: "filtered" })
      yield* session.switchAgent({ sessionID: created.id, agent: "two" })
      yield* session.switchAgent({ sessionID: created.id, agent: "three" })

      const items = Array.from(yield* Stream.runCollect(session.log({ sessionID: created.id, after: 1 })))

      expect(
        items.map((item): number | string | undefined => (EventV2.isSynced(item) ? item.type : item.durable?.seq)),
      ).toEqual([3, 4, "log.synced"])
      expect(items.at(-1)).toEqual({ type: "log.synced", aggregateID: created.id, seq: EventV2.Seq.make(4) })
    }),
  )

  it.effect("completes with a bare synced marker for a migrated Session with no event sequence", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const session = yield* SessionV2.Service
      const sessionID = SessionV2.ID.make("ses_empty_log")
      yield* db
        .insert(ProjectTable)
        .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: ProjectV2.ID.global,
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

describe("SessionV2 watermarks", () => {
  it.effect("list pairs each session snapshot with its durable log watermark", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const first = yield* session.create({ location })
      const second = yield* session.create({ location })
      yield* session.rename({ sessionID: first.id, title: "renamed" })

      const page = yield* session.list()
      const sequences = yield* events.sequences([first.id, second.id])

      expect(page.data.map((info) => info.id).toSorted()).toEqual([first.id, second.id].toSorted())
      expect(page.watermarks).toEqual(sequences)
      expect(page.watermarks.get(first.id)).toBeGreaterThan(page.watermarks.get(second.id)!)
    }),
  )

  it.effect("watermarks omits sessions without durable events", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      const watermarks = yield* session.watermarks([created.id, SessionV2.ID.create()])

      expect(Array.from(watermarks.keys())).toEqual([created.id])
    }),
  )
})
