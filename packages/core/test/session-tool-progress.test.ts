import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { DateTime, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { ToolProgress } from "@opencode-ai/core/session/tool-progress"
import { ToolOutput } from "@opencode-ai/core/tool-output"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const it = testEffect(Layer.mergeAll(database, events, projector))
const timestamp = DateTime.makeUnsafe(1)
const model = { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") }

const content = (text: string) => [ToolOutput.text({ type: "text", text })]

describe("ToolProgress", () => {
  it.effect("publishes live updates to connected clients without replaying them", () =>
    Effect.gen(function* () {
      const service = yield* EventV2.Service
      const sessionID = SessionV2.ID.make("ses_tool_progress_publish")
      const assistantMessageID = EventV2.ID.make("evt_tool_progress_publish")
      const progress = ToolProgress.create(service, { sessionID, assistantMessageID, callID: "call-publish" })
      const subscription = yield* service.subscribe(SessionEvent.Tool.ProgressLive).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      )
      yield* Effect.yieldNow

      const live = yield* progress.live({ structured: { phase: "streaming" }, content: content("live") })
      const checkpoint = yield* progress.checkpoint({ structured: { phase: "checkpoint" }, content: content("saved") })
      const replay = yield* service.aggregateEvents({ aggregateID: sessionID }).pipe(Stream.take(1), Stream.runCollect)

      expect(Array.from(yield* Fiber.join(subscription))).toEqual([live])
      expect(Schema.is(SessionEvent.All)(live)).toBe(true)
      expect(Schema.is(SessionEvent.Durable)(live)).toBe(false)
      expect(live).not.toHaveProperty("seq")
      expect(live).not.toHaveProperty("version")
      expect(checkpoint).toMatchObject({
        type: SessionEvent.Tool.Progress.type,
        seq: 0,
        data: { sessionID, assistantMessageID, callID: "call-publish", structured: { phase: "checkpoint" } },
      })
      expect(Array.from(replay)).toEqual([{ cursor: 0, event: checkpoint }])
    }),
  )

  it.effect("projects only checkpoints and keeps final settlements durable", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* EventV2.Service
      const sessionID = SessionV2.ID.make("ses_tool_progress_projector")
      yield* db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
      yield* db.insert(SessionTable).values({ id: sessionID, project_id: Project.ID.global, slug: "progress", directory: "/project", title: "progress", version: "test" }).run().pipe(Effect.orDie)
      const assistantMessageID = (yield* service.publish(SessionEvent.Step.Started, { sessionID, timestamp, agent: "build", model })).id
      const readAssistant = Effect.gen(function* () {
        const row = yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, assistantMessageID)).get().pipe(Effect.orDie)
        if (!row) return yield* Effect.die("Missing projected assistant")
        return Schema.decodeUnknownSync(SessionMessage.Assistant)({ ...row.data, id: row.id, type: row.type })
      })
      const start = (callID: string) => Effect.gen(function* () {
        yield* service.publish(SessionEvent.Tool.Input.Started, { sessionID, timestamp, assistantMessageID, callID, name: "bash" })
        yield* service.publish(SessionEvent.Tool.Called, { sessionID, timestamp, assistantMessageID, callID, tool: "bash", input: { command: "pwd" }, provider: { executed: false } })
      })

      yield* start("call-success")
      yield* service.publish(SessionEvent.Tool.ProgressLive, { sessionID, timestamp, assistantMessageID, callID: "call-success", structured: { phase: "live" }, content: content("live") })
      expect((yield* readAssistant).content[0]).toMatchObject({ state: { status: "running", structured: {}, content: [] } })

      yield* service.publish(SessionEvent.Tool.Progress, { sessionID, timestamp, assistantMessageID, callID: "call-success", structured: { phase: "checkpoint" }, content: content("saved") })
      expect((yield* readAssistant).content[0]).toMatchObject({ state: { status: "running", structured: { phase: "checkpoint" }, content: content("saved") } })

      const success = yield* service.publish(SessionEvent.Tool.Success, { sessionID, timestamp, assistantMessageID, callID: "call-success", structured: { phase: "done" }, content: content("complete"), provider: { executed: false } })
      expect((yield* readAssistant).content[0]).toMatchObject({ state: { status: "completed", structured: { phase: "done" }, content: content("complete") } })

      yield* start("call-failed")
      yield* service.publish(SessionEvent.Tool.Progress, { sessionID, timestamp, assistantMessageID, callID: "call-failed", structured: { phase: "checkpoint" }, content: content("before failure") })
      const failed = yield* service.publish(SessionEvent.Tool.Failed, { sessionID, timestamp, assistantMessageID, callID: "call-failed", error: { type: "unknown", message: "boom" }, provider: { executed: false } })
      expect((yield* readAssistant).content[1]).toMatchObject({ state: { status: "error", structured: { phase: "checkpoint" }, content: content("before failure"), error: { type: "unknown", message: "boom" } } })
      expect(Schema.is(SessionEvent.Durable)(success)).toBe(true)
      expect(Schema.is(SessionEvent.Durable)(failed)).toBe(true)

      const rows = yield* db.select({ type: EventTable.type }).from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).orderBy(asc(EventTable.seq)).all().pipe(Effect.orDie)
      expect(rows.map((row) => row.type)).not.toContain(EventV2.versionedType(SessionEvent.Tool.ProgressLive.type, 1))
      expect(rows.map((row) => row.type)).toContain(EventV2.versionedType(SessionEvent.Tool.Progress.type, 1))
      expect(rows.map((row) => row.type)).toContain(EventV2.versionedType(SessionEvent.Tool.Success.type, 1))
      expect(rows.map((row) => row.type)).toContain(EventV2.versionedType(SessionEvent.Tool.Failed.type, 1))
    }),
  )
})
