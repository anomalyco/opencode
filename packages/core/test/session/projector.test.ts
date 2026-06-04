import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { eq, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { ToolOutput } from "@opencode-ai/core/tool-output"

const tmp = new Array<string>()
const sessionID = SessionSchema.ID.make("ses_projector")
const model = {
  id: ModelV2.ID.make("model"),
  providerID: ProviderV2.ID.make("provider"),
}

afterEach(async () => {
  await Promise.all(tmp.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeDbPath() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-projector-test-"))
  tmp.push(dir)
  return join(dir, "projector.db")
}

function layer(filename: string) {
  return SessionProjector.layer.pipe(
    Layer.provideMerge(EventV2.layer),
    Layer.provideMerge(Database.layerFromPath(filename)),
  )
}

function run<A, E>(filename: string, effect: Effect.Effect<A, E, Database.Service | EventV2.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer(filename)), Effect.scoped))
}

function eventID(suffix: string) {
  return EventV2.ID.make(`evt_${suffix}`)
}

function at(millis: number) {
  return DateTime.makeUnsafe(millis)
}

function serialized(event: EventV2.Payload, seq: number): EventV2.SerializedEvent {
  return {
    id: event.id,
    type: EventV2.versionedType(event.type, event.version ?? 1),
    seq,
    aggregateID: sessionID,
    data: EventV2.encodeKnownPayload(event).data,
  }
}

function seedSession() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.run(sql`
      INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes)
      VALUES ('proj_projector', '/tmp/projector', 'projector', 1, 1, '[]')
    `)
    yield* db.run(sql`
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES (${sessionID}, 'proj_projector', 'projector', '/tmp/projector', 'projector', 'test', 1, 1)
    `)
  })
}

function readMessages() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db.select().from(SessionMessageTable).all().pipe(Effect.orDie)
    return rows
      .sort((left, right) => left.time_created - right.time_created)
      .map((row) => Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }))
  })
}

function resetStoredEvents() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, sessionID)).run().pipe(Effect.orDie)
    yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).run().pipe(Effect.orDie)
  })
}

function publishTranscript() {
  return Effect.gen(function* () {
    const events = yield* EventV2.Service
    const prompted = yield* events.publish(
      SessionEvent.Prompted,
      { sessionID, timestamp: at(10), prompt: new Prompt({ text: "hello", files: [], agents: [], references: [] }) },
      { id: eventID("prompted") },
    )
    const stepStarted = yield* events.publish(
      SessionEvent.Step.Started,
      { sessionID, timestamp: at(20), agent: "build", model, snapshot: "start" },
      { id: eventID("assistant") },
    )
    const textStarted = yield* events.publish(
      SessionEvent.Text.Started,
      { sessionID, timestamp: at(30) },
      { id: eventID("text_started") },
    )
    const textDelta = yield* events.publish(
      SessionEvent.Text.Delta,
      { sessionID, timestamp: at(31), delta: "ignored partial" },
      { id: eventID("text_delta") },
    )
    const textEnded = yield* events.publish(
      SessionEvent.Text.Ended,
      { sessionID, timestamp: at(40), text: "hello assistant" },
      { id: eventID("text_ended") },
    )
    const toolStarted = yield* events.publish(
      SessionEvent.Tool.Input.Started,
      { sessionID, timestamp: at(50), callID: "call_1", name: "bash" },
      { id: eventID("tool_started") },
    )
    const toolCalled = yield* events.publish(
      SessionEvent.Tool.Called,
      {
        sessionID,
        timestamp: at(60),
        callID: "call_1",
        tool: "bash",
        input: { command: "pwd" },
        provider: { executed: true },
      },
      { id: eventID("tool_called") },
    )
    const toolSuccess = yield* events.publish(
      SessionEvent.Tool.Success,
      {
        sessionID,
        timestamp: at(70),
        callID: "call_1",
        structured: {},
        content: [
          new ToolOutput.TextContent({ type: "text", text: "/tmp" }),
          new ToolOutput.FileContent({
            type: "file",
            uri: "data:image/png;base64,AAAA",
            mime: "image/png",
            name: "image.png",
          }),
        ],
        provider: { executed: true, metadata: { status: "done" } },
      },
      { id: eventID("tool_success") },
    )
    const stepEnded = yield* events.publish(
      SessionEvent.Step.Ended,
      {
        sessionID,
        timestamp: at(80),
        finish: "stop",
        cost: 0.25,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        snapshot: "end",
      },
      { id: eventID("step_ended") },
    )
    const compactionStarted = yield* events.publish(
      SessionEvent.Compaction.Started,
      { sessionID, timestamp: at(90), reason: "manual" },
      { id: eventID("compaction_started") },
    )
    const compactionEnded = yield* events.publish(
      SessionEvent.Compaction.Ended,
      { sessionID, timestamp: at(100), text: "final summary", include: "keep" },
      { id: eventID("compaction_ended") },
    )
    return [
      prompted,
      stepStarted,
      textStarted,
      textDelta,
      textEnded,
      toolStarted,
      toolCalled,
      toolSuccess,
      stepEnded,
      compactionStarted,
      compactionEnded,
    ]
  })
}

