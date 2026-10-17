import { describe, expect } from "bun:test"
import { DateTime, Effect, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { TranscriptProjection } from "@opencode/core/session/projection/transcript"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Shell } from "@opencode/schema/shell"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const sessionID = Session.ID.make("ses_transcript")
const foreignID = Session.ID.make("ses_foreign")
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }
const created = DateTime.makeUnsafe(0)
const encode = Schema.encodeSync(SessionMessage.Info)
const decode = Schema.decodeUnknownSync(SessionMessage.Info)

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const bus = yield* Bus.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values(
      [sessionID, foreignID].map((id) => ({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: id,
        version: "test",
      })),
    )
    .run()
  yield* bus.project(SessionEvent.Step.Started, (event) => TranscriptProjection.project(db, event))
  yield* bus.project(SessionEvent.Text.Started, (event) => TranscriptProjection.project(db, event))
  yield* bus.project(SessionEvent.Shell.Ended, (event) => TranscriptProjection.project(db, event))
  yield* bus.project(SessionEvent.Compaction.Failed, (event) => TranscriptProjection.project(db, event))
  return { db, bus }
})

const row = (message: SessionMessage.Info, seq: number, session = sessionID) => {
  const { id, type, ...data } = encode(message)
  return {
    id: SessionMessage.ID.make(id),
    session_id: session,
    type,
    seq,
    time_created: DateTime.toEpochMillis(message.time.created),
    data,
  }
}
const assistant = (id: string, completed?: DateTime.Utc) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(id),
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content: [],
    time: { created, completed },
  })
const messages = (db: Database.Interface["db"], session = sessionID) =>
  db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.session_id, session))
    .all()
    .pipe(Effect.map((rows) => rows.map((row) => decode({ ...row.data, id: row.id, type: row.type }))))

describe("TranscriptProjection", () => {
  it.effect("settles only the newest incomplete assistant by sequence", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* seed
      yield* db
        .insert(SessionMessageTable)
        .values([row(assistant("msg_older"), 1), row(assistant("msg_newer"), 2)])
        .run()
      const event = yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("msg_next"),
        agent: Agent.defaultID,
        model,
        started: 0,
      })
      const stored = (yield* messages(db)).filter(
        (message): message is SessionMessage.Assistant => message.type === "assistant",
      )
      expect(stored.find((message) => message.id === "msg_older")?.time.completed).toBeUndefined()
      expect(stored.find((message) => message.id === "msg_newer")?.time.completed).toEqual(
        DateTime.makeUnsafe(event.created),
      )
      const appended = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, SessionMessage.ID.make("msg_next")))
        .get()
      expect(appended?.seq).toBe(event.durable.seq)
    }),
  )

  it.effect("does not fall back to an older incomplete assistant after a completed one", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* seed
      yield* db
        .insert(SessionMessageTable)
        .values([row(assistant("msg_older"), 1), row(assistant("msg_completed", DateTime.makeUnsafe(1)), 2)])
        .run()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("msg_next"),
        agent: Agent.defaultID,
        model,
        started: 0,
      })
      const stored = (yield* messages(db)).filter(
        (message): message is SessionMessage.Assistant => message.type === "assistant",
      )
      expect(stored.find((message) => message.id === "msg_older")?.time.completed).toBeUndefined()
      expect(stored.find((message) => message.id === "msg_completed")?.time.completed).toEqual(DateTime.makeUnsafe(1))
    }),
  )

  it.effect("does not update an assistant belonging to another session", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* seed
      const foreign = assistant("msg_foreign")
      yield* db
        .insert(SessionMessageTable)
        .values(row(foreign, 1, foreignID))
        .run()
      yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID: foreign.id, ordinal: 0 })
      expect(yield* messages(db, foreignID)).toEqual([foreign])
      expect(yield* messages(db)).toEqual([])
    }),
  )

  it.effect("keeps shell lookup scoped to the event session", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* seed
      const foreign = SessionMessage.Shell.make({
        id: SessionMessage.ID.make("msg_shell"),
        type: "shell",
        shellID: Shell.ID.make("sh_shared"),
        command: "pwd",
        status: "running",
        time: { created },
      })
      yield* db
        .insert(SessionMessageTable)
        .values(row(foreign, 1, foreignID))
        .run()
      yield* bus.publish(SessionEvent.Shell.Ended, {
        sessionID,
        shell: Shell.Info.make({
          id: foreign.shellID,
          status: "exited",
          command: "pwd",
          cwd: "/project",
          shell: "/bin/sh",
          file: "/tmp/sh_shared.out",
          exit: 0,
          metadata: {},
          time: { started: 0, completed: 1 },
        }),
        output: { output: "done", cursor: 4, size: 4, truncated: false },
      })
      expect(yield* messages(db, foreignID)).toEqual([foreign])
      expect(yield* messages(db)).toEqual([])
    }),
  )

  it.effect("does not finish a running compaction belonging to another session", () =>
    Effect.gen(function* () {
      const { db, bus } = yield* seed
      const foreign = SessionMessage.CompactionRunning.make({
        id: SessionMessage.ID.make("msg_compaction"),
        type: "compaction",
        status: "running",
        reason: "auto",
        summary: "",
        recent: "",
        time: { created },
      })
      yield* db
        .insert(SessionMessageTable)
        .values(row(foreign, 1, foreignID))
        .run()
      yield* bus.publish(SessionEvent.Compaction.Failed, {
        sessionID,
        reason: "auto",
        error: { type: "compaction.failed", message: "Failed" },
      })
      expect(yield* messages(db, foreignID)).toEqual([foreign])
      expect(yield* messages(db)).toMatchObject([{ type: "compaction", status: "failed" }])
    }),
  )
})
