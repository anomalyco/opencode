import { describe, expect } from "bun:test"
import { DateTime, Effect, Fiber, Option, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { asc, eq, sql } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { Agent } from "@opencode/core/agent"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { EventTable } from "@opencode/core/event/sql"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { Money } from "@opencode/schema/money"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionExecution } from "@opencode/core/session/execution"
import { fromRow } from "@opencode/core/session/info"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionStore } from "@opencode/core/session/store"
import { SessionStored } from "@opencode/core/session/stored"
import { SessionBlob } from "@opencode/core/session/blob"
import { Config } from "@opencode/core/config"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { SessionHistory } from "@opencode/core/session/history"
import { Shell } from "@opencode/schema/shell"
import {
  InstructionStateTable,
  BlobRefTable,
  BlobTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionPartTable,
  SessionTable,
} from "@opencode/core/session/sql"
import { testEffect } from "./lib/effect"
import { Snapshot } from "@opencode/core/snapshot"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionInbox.node, SessionStore.node]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)
const sessionsLayer = AppNodeBuilder.build(Session.node, [SessionExecution.node.replace(SessionExecution.noopLayer)])
const sessionID = Session.ID.make("ses_projector_test")
const created = DateTime.makeUnsafe(0)
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }
const previousModel = { ...model, variant: Model.VariantID.make("medium") }
const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const mediaBlob = Config.testLayer([
  new Document({
    type: "document",
    info: new Info({ experimental: new ConfigExperimental.Info({ media_blob: true }) }),
  }),
])
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const attachment = (name: string, bytes = png, mime = "image/png") => ({
  data: bytes.toString("base64"),
  mime,
  source: { type: "inline" as const },
  name,
})
const build = Agent.defaultID

const assistantRow = (
  id: SessionMessage.ID,
  seq: number,
  time: { created: DateTime.Utc; completed?: DateTime.Utc } = { created },
  usage?: Pick<SessionMessage.Assistant, "cost" | "tokens">,
) => {
  const {
    id: _,
    type,
    ...data
  } = encodeMessage(
    SessionMessage.Assistant.make({ id, type: "assistant", agent: build, model, content: [], time, ...usage }),
  )
  return { id, session_id: sessionID, type, seq, time_created: DateTime.toEpochMillis(time.created), data }
}

const seedSession = (overrides?: Partial<typeof SessionTable.$inferInsert>) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        ...overrides,
      })
      .run()
    return db
  })