function retryError() {
  return {
    message: "provider returned 429",
    statusCode: 429,
    isRetryable: true,
    responseHeaders: { "retry-after": "1" },
    responseBody: "rate limited",
    metadata: { provider: "test" },
  }
}

function retryTranscriptEvents() {
  return Effect.gen(function* () {
    const events = yield* EventV2.Service
    const stepStarted = yield* events.publish(
      SessionEvent.Step.Started,
      { sessionID, timestamp: at(10), agent: "build", model, snapshot: "before-retry" },
      { id: eventID("retry_assistant") },
    )
    const retried = yield* events.publish(
      SessionEvent.Retried,
      { sessionID, timestamp: at(20), attempt: 2, error: retryError() },
      { id: eventID("retried") },
    )
    return [stepStarted, retried]
  })
}

function assertNoLegacyIDs(value: unknown) {
  const strings: string[] = []
  const visit = (current: unknown) => {
    if (typeof current === "string") {
      strings.push(current)
      return
    }
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (current && typeof current === "object") Object.values(current).forEach(visit)
  }
  visit(value)
  for (const string of strings) {
    expect(string.startsWith("msg_")).toBe(false)
    expect(string.startsWith("prt_")).toBe(false)
  }
}

describe("SessionProjector", () => {
  test("projects session.next transcript events into v2 messages", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* publishTranscript()

        const messages = yield* readMessages()
        expect(messages.map((message) => message.type)).toEqual(["user", "assistant", "compaction"])
        expect(messages[0]).toMatchObject({ id: eventID("prompted"), type: "user", text: "hello" })
        expect(messages[2]).toMatchObject({
          id: eventID("compaction_started"),
          type: "compaction",
          summary: "final summary",
          include: "keep",
        })

        const assistant = messages[1]
        expect(assistant?.type).toBe("assistant")
        if (assistant?.type !== "assistant") return
        expect(assistant.id).toBe(eventID("assistant"))
        expect(assistant.finish).toBe("stop")
        expect(assistant.snapshot).toEqual({ start: "start", end: "end" })
        expect(assistant.content).toMatchObject([
          { type: "text", id: eventID("text_started"), text: "hello assistant" },
          { type: "tool", id: eventID("tool_started"), callID: "call_1", state: { status: "completed" } },
        ])
        const tool = assistant.content[1]
        expect(tool?.type).toBe("tool")
        if (tool?.type !== "tool") return
        expect(tool.state.status).toBe("completed")
        if (tool.state.status !== "completed") return
        expect(tool.state.content).toEqual([
          { type: "text", text: "/tmp" },
          { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "image.png" },
        ])
        expect(tool.state).not.toHaveProperty("attachments")
      }),
    )
  })

  test("replay is deterministic and duplicate delivery does not duplicate projected content", async () => {
    const sourceDb = await makeDbPath()
    const targetDb = await makeDbPath()
    const events = await run(
      sourceDb,
      Effect.gen(function* () {
        yield* seedSession()
        return (yield* publishTranscript()).map(serialized)
      }),
    )

    await run(
      targetDb,
      Effect.gen(function* () {
        yield* seedSession()
        const service = yield* EventV2.Service
        yield* service.replayAll(events)
        yield* resetStoredEvents()
        yield* service.replayAll(events)

        const messages = yield* readMessages()
        expect(messages.map((message) => message.type)).toEqual(["user", "assistant", "compaction"])
        const assistant = messages[1]
        expect(assistant?.type).toBe("assistant")
        if (assistant?.type !== "assistant") return
        expect(assistant.content.map((item) => item.id)).toEqual([eventID("text_started"), eventID("tool_started")])
        expect(assistant.content).toMatchObject([
          { type: "text", text: "hello assistant" },
          { type: "tool", state: { status: "completed" } },
        ])
      }),
    )
  })

  test("tool called does not regress a terminal tool state", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        const events = yield* EventV2.Service
        yield* events.publish(
          SessionEvent.Step.Started,
          { sessionID, timestamp: at(10), agent: "build", model },
          { id: eventID("terminal_assistant") },
        )
        yield* events.publish(
          SessionEvent.Tool.Input.Started,
          { sessionID, timestamp: at(20), callID: "call_terminal", name: "bash" },
          { id: eventID("terminal_tool") },
        )
        yield* events.publish(
          SessionEvent.Tool.Called,
          {
            sessionID,
            timestamp: at(30),
            callID: "call_terminal",
            tool: "bash",
            input: { command: "pwd" },
            provider: { executed: true },
          },
          { id: eventID("terminal_called") },
        )
        yield* events.publish(
          SessionEvent.Tool.Success,
          {
            sessionID,
            timestamp: at(40),
            callID: "call_terminal",
            structured: {},
            content: [new ToolOutput.TextContent({ type: "text", text: "/tmp" })],
            provider: { executed: true, metadata: { status: "done" } },
          },
          { id: eventID("terminal_success") },
        )
        yield* events.publish(
          SessionEvent.Tool.Called,
          {
            sessionID,
            timestamp: at(50),
            callID: "call_terminal",
            tool: "bash",
            input: { command: "pwd" },
            provider: { executed: true },
          },
          { id: eventID("terminal_called_late") },
        )

        const assistant = (yield* readMessages())[0]
        expect(assistant?.type).toBe("assistant")
        if (assistant?.type !== "assistant") return
        expect(assistant.content[0]).toMatchObject({ type: "tool", state: { status: "completed" } })
      }),
    )
  })

  test("projects retry metadata onto the active assistant without creating a message", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        yield* retryTranscriptEvents()

        const messages = yield* readMessages()
        expect(messages.map((message) => message.type)).toEqual(["assistant"])

        const assistant = messages[0]
        expect(assistant?.type).toBe("assistant")
        if (assistant?.type !== "assistant") return

        expect(assistant.id).toBe(eventID("retry_assistant"))
        expect(assistant).toMatchObject({
          retries: [
            {
              attempt: 2,
              error: retryError(),
              time: { created: at(20) },
            },
          ],
        })
        assertNoLegacyIDs(assistant)
      }),
    )
  })

  test("projects rich failed step errors onto the active assistant", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        const error = {
          type: "api",
          message: "provider returned 429",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: { "retry-after": "1" },
          responseBody: "rate limited",
          metadata: { provider: "test" },
        } satisfies SessionEvent.AssistantError
        const events = yield* EventV2.Service
        yield* events.publish(
          SessionEvent.Step.Started,
          { sessionID, timestamp: at(10), agent: "build", model, snapshot: "before-error" },
          { id: eventID("failed_assistant") },
        )
        yield* events.publish(
          SessionEvent.Step.Failed,
          { sessionID, timestamp: at(20), error },
          { id: eventID("step_failed") },
        )

        const messages = yield* readMessages()
        expect(messages.map((message) => message.type)).toEqual(["assistant"])

        const assistant = messages[0]
        expect(assistant?.type).toBe("assistant")
        if (assistant?.type !== "assistant") return

        expect(assistant.finish).toBe("error")
        expect(assistant.time.completed).toEqual(at(20))
        expect(assistant.error).toEqual(error)
      }),
    )
  })

  test("drops retry metadata before any active assistant and leaves the transcript empty", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSession()
        const events = yield* EventV2.Service
        yield* events.publish(
          SessionEvent.Retried,
          { sessionID, timestamp: at(10), attempt: 2, error: retryError() },
          { id: eventID("retry_without_assistant") },
        )

        expect(yield* readMessages()).toEqual([])
      }),
    )
  })

  test("replaying retry events does not duplicate assistant retry metadata", async () => {
    const sourceDb = await makeDbPath()
    const targetDb = await makeDbPath()
    const events = await run(
      sourceDb,
      Effect.gen(function* () {
        yield* seedSession()
        return (yield* retryTranscriptEvents()).map(serialized)
      }),
    )

    await run(
      targetDb,
      Effect.gen(function* () {
        yield* seedSession()
        const service = yield* EventV2.Service
        yield* service.replayAll(events)
        yield* resetStoredEvents()
        yield* service.replayAll(events)

        const messages = yield* readMessages()
        expect(messages.map((message) => message.type)).toEqual(["assistant"])

        const assistant = messages[0]
        expect(assistant?.type).toBe("assistant")
        if (assistant?.type !== "assistant") return

        expect(assistant).toMatchObject({
          retries: [
            {
              attempt: 2,
              error: retryError(),
              time: { created: at(20) },
            },
          ],
        })
      }),
    )
  })
})
