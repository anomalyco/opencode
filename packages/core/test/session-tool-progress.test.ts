import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Database } from "@bolt-ai/core/database/database"
import { LayerNode } from "@bolt-ai/core/effect/layer-node"
import { EventV2 } from "@bolt-ai/core/event"
import { EventTable } from "@bolt-ai/core/event/sql"
import { ModelV2 } from "@bolt-ai/core/model"
import { Project } from "@bolt-ai/core/project"
import { ProjectTable } from "@bolt-ai/core/project/sql"
import { ProviderV2 } from "@bolt-ai/core/provider"
import { AbsolutePath } from "@bolt-ai/core/schema"
import { SessionV2 } from "@bolt-ai/core/session"
import { SessionEvent } from "@bolt-ai/core/session/event"
import { SessionMessage } from "@bolt-ai/core/session/message"
import { SessionProjector } from "@bolt-ai/core/session/projector"
import { SessionTable, SessionMessageTable } from "@bolt-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const content = (text: string) => [{ type: "text" as const, text }] as const

describe("Session tool progress", () => {
  it.effect("keeps progress live-only and terminal settlements durable", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* Bus.Service
      const sessionID = Session.ID.make("ses_tool_progress_projector")
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "progress",
          directory: "/project",
          title: "progress",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const assistantMessageID = SessionMessage.ID.create()
      yield* service.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: Agent.ID.make("build"),
        model,
        started: 0,
      })
      const readAssistant = Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, assistantMessageID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* Effect.die("Missing projected assistant")
        return Schema.decodeUnknownSync(SessionMessage.Assistant)({ ...row.data, id: row.id, type: row.type })
      })
      const start = (id: string) =>
        Effect.gen(function* () {
          yield* service.publish(SessionEvent.Tool.Input.Started, {
            sessionID,
            assistantMessageID,
            id,
            name: "bash",
          })
          yield* service.publish(SessionEvent.Tool.Called, {
            sessionID,
            assistantMessageID,
            id,
            input: { command: "pwd" },
            executed: false,
          })
        })

      yield* start("call-success")
      expect((yield* readAssistant).content[0]).toMatchObject({
        state: { status: "running", metadata: {} },
      })

      const progress = yield* service.publish(SessionEvent.Tool.Progress, {
        sessionID,
        assistantMessageID,
        id: "call-success",
        metadata: { phase: "checkpoint" },
      })
      expect((yield* readAssistant).content[0]).toMatchObject({
        state: { status: "running", metadata: {} },
      })

      const success = yield* service.publish(SessionEvent.Tool.Success, {
        sessionID,
        assistantMessageID,
        id: "call-success",
        metadata: { phase: "done" },
        content: content("complete"),
        executed: false,
      })
      expect((yield* readAssistant).content[0]).toMatchObject({
        state: { status: "completed", metadata: { phase: "done" }, content: content("complete") },
      })

      yield* start("call-failed")
      yield* service.publish(SessionEvent.Tool.Progress, {
        sessionID,
        assistantMessageID,
        id: "call-failed",
        metadata: { phase: "checkpoint" },
      })
      const failed = yield* service.publish(SessionEvent.Tool.Failed, {
        sessionID,
        assistantMessageID,
        id: "call-failed",
        error: { type: "unknown", message: "boom" },
        metadata: { phase: "checkpoint" },
        content: content("before failure"),
        executed: false,
      })
      expect((yield* readAssistant).content[1]).toMatchObject({
        state: {
          status: "error",
          metadata: { phase: "checkpoint" },
          content: content("before failure"),
          error: { type: "unknown", message: "boom" },
        },
      })
      expect(Schema.is(SessionEvent.Durable)(progress)).toBe(false)
      expect(Schema.is(SessionEvent.Durable)(success)).toBe(true)
      expect(Schema.is(SessionEvent.Durable)(failed)).toBe(true)

      const rows = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.type)).not.toContain(Bus.versionedType(SessionEvent.Tool.Progress.type, 1))
      expect(rows.map((row) => row.type)).toContain(Bus.versionedType(SessionEvent.Tool.Success.type, 2))
      expect(rows.map((row) => row.type)).toContain(Bus.versionedType(SessionEvent.Tool.Failed.type, 2))
    }),
  )
})