describe("SessionProjector", () => {
  it.effect("does not settle a pending manual compaction on an auto failure", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      const inputID = SessionMessage.ID.make("msg_manual_compaction")
      yield* inbox.admitCompaction({ id: inputID, sessionID, delivery: "queue" })

      yield* bus.publish(SessionEvent.Compaction.Failed, {
        sessionID,
        reason: "auto",
        error: { type: "compaction.failed", message: "Auto compaction failed" },
      })

      expect(yield* SessionInbox.find(db, inputID)).toMatchObject({ id: inputID })
    }),
  )

  it.effect("loads legacy revert storage into canonical state", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const legacy = JSON.stringify({
        messageID: "msg_boundary",
        snapshot: "tree",
        diff: "legacy patch",
        files: [{ path: "src/old.ts", status: "modified", additions: 1, deletions: 0, patch: "@@" }],
      })
      yield* db.run(sql`update session_v2 set revert = ${legacy} where id = ${sessionID}`)
      const stored = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
      if (!stored) return yield* Effect.die("Session row missing")
      const storedRevert = fromRow(stored).revert
      expect(String(storedRevert?.messageID)).toBe("msg_boundary")
      expect(String(storedRevert?.snapshot)).toBe("tree")
      expect(storedRevert?.files).toEqual([
        { file: "src/old.ts", status: "modified", additions: 1, deletions: 0, patch: "@@" },
      ])
    }),
  )

  it.effect("projects staged, cleared, and committed reverts", () =>
    Effect.gen(function* () {
      const db = yield* seedSession({
        cost: 1.25,
        tokens_input: 10,
        tokens_output: 4,
        tokens_reasoning: 2,
        tokens_cache_read: 3,
        tokens_cache_write: 1,
      })
      const boundary = SessionMessage.ID.make("msg_boundary")
      const earlier = SessionMessage.ID.make("msg_earlier")
      yield* db
        .insert(SessionMessageTable)
        .values([
          assistantRow(earlier, 0),
          assistantRow(
            boundary,
            1,
            { created },
            {
              cost: Money.USD.make(0.5),
              tokens: { input: 4, output: 1, reasoning: 1, cache: { read: 1, write: 0 } },
            },
          ),
          assistantRow(
            SessionMessage.ID.make("msg_later"),
            2,
            { created },
            {
              cost: Money.USD.make(0.75),
              tokens: { input: 6, output: 3, reasoning: 1, cache: { read: 2, write: 1 } },
            },
          ),
        ])
        .run()
      yield* db
        .insert(InstructionStateTable)
        .values({
          session_id: sessionID,
          epoch_start: 0,
          through_seq: 0,
          initial_values: {},
          current_values: {},
        })
        .run()
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary, snapshot: Snapshot.ID.make("tree"), files: [] },
      })
      expect((yield* db.select({ revert: SessionTable.revert }).from(SessionTable).get())?.revert).toMatchObject({
        messageID: boundary,
        snapshot: "tree",
        files: [],
      })
      yield* bus.publish(SessionEvent.RevertEvent.Cleared, { sessionID })
      expect((yield* db.select({ revert: SessionTable.revert }).from(SessionTable).get())?.revert).toBeNull()
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary, files: [] },
      })
      yield* bus.publish(SessionEvent.RevertEvent.Committed, {
        sessionID,
        to: boundary,
      })
      expect(
        (yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all()).map((row) => row.id),
      ).toEqual([earlier])
      expect(yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()).toMatchObject({
        cost: Money.USD.make(1.25),
        tokens_input: 10,
        tokens_output: 4,
        tokens_reasoning: 2,
        tokens_cache_read: 3,
        tokens_cache_write: 1,
      })
      // No instruction update followed the boundary, so the fold survives.
      expect(yield* db.select().from(InstructionStateTable).get().pipe(Effect.orDie)).toMatchObject({ through_seq: 0 })
    }),
  )

  it.effect("orders projected messages and context by durable aggregate sequence", () =>
    Effect.gen(function* () {
      yield* seedSession()
      const bus = yield* Bus.Service

      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID,
        inboxID: SessionMessage.ID.make("msg_first"),
        item: { type: "user", payload: { text: "first" }, delivery: "steer" },
      })
      yield* bus.publish(
        SessionEvent.InboxDelivered,
        {
          sessionID,
          inboxID: SessionMessage.ID.make("msg_first"),
        },
        { id: Event.ID.make("evt_z") },
      )
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID,
        inboxID: SessionMessage.ID.make("msg_second"),
        item: { type: "user", payload: { text: "second" }, delivery: "steer" },
      })
      yield* bus.publish(
        SessionEvent.InboxDelivered,
        {
          sessionID,
          inboxID: SessionMessage.ID.make("msg_second"),
        },
        { id: Event.ID.make("evt_a") },
      )

      const sessions = yield* Session.Service
      const firstPage = yield* sessions.messages({ sessionID, limit: 1, order: "asc" })
      expect(firstPage.map((message) => (message.type === "user" ? message.text : message.type))).toEqual(["first"])
      const secondPage = yield* sessions.messages({
        sessionID,
        limit: 1,
        order: "asc",
        cursor: { id: firstPage[0]!.id, direction: "next" },
      })
      expect(secondPage.map((message) => (message.type === "user" ? message.text : message.type))).toEqual(["second"])
      expect(
        (yield* sessions.messages({
          sessionID,
          limit: 1,
          order: "asc",
          cursor: { id: secondPage[0]!.id, direction: "previous" },
        })).map((message) => (message.type === "user" ? message.text : message.type)),
      ).toEqual(["first"])
      expect(
        (yield* sessions.context(sessionID)).map((message) => (message.type === "user" ? message.text : message.type)),
      ).toEqual(["first", "second"])
    }).pipe(Effect.provide(sessionsLayer)),
  )

  it.effect("maps malformed persisted rows consistently while single-message lookup defects", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const messageID = SessionMessage.ID.make("msg_malformed")
      yield* db
        .insert(SessionMessageTable)
        .values({
          id: messageID,
          session_id: sessionID,
          type: "user",
          seq: 0,
          data: { text: "valid before corruption", time: { created: 0 } },
        })
        .run()
        .pipe(Effect.orDie)
      yield* db.run(sql`update session_message set data = '{"time":{"created":0}}' where id = ${messageID}`)

      const sessions = yield* Session.Service
      const store = yield* SessionStore.Service
      const expected = { _tag: "Session.MessageDecodeError", sessionID, messageID }
      expect(yield* store.messages({ sessionID }).pipe(Effect.flip)).toMatchObject(expected)
      expect(yield* sessions.messages({ sessionID }).pipe(Effect.flip)).toMatchObject(expected)
      expect(yield* sessions.context(sessionID).pipe(Effect.flip)).toMatchObject(expected)
      expect(yield* sessions.message({ sessionID, messageID }).pipe(Effect.catchDefect(Effect.succeed))).toMatchObject(
        expected,
      )
    }).pipe(Effect.provide(sessionsLayer)),
  )

  it.effect("checks session existence before resolving a missing message cursor", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const missing = Session.ID.make("ses_missing")
      expect(
        yield* sessions
          .messages({
            sessionID: missing,
            cursor: { id: SessionMessage.ID.make("msg_missing"), direction: "next" },
          })
          .pipe(Effect.flip),
      ).toEqual(new Session.NotFoundError({ sessionID: missing }))
    }).pipe(Effect.provide(sessionsLayer)),
  )

  it.effect("consumes the pending row and projects the message at promotion", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      const id = SessionMessage.ID.make("msg_admitted")
      const admitted = yield* inbox.admit({
        id,
        sessionID,
        item: { type: "user", payload: { text: "promote me" }, delivery: "steer" },
      })
      if (!admitted) return yield* Effect.die("Prompt admission failed")

      const event = yield* bus.publish(SessionEvent.InboxDelivered, {
        sessionID,
        inboxID: id,
      })

      expect(
        yield* db.select().from(SessionInboxTable).where(eq(SessionInboxTable.id, id)).get().pipe(Effect.orDie),
      ).toBeUndefined()
      expect(
        yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, id)).get().pipe(Effect.orDie),
      ).toMatchObject({ session_id: sessionID, type: "user", seq: event.durable?.seq })
    }),
  )

  it.effect("projects durable context messages supported by the updater", () =>
    Effect.gen(function* () {
      const db = yield* seedSession({ agent: Agent.ID.make("plan"), model: previousModel })
      const bus = yield* Bus.Service

      yield* bus.publish(SessionEvent.AgentSelected, {
        sessionID,
        agent: build,
      })
      yield* bus.publish(SessionEvent.ModelSelected, {
        sessionID,
        model,
      })
      yield* bus.publish(SessionEvent.Synthetic, {
        sessionID,
        text: "synthetic context",
        metadata: { source: "projector-test" },
      })
      // Serialized events have no transient envelope metadata to supply the background marker.
      yield* bus.replay({
        id: Event.ID.create(),
        created: 0,
        aggregateID: sessionID,
        seq: 3,
        type: Bus.versionedType(SessionEvent.Shell.Started.type, 1),
        data: {
          sessionID,
          shell: Shell.Info.make({
            id: Shell.ID.make("sh_projector"),
            status: "running",
            command: "pwd",
            cwd: "/project",
            shell: "/bin/sh",
            file: "/tmp/sh_projector.out",
            metadata: { background: true },
            time: { started: 0 },
          }),
        },
      })
      yield* bus.publish(SessionEvent.Shell.Ended, {
        sessionID,
        shell: Shell.Info.make({
          id: Shell.ID.make("sh_projector"),
          status: "exited",
          command: "pwd",
          cwd: "/project",
          shell: "/bin/sh",
          file: "/tmp/sh_projector.out",
          exit: 0,
          metadata: {},
          time: { started: 0, completed: 1 },
        }),
        output: { output: "/project", cursor: 8, size: 8, truncated: false },
      })
      yield* bus.publish(SessionEvent.Compaction.Started, {
        sessionID,
        reason: "manual",
      })
      yield* bus.publish(SessionEvent.Compaction.Delta, {
        sessionID,
        text: "partial",
      })
      expect(
        yield* db
          .select({ id: EventTable.id })
          .from(EventTable)
          .where(sql`${EventTable.type} like 'session.compaction.delta.%'`)
          .all()
          .pipe(Effect.orDie),
      ).toHaveLength(0)
      expect(
        yield* db
          .select({ data: SessionMessageTable.data })
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.type, "compaction"))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([{ data: expect.objectContaining({ status: "running", summary: "" }) }])
      yield* bus.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        reason: "manual",
        text: "summary",
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) =>
        Schema.decodeUnknownSync(SessionMessage.Info)({ ...row.data, id: row.id, type: row.type }),
      )

      expect(messages.map((message) => message.type)).toEqual([
        "agent-switched",
        "model-switched",
        "synthetic",
        "shell",
        "compaction",
      ])
      expect(messages.find((message) => message.type === "synthetic")).toMatchObject({
        text: "synthetic context",
        metadata: { source: "projector-test" },
      })
      expect(messages.find((message) => message.type === "agent-switched")).toMatchObject({
        agent: build,
        previous: "plan",
      })
      expect(messages.find((message) => message.type === "model-switched")).toMatchObject({ previous: previousModel })
      expect(messages.find((message) => message.type === "shell")).toMatchObject({
        command: "pwd",
        status: "exited",
        exit: 0,
        metadata: { background: true },
        output: { output: "/project", truncated: false },
        time: { completed: DateTime.makeUnsafe(0) },
      })
      expect(messages.find((message) => message.type === "compaction")).toMatchObject({ summary: "summary" })
      expect(rows.find((row) => row.type === "compaction")?.data).not.toHaveProperty("recent")
      expect(
        yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie),
      ).toMatchObject({
        agent: "build",
        model,
        time_updated: DateTime.toEpochMillis(created),
      })
    }),
  )

  it.effect("rejects distinct creator events that reuse one projected message ID", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const id = SessionMessage.ID.make("msg_creator_collision")
      const { id: _, type, ...data } = encodeMessage({ id, type: "synthetic", text: "existing", time: { created } })
      yield* db
        .insert(SessionMessageTable)
        .values({ id, session_id: sessionID, type, seq: 0, time_created: 0, data })
        .run()

      const exit = yield* bus
        .publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID: id,
          agent: build,
          model,
          started: 0,
        })
        .pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      expect(
        yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, id)).get().pipe(Effect.orDie),
      ).toMatchObject({ type: "synthetic" })
    }),
  )

  it.effect("projects retry state and clears it at the next step or execution terminal", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const first = SessionMessage.ID.make("msg_retry_first")
      const second = SessionMessage.ID.make("msg_retry_second")
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: first,
        agent: build,
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.RetryScheduled, {
        sessionID,
        assistantMessageID: first,
        attempt: 2,
        at: 2_000,
        error: { type: "provider.transport", message: "Disconnected" },
      })

      const decode = (row: typeof SessionMessageTable.$inferSelect) =>
        Schema.decodeUnknownSync(SessionMessage.Info)({ ...row.data, id: row.id, type: row.type })
      const firstRow = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, first))
        .get()
        .pipe(Effect.orDie)
      const projected = firstRow ?? (yield* Effect.die(new Error("Missing retry projection")))
      expect(decode(projected)).toMatchObject({
        retry: { attempt: 2, at: DateTime.makeUnsafe(2_000), error: { type: "provider.transport" } },
      })

      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: second,
        agent: build,
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.RetryScheduled, {
        sessionID,
        assistantMessageID: second,
        attempt: 3,
        at: 6_000,
        error: { type: "provider.internal", message: "Unavailable" },
      })
      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown" })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(decode(rows[0])).not.toHaveProperty("retry")
      expect(decode(rows[1])).not.toHaveProperty("retry")
    }),
  )

  it.effect("does not infer restart continuation from lifecycle history", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const suspended = () =>
        db
          .select({ timeSuspended: SessionTable.time_suspended })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)

      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown" })
      expect((yield* suspended())?.timeSuspended).toBeNull()

      yield* bus.publish(SessionEvent.Execution.Started, { sessionID })
      expect((yield* suspended())?.timeSuspended).toBeNull()
    }),
  )

  it.effect("records each execution's start, including a resume after shutdown", () =>
    Effect.gen(function* () {
      const db = yield* seedSession({ time_created: 0, time_updated: 0 })
      const bus = yield* Bus.Service
      const times = () =>
        db
          .select({ busy: SessionTable.time_busy, idle: SessionTable.time_idle, updated: SessionTable.time_updated })
          .from(SessionTable)
          .get()
          .pipe(Effect.orDie)

      yield* TestClock.setTime(10)
      yield* bus.publish(SessionEvent.Execution.Started, { sessionID })
      expect(yield* times()).toEqual({ busy: 10, idle: null, updated: 0 })

      yield* TestClock.setTime(20)
      yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown" })
      yield* TestClock.setTime(30)
      yield* bus.publish(SessionEvent.Execution.Started, { sessionID })
      expect(yield* times()).toEqual({ busy: 30, idle: null, updated: 0 })

      yield* TestClock.setTime(40)
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      expect(yield* times()).toEqual({ busy: 30, idle: 40, updated: 0 })

      yield* TestClock.setTime(50)
      yield* bus.publish(SessionEvent.Execution.Started, { sessionID })
      expect(yield* times()).toEqual({ busy: 50, idle: 40, updated: 0 })
    }),
  )

  it.effect("updates only the newest incomplete assistant projection", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      yield* db
        .insert(SessionMessageTable)
        .values([
          assistantRow(SessionMessage.ID.make("msg_assistant_1"), 0),
          assistantRow(SessionMessage.ID.make("msg_assistant_2"), 1),
        ])
        .run()
        .pipe(Effect.orDie)

      const service = yield* Bus.Service
      const usageUpdated = yield* service
        .subscribe(SessionEvent.UsageUpdated)
        .pipe(Stream.runHead, Effect.forkScoped({ startImmediately: true }))
      yield* service.publish(SessionEvent.Step.Ended, {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("msg_assistant_2"),
        finish: "stop",
        cost: Money.USD.make(1.25),
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.id))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) =>
        Schema.decodeUnknownSync(SessionMessage.Info)({ ...row.data, id: row.id, type: row.type }),
      )
      expect(messages[0]).not.toHaveProperty("time.completed")
      expect(messages[1]).toMatchObject({
        type: "assistant",
        finish: "stop",
        cost: Money.USD.make(1.25),
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
        time: { completed: DateTime.makeUnsafe(0) },
      })
      expect(
        yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie),
      ).toMatchObject({
        cost: 1.25,
        tokens_input: 10,
        tokens_output: 4,
        tokens_reasoning: 2,
        tokens_cache_read: 3,
        tokens_cache_write: 1,
      })
      expect(Option.getOrThrow(yield* Fiber.join(usageUpdated)).data).toEqual({
        sessionID,
        cost: Money.USD.make(1.25),
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      })
    }),
  )

  it.effect("reads and replays native data stored under its pre-v2.1 names", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const store = yield* SessionStore.Service
      const bus = yield* Bus.Service
      const assistantID = SessionMessage.ID.make("msg_legacy_assistant")
      const {
        id: _,
        type: __,
        ...assistant
      } = encodeMessage(
        SessionMessage.Assistant.make({
          id: assistantID,
          type: "assistant",
          agent: build,
          model,
          content: [],
          time: { created },
        }),
      )
      const legacyAssistant = {
        ...assistant,
        providerState: { step: "kept" },
        content: [
          { type: "text", text: "hi", state: { signature: "text" } },
          { type: "reasoning", text: "thinking", state: { signature: "reasoning" } },
          {
            type: "tool",
            id: "call",
            name: "search",
            executed: true,
            providerState: { call: "kept" },
            providerResultState: { result: "kept" },
            state: { status: "completed", input: {}, content: [{ type: "text", text: "done" }] },
            time: { created: 0, ran: 0, completed: 0 },
          },
        ],
      }
      const legacyCompaction = {
        status: "completed",
        reason: "manual",
        summary: "summary",
        providerState: { compaction: "kept" },
        time: { created: 0 },
      }
      yield* db.run(sql`
        INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES
          (${assistantID}, ${sessionID}, 'assistant', 0, 0, 0, ${JSON.stringify(legacyAssistant)}),
          ('msg_legacy_compaction', ${sessionID}, 'compaction', 1, 0, 0, ${JSON.stringify(legacyCompaction)})
      `)
      const stored = [
        {
          id: Event.ID.make("evt_legacy_0"),
          type: "session.tool.called.1",
          data: { id: "call", input: {}, executed: true, state: { call: "kept" } },
        },
        {
          id: Event.ID.make("evt_legacy_1"),
          type: "session.tool.success.2",
          data: {
            id: "call",
            content: [{ type: "text", text: "done" }],
            executed: true,
            resultState: { result: "kept" },
          },
        },
      ].map((event, seq) => ({
        ...event,
        seq,
        created: 0,
        aggregateID: sessionID,
        data: { sessionID, assistantMessageID: assistantID, ...event.data },
      }))
      yield* db.run(sql`INSERT OR IGNORE INTO event_sequence (aggregate_id, seq) VALUES (${sessionID}, 1)`)
      for (const event of stored)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, created, type, data) VALUES (${event.id}, ${sessionID}, ${event.seq}, 0, ${event.type}, ${JSON.stringify(event.data)})`,
        )

      const [readAssistant, readCompaction] = yield* store.messages({ sessionID, order: "asc" })
      expect(readAssistant).toMatchObject({
        native: { step: "kept" },
        content: [
          { type: "text", native: { signature: "text" } },
          { type: "reasoning", native: { signature: "reasoning" } },
          { type: "tool", native: { call: "kept", result: "kept" } },
        ],
      })
      expect(readCompaction).toMatchObject({ native: { compaction: "kept" } })

      expect(
        (yield* Stream.runCollect(bus.log({ aggregateID: sessionID }))).filter((item) => !Bus.isSynced(item)),
      ).toMatchObject([
        { type: "session.tool.called", data: { native: { call: "kept" } } },
        { type: "session.tool.success", data: { native: { result: "kept" } } },
      ])

      // Re-delivering an event that is already stored in its legacy shape stays idempotent.
      yield* Effect.forEach(stored, (event) => bus.replay(event), { discard: true })

      // A legacy-shaped event replayed from elsewhere is projected and stored in the current shape.
      yield* bus.replay({
        id: Event.ID.make("evt_legacy_2"),
        type: "session.step.ended.1",
        seq: 2,
        created: 0,
        aggregateID: sessionID,
        data: {
          sessionID,
          assistantMessageID: assistantID,
          finish: "stop",
          providerState: { step: "replayed" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })
      const replayed = yield* db.get<{ data: string }>(sql`SELECT data FROM event WHERE id = 'evt_legacy_2'`)
      expect(JSON.parse(replayed?.data ?? "{}")).toMatchObject({ native: { step: "replayed" } })
      expect(JSON.parse(replayed?.data ?? "{}")).not.toHaveProperty("providerState")

      // Projecting onto the legacy row wrote it back in the current shape.
      const rewritten = JSON.parse(
        (yield* db.get<{ data: string }>(sql`SELECT data FROM session_message WHERE id = ${assistantID}`))?.data ??
          "{}",
      )
      expect(rewritten).not.toHaveProperty("providerState")
      expect(rewritten).toMatchObject({
        native: { step: "replayed" },
        content: [
          { type: "text", native: { signature: "text" } },
          { type: "reasoning", native: { signature: "reasoning" } },
          { type: "tool", native: { call: "kept", result: "kept" } },
        ],
      })
      expect(rewritten.content.map((part: Record<string, unknown>) => Object.keys(part).toSorted())).toEqual([
        ["native", "text", "type"],
        ["native", "text", "type"],
        ["executed", "id", "name", "native", "state", "time", "type"],
      ])
    }),
  )

  it.effect("merges tool result native data into the call's native data", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const assistantMessageID = SessionMessage.ID.make("msg_tools")
      yield* db.insert(SessionMessageTable).values(assistantRow(assistantMessageID, 0)).run().pipe(Effect.orDie)

      const service = yield* Bus.Service
      const call = (id: string) =>
        Effect.gen(function* () {
          yield* service.publish(SessionEvent.Tool.Input.Started, { sessionID, assistantMessageID, id, name: id })
          yield* service.publish(SessionEvent.Tool.Called, {
            sessionID,
            assistantMessageID,
            id,
            input: {},
            executed: true,
            native: { call: id },
          })
        })
      yield* call("succeeded")
      yield* service.publish(SessionEvent.Tool.Success, {
        sessionID,
        assistantMessageID,
        id: "succeeded",
        content: [{ type: "text", text: "done" }],
        executed: true,
        native: { result: "succeeded" },
      })
      yield* call("failed")
      yield* service.publish(SessionEvent.Tool.Failed, {
        sessionID,
        assistantMessageID,
        id: "failed",
        error: { type: "tool.execution", message: "failed" },
        executed: true,
      })

      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.data).toMatchObject({
        content: [
          { id: "succeeded", native: { call: "succeeded", result: "succeeded" }, state: { status: "completed" } },
          { id: "failed", native: { call: "failed" }, state: { status: "error" } },
        ],
      })
    }),
  )

  it.effect("projects ended and failed step terminal state", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const endedID = SessionMessage.ID.make("msg_ended")
      const failedID = SessionMessage.ID.make("msg_failed")
      yield* db
        .insert(SessionMessageTable)
        .values([assistantRow(endedID, 0), assistantRow(failedID, 1)])
        .run()
        .pipe(Effect.orDie)

      const service = yield* Bus.Service
      yield* service.publish(SessionEvent.Step.Streamed, {
        sessionID,
        assistantMessageID: endedID,
      })
      yield* service.publish(SessionEvent.Step.Ended, {
        sessionID,
        assistantMessageID: endedID,
        finish: "stop",
        rawFinish: "stop_sequence",
        native: { response: "ended" },
        cost: Money.USD.make(1),
        tokens: { input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
        snapshot: Snapshot.ID.make("snap_ended"),
        files: [RelativePath.make("src/ended.ts")],
      })
      yield* service.publish(SessionEvent.Step.Failed, {
        sessionID,
        assistantMessageID: failedID,
        finish: "content-filter",
        rawFinish: "blocked",
        native: { response: "failed" },
        error: { type: "provider.invalid-request", message: "Failed" },
        snapshot: Snapshot.ID.make("snap_failed"),
        files: [RelativePath.make("src/failed.ts")],
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) =>
        Schema.decodeUnknownSync(SessionMessage.Info)({ ...row.data, id: row.id, type: row.type }),
      )
      expect(messages[0]).toMatchObject({
        type: "assistant",
        finish: "stop",
        rawFinish: "stop_sequence",
        native: { response: "ended" },
        cost: Money.USD.make(1),
        tokens: { input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
        snapshot: { end: "snap_ended", files: ["src/ended.ts"] },
        time: { streamed: created, completed: created },
      })
      expect(messages[1]).toMatchObject({
        type: "assistant",
        finish: "content-filter",
        rawFinish: "blocked",
        native: { response: "failed" },
        error: { type: "provider.invalid-request", message: "Failed" },
        snapshot: { end: "snap_failed", files: ["src/failed.ts"] },
        time: { completed: created },
      })
    }),
  )

  it.effect("does not revive a stale incomplete assistant projection", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      yield* db
        .insert(SessionMessageTable)
        .values([
          assistantRow(SessionMessage.ID.make("msg_assistant_stale"), 0),
          assistantRow(SessionMessage.ID.make("msg_assistant_completed"), 1, {
            created: DateTime.makeUnsafe(1),
            completed: DateTime.makeUnsafe(2),
          }),
        ])
        .run()
        .pipe(Effect.orDie)

      const service = yield* Bus.Service
      yield* service.publish(SessionEvent.Text.Started, {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("msg_assistant_completed"),
        ordinal: 0,
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.id))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) =>
        Schema.decodeUnknownSync(SessionMessage.Info)({ ...row.data, id: row.id, type: row.type }),
      )
      expect(messages).toEqual([
        SessionMessage.Assistant.make({
          id: SessionMessage.ID.make("msg_assistant_completed"),
          type: "assistant",
          agent: build,
          model,
          content: [SessionMessage.AssistantText.make({ type: "text", text: "" })],
          time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
        }),
        SessionMessage.Assistant.make({
          id: SessionMessage.ID.make("msg_assistant_stale"),
          type: "assistant",
          agent: build,
          model,
          content: [],
          time: { created },
        }),
      ])
    }),
  )

  it.effect("bumps session time_updated on step lifecycle events", () =>
    Effect.gen(function* () {
      const db = yield* seedSession({ time_created: 0, time_updated: 0 })
      const bus = yield* Bus.Service
      const updated = () =>
        db.select({ time_updated: SessionTable.time_updated }).from(SessionTable).get().pipe(Effect.orDie)
      const first = SessionMessage.ID.make("msg_touch_first")
      const second = SessionMessage.ID.make("msg_touch_second")

      yield* TestClock.setTime(5)
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: first,
        agent: build,
        model,
        started: 5,
      })
      expect(yield* updated()).toEqual({ time_updated: 5 })

      yield* TestClock.setTime(9)
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID,
        assistantMessageID: first,
        finish: "stop",
        cost: Money.USD.make(0),
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      expect(yield* updated()).toEqual({ time_updated: 9 })

      yield* TestClock.setTime(12)
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: second,
        agent: build,
        model,
        started: 12,
      })
      yield* TestClock.setTime(15)
      yield* bus.publish(SessionEvent.Step.Failed, {
        sessionID,
        assistantMessageID: second,
        error: { type: "provider.invalid-request", message: "Failed" },
      })
      expect(yield* updated()).toEqual({ time_updated: 15 })
    }),
  )

  it.effect("hydrates media:<hash> refs on message and inbox reads", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      const store = yield* SessionStore.Service

      const rawBytes = Buffer.from("externalized-media-payload")
      const base64 = rawBytes.toString("base64")
      const hash = "a".repeat(64)
      const uri = `media:${hash}`
      // Only media:<hash> is a ref; a plain path that looks like a media URL is left alone.
      const pathUri = `/api/media/${hash}`

      yield* db
        .insert(BlobTable)
        .values({
          hash,
          mime: "application/pdf",
          bytes: rawBytes.byteLength,
          width: null,
          height: null,
          data: rawBytes,
        })
        .run()
        .pipe(Effect.orDie)

      const userID = SessionMessage.ID.make("msg_read_user")
      const assistantID = SessionMessage.ID.make("msg_read_assistant")
      const inboxID = SessionMessage.ID.make("msg_read_inbox")

      yield* db
        .insert(SessionMessageTable)
        .values([
          {
            id: userID,
            session_id: sessionID,
            type: "user",
            seq: 1,
            time_created: 1,
            data: {
              text: "user attachment",
              files: [SessionStored.FileRef.make({ uri, mime: "application/pdf", source: { type: "inline" }, name: "spec.pdf" })],
              time: { created: 1 },
            },
          },
          {
            id: assistantID,
            session_id: sessionID,
            type: "assistant",
            seq: 2,
            time_created: 2,
            data: {
              agent: build,
              model,
              content: [
                {
                  type: "tool",
                  id: "call_1",
                  name: "read",
                  executed: true,
                  state: {
                    status: "completed",
                    input: { path: "spec.pdf" },
                    content: [
                      SessionStored.ToolFileRef.make({ type: "file", uri, mime: "application/pdf", name: "spec.pdf" }),
                      { type: "file", uri: pathUri, mime: "application/pdf", name: "path.pdf" },
                    ],
                  },
                  time: { created: 2, ran: 2, completed: 2 },
                },
              ],
              time: { created: 2, completed: 2 },
            },
          },
        ])
        .run()
        .pipe(Effect.orDie)

      yield* db
        .insert(SessionInboxTable)
        .values({
          id: inboxID,
          session_id: sessionID,
          type: "user",
          payload: {
            text: "queued attachment",
            files: [SessionStored.FileRef.make({ uri, mime: "application/pdf", source: { type: "inline" }, name: "queued.pdf" })],
          },
          delivery: "queue",
          enqueued_seq: 3,
          time_created: 3,
        })
        .run()
        .pipe(Effect.orDie)

      const messages = yield* store.messages({ sessionID, order: "asc" })
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({
        id: userID,
        type: "user",
        files: [{ data: base64, mime: "application/pdf", source: { type: "inline" }, name: "spec.pdf" }],
      })
      expect(messages[1]).toMatchObject({
        id: assistantID,
        type: "assistant",
        content: [
          {
            type: "tool",
            state: {
              status: "completed",
              content: [
                { type: "file", uri: `data:application/pdf;base64,${base64}`, mime: "application/pdf", name: "spec.pdf" },
                { type: "file", uri: pathUri, mime: "application/pdf", name: "path.pdf" },
              ],
            },
          },
        ],
      })

      expect((yield* store.message(userID))?.message).toEqual(messages[0]!)
      expect(yield* store.context(sessionID)).toEqual(messages)

      const listedInbox = yield* inbox.list(sessionID)
      expect(listedInbox).toHaveLength(1)
      expect(listedInbox[0]).toMatchObject({
        id: inboxID,
        type: "user",
        payload: {
          text: "queued attachment",
          files: [{ data: base64, mime: "application/pdf", source: { type: "inline" }, name: "queued.pdf" }],
        },
      })

      expect(yield* SessionHistory.firstUserMessage(db, sessionID)).toEqual({ id: userID, text: "user attachment" })
      expect(yield* SessionInbox.nextPromotable(db, sessionID, "input")).toEqual({
        id: inboxID,
        type: "user",
        delivery: "queue",
      })

      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID })
      expect((yield* store.message(inboxID))?.message).toMatchObject({
        id: inboxID,
        type: "user",
        files: [{ data: base64, mime: "application/pdf", source: { type: "inline" }, name: "queued.pdf" }],
      })
      // Delivery keeps the ref in the stored row instead of writing the bytes back inline.
      const delivered = yield* db
        .select({ data: SessionMessageTable.data })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, inboxID))
        .get()
        .pipe(Effect.orDie)
      expect(delivered?.data).toMatchObject({
        text: "queued attachment",
        files: [{ uri, mime: "application/pdf", source: { type: "inline" }, name: "queued.pdf" }],
      })
      expect(JSON.stringify(delivered?.data)).not.toContain(base64)
    }),
  )

  it.effect("replaces refs to missing blobs with an unavailable placeholder on read", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const inbox = yield* SessionInbox.Service
      const store = yield* SessionStore.Service
      const hash = "b".repeat(64)
      const userID = SessionMessage.ID.make("msg_missing_user")
      const assistantID = SessionMessage.ID.make("msg_missing_assistant")
      const inboxID = SessionMessage.ID.make("msg_missing_inbox")
      const placeholder = Buffer.from("[media unavailable: shot.png (image/png)]").toString("base64")
      const ref = SessionStored.FileRef.make({
        uri: `media:${hash}`,
        mime: "image/png",
        source: { type: "inline" },
        name: "shot.png",
      })

      yield* db
        .insert(SessionMessageTable)
        .values([
          {
            id: userID,
            session_id: sessionID,
            type: "user",
            seq: 1,
            time_created: 1,
            data: {
              text: "gone",
              files: [ref],
              time: { created: 1 },
            },
          },
          {
            id: assistantID,
            session_id: sessionID,
            type: "assistant",
            seq: 2,
            time_created: 2,
            data: {
              agent: build,
              model,
              content: [
                {
                  type: "tool",
                  id: "call_1",
                  name: "read",
                  executed: true,
                  state: {
                    status: "completed",
                    input: { path: "shot.png" },
                    content: [SessionStored.ToolFileRef.make({ type: "file", uri: ref.uri, mime: "image/png" })],
                  },
                  time: { created: 2, ran: 2, completed: 2 },
                },
              ],
              time: { created: 2, completed: 2 },
            },
          },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionInboxTable)
        .values({
          id: inboxID,
          session_id: sessionID,
          type: "user",
          payload: { text: "queued", files: [ref] },
          delivery: "queue",
          enqueued_seq: 3,
          time_created: 3,
        })
        .run()
        .pipe(Effect.orDie)

      const messages = yield* store.messages({ sessionID, order: "asc" })
      expect(messages[0]).toMatchObject({
        files: [{ data: placeholder, mime: "text/plain", source: { type: "inline" }, name: "shot.png" }],
      })
      expect(messages[1]).toMatchObject({
        content: [{ state: { content: [{ type: "text", text: "[media unavailable: image/png]" }] } }],
      })
      expect(yield* store.context(sessionID)).toEqual(messages)
      const listed = yield* inbox.list(sessionID)
      expect(listed[0]).toMatchObject({ payload: { files: [{ data: placeholder, mime: "text/plain" }] } })
      expect(JSON.stringify([messages, listed])).not.toContain(hash)
    }),
  )

  it.effect("names ref attachments in kept text without reading their blobs", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const store = yield* SessionStore.Service
      const userID = SessionMessage.ID.make("msg_kept_user")
      const compactionID = SessionMessage.ID.make("msg_kept_compaction")
      const { id: _, type: __, ...compaction } = encodeMessage(
        SessionMessage.CompactionCompleted.make({
          id: compactionID,
          type: "compaction",
          status: "completed",
          reason: "manual",
          summary: "summary",
          metadata: { keepID: userID },
          time: { created },
        }),
      )
      yield* db
        .insert(SessionMessageTable)
        .values([
          {
            id: userID,
            session_id: sessionID,
            type: "user",
            seq: 1,
            time_created: 1,
            data: {
              text: "look",
              files: [
                SessionStored.FileRef.make({
                  uri: `media:${"c".repeat(64)}`,
                  mime: "image/png",
                  source: { type: "inline" },
                  name: "shot.png",
                }),
              ],
              time: { created: 1 },
            },
          },
          { id: compactionID, session_id: sessionID, type: "compaction", seq: 2, time_created: 2, data: compaction },
        ])
        .run()
        .pipe(Effect.orDie)

      // The blob is missing, so a hydrated read would name a text/plain placeholder instead.
      expect(yield* store.context(sessionID)).toMatchObject([
        { id: compactionID, metadata: { recent: "[User]: look\n[Attached image/png: shot.png]" } },
      ])
    }),
  )

  it.effect("keeps media inline unless experimental.media_blob is on", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const inbox = yield* SessionInbox.Service
      const id = SessionMessage.ID.make("msg_media_inline")
      yield* inbox.admit({
        id,
        sessionID,
        item: { type: "user", payload: { text: "inline", files: [attachment("shot.png")] }, delivery: "queue" },
      })

      const row = yield* db
        .select()
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.id, id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.payload).toEqual({ text: "inline", files: [attachment("shot.png")] })
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toEqual([])
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toEqual([])
    }),
  )

  it.effect("stores media once and refs it from inbox, message, and tool rows when experimental.media_blob is on", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      const store = yield* SessionStore.Service
      const hash = SessionBlob.hashBytes(png)
      const uri = SessionStored.ref(hash)
      const id = SessionMessage.ID.make("msg_media_user")
      const files = [attachment("shot.png"), attachment("copy.png")]
      const refs = [
        { mime: "image/png", source: { type: "inline" }, name: "shot.png", uri },
        { mime: "image/png", source: { type: "inline" }, name: "copy.png", uri },
      ]

      yield* inbox.admit({ id, sessionID, item: { type: "user", payload: { text: "look", files }, delivery: "steer" } })
      const queued = yield* db
        .select()
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.id, id))
        .get()
        .pipe(Effect.orDie)
      expect(queued?.payload).toEqual({ text: "look", files: refs })
      expect(yield* inbox.list(sessionID)).toMatchObject([{ id, payload: { text: "look", files } }])

      const delivered = yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: id })
      const message = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, id))
        .get()
        .pipe(Effect.orDie)
      expect(message?.data).toMatchObject({ text: "look", files: refs })
      expect((yield* store.message(id))?.message).toMatchObject({ type: "user", files })

      const assistantMessageID = SessionMessage.ID.make("msg_media_tool")
      yield* db.insert(SessionMessageTable).values(assistantRow(assistantMessageID, 0)).run().pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.Tool.Input.Started, { sessionID, assistantMessageID, id: "shot", name: "shot" })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        id: "shot",
        input: {},
        executed: true,
      })
      yield* bus.publish(SessionEvent.Tool.Success, {
        sessionID,
        assistantMessageID,
        id: "shot",
        content: [{ type: "file", uri: `data:image/png;base64,${png.toString("base64")}`, mime: "image/png" }],
        executed: true,
      })
      const tool = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .get()
        .pipe(Effect.orDie)
      expect(tool?.data).toMatchObject({
        content: [{ state: { status: "completed", content: [{ type: "file", uri, mime: "image/png" }] } }],
      })
      expect((yield* store.message(assistantMessageID))?.message).toMatchObject({
        content: [
          {
            state: {
              content: [{ type: "file", uri: `data:image/png;base64,${png.toString("base64")}`, mime: "image/png" }],
            },
          },
        ],
      })

      expect(
        yield* db
          .select({
            hash: BlobTable.hash,
            mime: BlobTable.mime,
            bytes: BlobTable.bytes,
          })
          .from(BlobTable)
          .all()
          .pipe(Effect.orDie),
      ).toEqual([{ hash, mime: "image/png", bytes: png.byteLength }])
      expect(
        yield* db
          .select({ message: BlobRefTable.message_id, hash: BlobRefTable.hash, seq: BlobRefTable.seq })
          .from(BlobRefTable)
          .orderBy(asc(BlobRefTable.seq))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([
        { message: assistantMessageID, hash, seq: 0 },
        { message: id, hash, seq: delivered.durable?.seq },
      ])
    }).pipe(Effect.provide(mediaBlob)),
  )

  it.effect("deletes a cancelled inbox row's blob refs and blobs", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const inbox = yield* SessionInbox.Service
      const id = SessionMessage.ID.make("msg_media_cancel")
      yield* inbox.admit({
        id,
        sessionID,
        item: { type: "user", payload: { text: "later", files: [attachment("shot.png")] }, delivery: "queue" },
      })
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toHaveLength(1)
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toHaveLength(1)

      yield* inbox.cancel({ id, sessionID })
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toEqual([])
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toEqual([])
    }).pipe(Effect.provide(mediaBlob)),
  )

  it.effect("deletes reverted messages' blob refs and the blobs only they referenced", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      const text = Buffer.from("reverted attachment")
      const deliver = (id: SessionMessage.ID, files: ReturnType<typeof attachment>[]) =>
        Effect.gen(function* () {
          yield* inbox.admit({ id, sessionID, item: { type: "user", payload: { text: id, files }, delivery: "steer" } })
          yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: id })
        })
      const kept = SessionMessage.ID.make("msg_media_kept")
      const reverted = SessionMessage.ID.make("msg_media_reverted")
      const shared = SessionMessage.ID.make("msg_media_shared")
      yield* deliver(kept, [attachment("shot.png")])
      yield* deliver(reverted, [attachment("notes.txt", text, "text/plain")])
      yield* deliver(shared, [attachment("again.png")])
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toHaveLength(3)

      yield* bus.publish(SessionEvent.RevertEvent.Committed, { sessionID, to: reverted })
      expect(
        yield* db
          .select({ message: BlobRefTable.message_id, hash: BlobRefTable.hash })
          .from(BlobRefTable)
          .all()
          .pipe(Effect.orDie),
      ).toEqual([{ message: kept, hash: SessionBlob.hashBytes(png) }])
      expect(yield* db.select({ hash: BlobTable.hash }).from(BlobTable).all().pipe(Effect.orDie)).toEqual([
        { hash: SessionBlob.hashBytes(png) },
      ])
    }).pipe(Effect.provide(mediaBlob)),
  )

  it.effect("keeps a blob while a fork references it and deletes it with the last session", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      const id = SessionMessage.ID.make("msg_media_forked")
      const childID = Session.ID.make("ses_media_fork")
      yield* inbox.admit({
        id,
        sessionID,
        item: { type: "user", payload: { text: "fork me", files: [attachment("shot.png")] }, delivery: "steer" },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: id })
      yield* bus.publish(SessionEvent.Forked, {
        sessionID: childID,
        parentID: sessionID,
        boundary: { type: "through", messageID: id },
      })
      expect(
        yield* db.select({ session: BlobRefTable.session_id }).from(BlobRefTable).all().pipe(Effect.orDie),
      ).toEqual(expect.arrayContaining([{ session: sessionID }, { session: childID }]))

      yield* bus.publish(SessionEvent.Deleted, { sessionID })
      expect(
        yield* db.select({ session: BlobRefTable.session_id }).from(BlobRefTable).all().pipe(Effect.orDie),
      ).toEqual([{ session: childID }])
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toHaveLength(1)

      yield* bus.publish(SessionEvent.Deleted, { sessionID: childID })
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toEqual([])
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toEqual([])
    }).pipe(Effect.provide(mediaBlob)),
  )

  it.effect("releases a tool's blob when a content update drops its ref", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const assistantMessageID = SessionMessage.ID.make("msg_media_rewritten")
      yield* db.insert(SessionMessageTable).values(assistantRow(assistantMessageID, 0)).run().pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.Tool.Input.Started, { sessionID, assistantMessageID, id: "shot", name: "shot" })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        id: "shot",
        input: {},
        executed: true,
      })
      yield* bus.publish(SessionEvent.Tool.Success, {
        sessionID,
        assistantMessageID,
        id: "shot",
        content: [{ type: "file", uri: `data:image/png;base64,${png.toString("base64")}`, mime: "image/png" }],
        executed: true,
      })
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toHaveLength(1)
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toHaveLength(1)

      yield* bus.publish(SessionEvent.MessageContentUpdated, { sessionID, messageID: assistantMessageID, content: [] })
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toEqual([])
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toEqual([])
    }).pipe(Effect.provide(mediaBlob)),
  )

  // A newer release wrote this in-progress message's parts as session_part rows, then the user rolled back.
  it.effect("keeps projecting into session_part rows a newer release wrote for an in-progress message", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const assistantMessageID = SessionMessage.ID.make("msg_rolled_back")
      yield* db.insert(SessionMessageTable).values(assistantRow(assistantMessageID, 0)).run().pipe(Effect.orDie)
      yield* db
        .insert(SessionPartTable)
        .values([
          {
            message_id: assistantMessageID,
            session_id: sessionID,
            ordinal: 0,
            type: "text",
            call_id: null,
            time_created: 1,
            time_updated: 1,
            data: { type: "text", text: "before rollback" },
          },
          {
            message_id: assistantMessageID,
            session_id: sessionID,
            ordinal: 1,
            type: "tool",
            call_id: "call_a",
            time_created: 1,
            time_updated: 1,
            data: {
              type: "tool",
              id: "call_a",
              name: "read",
              executed: true,
              state: { status: "running", input: { path: "a.ts" }, metadata: {} },
              time: { created: 1, ran: 1 },
            },
          },
        ])
        .run()
        .pipe(Effect.orDie)

      yield* TestClock.setTime(5)
      yield* bus.publish(SessionEvent.Tool.Success, {
        sessionID,
        assistantMessageID,
        id: "call_a",
        content: [{ type: "text", text: "export {}" }],
        executed: true,
      })
      yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 1 })
      yield* bus.publish(SessionEvent.Text.Ended, { sessionID, assistantMessageID, ordinal: 1, text: "after rollback" })
      yield* bus.publish(SessionEvent.Tool.Input.Started, { sessionID, assistantMessageID, id: "call_b", name: "grep" })

      expect((yield* store.message(assistantMessageID))?.message).toMatchObject({
        content: [
          { type: "text", text: "before rollback" },
          { type: "tool", id: "call_a", state: { status: "completed", content: [{ type: "text", text: "export {}" }] } },
          { type: "text", text: "after rollback" },
          { type: "tool", id: "call_b", state: { status: "streaming" } },
        ],
      })
      const row = yield* db
        .select({ data: SessionMessageTable.data })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.data).toMatchObject({ content: [] })
      expect(
        yield* db
          .select({
            ordinal: SessionPartTable.ordinal,
            type: SessionPartTable.type,
            call: SessionPartTable.call_id,
            updated: SessionPartTable.time_updated,
          })
          .from(SessionPartTable)
          .where(eq(SessionPartTable.message_id, assistantMessageID))
          .orderBy(asc(SessionPartTable.ordinal))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([
        { ordinal: 0, type: "text", call: null, updated: 1 },
        { ordinal: 1, type: "tool", call: "call_a", updated: 5 },
        { ordinal: 2, type: "text", call: null, updated: 5 },
        { ordinal: 3, type: "tool", call: "call_b", updated: 5 },
      ])
    }),
  )

  it.effect("forks a settled message whose parts are in session_part with its content", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const messageID = SessionMessage.ID.make("msg_split_settled")
      const childID = Session.ID.make("ses_split_fork")
      yield* db
        .insert(SessionMessageTable)
        .values(assistantRow(messageID, 0, { created, completed: created }))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionPartTable)
        .values({
          message_id: messageID,
          session_id: sessionID,
          ordinal: 0,
          type: "text",
          call_id: null,
          time_created: 0,
          time_updated: 0,
          data: { type: "text", text: "split answer" },
        })
        .run()
        .pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.Forked, {
        sessionID: childID,
        parentID: sessionID,
        boundary: { type: "through", messageID },
      })
      expect(yield* store.messages({ sessionID: childID, order: "asc" })).toMatchObject([
        { type: "assistant", content: [{ type: "text", text: "split answer" }] },
      ])
    }),
  )

  it.effect("stores a fork's copies of inline parent media as blobs and leaves the parent's rows inline", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const childID = Session.ID.make("ses_media_inline_fork")
      const boundary = yield* seedInlineMedia(db)
      const parentRows = yield* messageRows(db, sessionID)
      const parentParts = yield* db.select().from(SessionPartTable).all().pipe(Effect.orDie)
      const parentMessages = yield* store.messages({ sessionID, order: "asc" })

      yield* bus.publish(SessionEvent.Forked, {
        sessionID: childID,
        parentID: sessionID,
        boundary: { type: "through", messageID: boundary },
      })

      const hash = SessionBlob.hashBytes(png)
      const uri = SessionStored.ref(hash)
      const childRows = yield* messageRows(db, childID)
      expect(childRows.map((row) => row.data)).toMatchObject([
        { files: [{ uri, mime: "image/png", name: "shot.png" }] },
        { content: [{ type: "tool", state: { content: [{ type: "file", uri, mime: "image/png" }] } }] },
      ])
      expect(JSON.stringify(childRows)).not.toContain(png.toString("base64"))
      expect(yield* messageRows(db, sessionID)).toEqual(parentRows)
      expect(yield* db.select().from(SessionPartTable).all().pipe(Effect.orDie)).toEqual(parentParts)
      expect(yield* db.select({ hash: BlobTable.hash }).from(BlobTable).all().pipe(Effect.orDie)).toEqual([{ hash }])
      expect(
        yield* db
          .select({ session: BlobRefTable.session_id, message: BlobRefTable.message_id, hash: BlobRefTable.hash })
          .from(BlobRefTable)
          .orderBy(asc(BlobRefTable.seq))
          .all()
          .pipe(Effect.orDie),
      ).toEqual(childRows.map((row) => ({ session: childID, message: row.id, hash })))

      // The child owns its blob, so it reads the same with the parent gone.
      yield* bus.publish(SessionEvent.Deleted, { sessionID })
      expect(yield* messageRows(db, sessionID)).toEqual([])
      expect(withoutIDs(yield* store.messages({ sessionID: childID, order: "asc" }))).toEqual(
        withoutIDs(parentMessages),
      )
    }).pipe(Effect.provideService(SessionBlob.ForkMedia, true)),
  )

  it.effect("copies inline parent media inline into a fork unless the parent's location stores media as blobs", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const childID = Session.ID.make("ses_media_inline_fork_off")
      const boundary = yield* seedInlineMedia(db)
      const parentRows = yield* messageRows(db, sessionID)

      yield* bus.publish(SessionEvent.Forked, {
        sessionID: childID,
        parentID: sessionID,
        boundary: { type: "through", messageID: boundary },
      })

      const childRows = yield* messageRows(db, childID)
      expect(childRows.map((row) => row.data)).toEqual(
        (yield* SessionHistory.withParts(db, parentRows)).map((row) => row.data),
      )
      expect(yield* db.select().from(BlobTable).all().pipe(Effect.orDie)).toEqual([])
      expect(yield* db.select().from(BlobRefTable).all().pipe(Effect.orDie)).toEqual([])
      expect(withoutIDs(yield* store.messages({ sessionID: childID, order: "asc" }))).toEqual(
        withoutIDs(yield* store.messages({ sessionID, order: "asc" })),
      )
      // The caller's own config doesn't decide: Session.fork sets ForkMedia from the parent's location.
    }).pipe(Effect.provide(mediaBlob)),
  )
})

const messageRows = (db: Database.Interface["db"], session: Session.ID) =>
  db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.session_id, session))
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)

const withoutIDs = (messages: ReadonlyArray<SessionMessage.Info>) => messages.map(({ id: _, ...message }) => message)

/** A parent written before media blobs: an inline user file, and a tool screenshot in a session_part row. */
const seedInlineMedia = Effect.fnUntraced(function* (db: Database.Interface["db"]) {
  const userID = SessionMessage.ID.make("msg_inline_user")
  const assistantID = SessionMessage.ID.make("msg_inline_assistant")
  yield* db
    .insert(SessionMessageTable)
    .values([
      {
        id: userID,
        session_id: sessionID,
        type: "user",
        seq: 1,
        time_created: 1,
        data: { text: "look", files: [attachment("shot.png")], time: { created: 1 } },
      },
      assistantRow(assistantID, 2, { created, completed: created }),
    ])
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionPartTable)
    .values({
      message_id: assistantID,
      session_id: sessionID,
      ordinal: 0,
      type: "tool",
      call_id: "call_shot",
      time_created: 2,
      time_updated: 2,
      data: {
        type: "tool",
        id: "call_shot",
        name: "screenshot",
        executed: true,
        state: {
          status: "completed",
          input: {},
          content: [{ type: "file", uri: `data:image/png;base64,${png.toString("base64")}`, mime: "image/png" }],
        },
        time: { created: 2, ran: 2, completed: 2 },
      },
    })
    .run()
    .pipe(Effect.orDie)
  return assistantID
})
