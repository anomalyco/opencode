import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessageUpdater } from "@opencode-ai/core/session/message-updater"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const it = testEffect(Layer.mergeAll(database, events, projector))
const sessionID = SessionV2.ID.make("ses_projector_test")
const created = DateTime.makeUnsafe(0)
const model = { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") }
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

const assistantRow = (id: SessionMessage.ID, seq: number, time: { created: DateTime.Utc; completed?: DateTime.Utc } = { created }) => {
  const { id: _, type, ...data } = encodeMessage(
    new SessionMessage.Assistant({ id, type: "assistant", agent: "build", model, content: [], time }),
  )
  return { id, session_id: sessionID, type, seq, time_created: DateTime.toEpochMillis(time.created), data }
}

describe("SessionProjector", () => {
  it.effect("orders projected context by durable aggregate sequence", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", title: "test", version: "test" })
        .run()
        .pipe(Effect.orDie)
      const events = yield* EventV2.Service

      yield* events.publish(SessionEvent.Prompted, { sessionID, timestamp: created, prompt: new Prompt({ text: "first" }) }, { id: SessionMessage.ID.make("evt_z") })
      yield* events.publish(SessionEvent.Prompted, { sessionID, timestamp: created, prompt: new Prompt({ text: "second" }) }, { id: SessionMessage.ID.make("evt_a") })

      expect((yield* SessionV2.Service.pipe(Effect.flatMap((sessions) => sessions.context(sessionID)))).map((message) => message.type === "user" ? message.text : message.type)).toEqual(["first", "second"])
    }).pipe(Effect.provide(SessionV2.layer.pipe(Layer.provide(events), Layer.provide(database), Layer.provide(Project.defaultLayer), Layer.provide(SessionStore.layer.pipe(Layer.provide(database))), Layer.provide(SessionExecution.noopLayer))))
  )

  it.effect("does not revive a stale incomplete in-memory assistant projection", () =>
    Effect.gen(function* () {
      const stale = new SessionMessage.Assistant({
        id: SessionMessage.ID.make("evt_assistant_stale"),
        type: "assistant",
        agent: "build",
        model,
        content: [],
        time: { created },
      })
      const completed = new SessionMessage.Assistant({
        id: SessionMessage.ID.make("evt_assistant_completed"),
        type: "assistant",
        agent: "build",
        model,
        content: [],
        time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
      })

      expect(yield* SessionMessageUpdater.memory({ messages: [stale, completed] }).getCurrentAssistant()).toBeUndefined()
    }),
  )

  it.effect("updates only the newest incomplete assistant projection", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", title: "test", version: "test" })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionMessageTable)
        .values([assistantRow(SessionMessage.ID.make("evt_assistant_1"), 0), assistantRow(SessionMessage.ID.make("evt_assistant_2"), 1)])
        .run()
        .pipe(Effect.orDie)

      const service = yield* EventV2.Service
      yield* service.publish(SessionEvent.Step.Ended, {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        assistantMessageID: SessionMessage.ID.make("evt_assistant_2"),
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.id))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) => Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }))
      expect(messages[0]).not.toHaveProperty("time.completed")
      expect(messages[1]).toMatchObject({ type: "assistant", finish: "stop", time: { completed: DateTime.makeUnsafe(1) } })
    }),
  )

  it.effect("does not revive a stale incomplete assistant projection", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", title: "test", version: "test" })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionMessageTable)
        .values([
          assistantRow(SessionMessage.ID.make("evt_assistant_stale"), 0),
          assistantRow(SessionMessage.ID.make("evt_assistant_completed"), 1, {
            created: DateTime.makeUnsafe(1),
            completed: DateTime.makeUnsafe(2),
          }),
        ])
        .run()
        .pipe(Effect.orDie)

      const service = yield* EventV2.Service
      yield* service.publish(SessionEvent.Text.Started, {
        sessionID,
        timestamp: DateTime.makeUnsafe(3),
        textID: "text-stale",
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.id))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) => Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }))
      expect(messages).toEqual([
        new SessionMessage.Assistant({
          id: SessionMessage.ID.make("evt_assistant_completed"),
          type: "assistant",
          agent: "build",
          model,
          content: [],
          time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
        }),
        new SessionMessage.Assistant({
          id: SessionMessage.ID.make("evt_assistant_stale"),
          type: "assistant",
          agent: "build",
          model,
          content: [],
          time: { created },
        }),
      ])
    }),
  )
})
