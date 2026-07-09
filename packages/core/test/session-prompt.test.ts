import { describe, expect } from "bun:test"
import { DateTime, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { pathToFileURL } from "url"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const executionCalls: SessionV2.ID[] = []
const interruptCalls: SessionV2.ID[] = []
const wakeCalls: SessionV2.ID[] = []
const activeSessions = new Set<SessionV2.ID>()
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: (sessionID) =>
      Effect.sync(() => {
        executionCalls.push(sessionID)
      }),
    interrupt: (sessionID) =>
      Effect.sync(() => {
        interruptCalls.push(sessionID)
      }),
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
    awaitIdle: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [[SessionExecution.node, execution]],
  ),
)
const sessionID = SessionV2.ID.make("ses_prompt_test")
const messageID = SessionMessage.ID.create()

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
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
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInput.find(db, id))
const admittedCount = Database.Service.use(({ db }) =>
  db
    .select()
    .from(SessionInputTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.length),
    ),
)
const eventCount = (type: string) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(EventTable)
      .where(eq(EventTable.type, type))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const assistantRow = (id: SessionMessage.ID, seq: number) => {
  const {
    id: _,
    type,
    ...data
  } = encodeMessage(
    SessionMessage.Assistant.make({
      id,
      type: "assistant",
      agent: AgentV2.ID.make("build"),
      model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
      content: [],
      time: { created: DateTime.makeUnsafe(0) },
    }),
  )
  return { id, session_id: sessionID, type, seq, time_created: 0, data }
}

describe("SessionV2.prompt", () => {
  it.effect("exposes the execution registry", () =>
    Effect.gen(function* () {
      activeSessions.add(sessionID)
      expect(Array.from(yield* (yield* SessionV2.Service).active)).toEqual([sessionID])
    }).pipe(Effect.ensuring(Effect.sync(() => activeSessions.clear()))),
  )

  it.effect("delegates execution continuation through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("delegates process-local interruption through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      interruptCalls.length = 0

      yield* session.interrupt(sessionID)
      expect(interruptCalls).toEqual([sessionID])
      expect(yield* session.messages({ sessionID })).toEqual([])
    }),
  )

  it.effect("delegates interruption without requiring a recorded Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      interruptCalls.length = 0

      yield* session.interrupt(SessionV2.ID.make("ses_missing"))
      expect(interruptCalls).toEqual([SessionV2.ID.make("ses_missing")])
    }),
  )

  it.effect("durably admits one user message before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })

      expect(message.data.text).toBe("Fix the failing tests")
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).toMatchObject({
        id: message.id,
        sessionID,
        type: "user",
        data: { text: "Fix the failing tests" },
        delivery: "steer",
      })
    }),
  )

  it.effect("commits a staged revert before admitting a new prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      const boundary = yield* session.prompt({
        sessionID,
        text: "boundary",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, sessionID)
      const stale = SessionMessage.ID.make("msg_stale_assistant")
      yield* db.insert(SessionMessageTable).values(assistantRow(stale, 100)).run().pipe(Effect.orDie)
      yield* events.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      expect((yield* session.get(sessionID)).revert?.messageID).toBe(boundary.id)

      yield* session.prompt({ sessionID, text: "after revert", resume: false })

      expect((yield* session.get(sessionID)).revert).toBeUndefined()
      expect(
        (yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all().pipe(Effect.orDie)).map(
          (row) => row.id,
        ),
      ).not.toContainAnyValues([boundary.id, stale])
      expect(yield* SessionInput.find(db, boundary.id)).toBeUndefined()
    }),
  )

  it.effect("holds synthetic input behind a staged revert and discards it when committed", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const boundary = yield* session.prompt({
        sessionID,
        text: "boundary",
        resume: false,
      })
      yield* SessionInput.promoteSteers(db, events, sessionID)
      yield* events.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        revert: { messageID: boundary.id, files: [] },
      })
      wakeCalls.length = 0

      const completion = yield* session.synthetic({ sessionID, text: "stale completion" })

      expect(wakeCalls).toEqual([])
      expect(yield* SessionInput.find(db, completion.id)).toMatchObject({ type: "synthetic" })

      yield* session.revert.commit(sessionID)

      expect(yield* SessionInput.find(db, completion.id)).toBeUndefined()
    }),
  )

  it.effect("resolves attachment MIME before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const uri =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri, name: "image.png", mention: { start: 8, end: 17, text: "[Image 1]" } }],
        resume: false,
      })

      expect(message.data.files).toEqual([
        {
          data: uri.slice(uri.indexOf(",") + 1),
          mime: "image/png",
          source: { type: "inline" },
          name: "image.png",
          mention: { start: 8, end: 17, text: "[Image 1]" },
        },
      ])
      const stored = yield* admitted(message.id)
      expect(stored?.type).toBe("user")
      if (stored?.type === "user") expect(stored.data.files).toEqual(message.data.files)
    }),
  )

  it.effect("materializes selected source file content", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const directory = import.meta.dir
      const source = path.join(directory, "session-prompt.test.ts")
      const sourceUri = pathToFileURL(source)
      sourceUri.searchParams.set("start", "1")
      sourceUri.searchParams.set("end", "1")

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri: sourceUri.href, name: "main.ts" }],
        resume: false,
      })

      expect(message.data.files).toHaveLength(1)
      expect(message.data.files?.[0]).toMatchObject({
        mime: "text/plain",
        source: { type: "uri", uri: sourceUri.href },
        name: "main.ts",
      })
      expect(
        Buffer.from(message.data.files?.[0]?.data ?? "", "base64")
          .toString("utf8")
          .replace(/\r$/, ""),
      ).toBe('import { describe, expect } from "bun:test"')
    }),
  )

  it.effect("materializes directories as directory attachments", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const uri = pathToFileURL(import.meta.dir).href

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri, name: "source" }],
        resume: false,
      })

      expect(message.data.files).toHaveLength(1)
      expect(message.data.files?.[0]).toMatchObject({
        mime: "application/x-directory",
        source: { type: "uri", uri },
        name: "source",
      })
      expect(Buffer.from(message.data.files?.[0]?.data ?? "", "base64").toString("utf8")).toContain(
        "session-prompt.test.ts",
      )
    }),
  )

  it.effect("materializes local image content before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(tmpdir(), "opencode-session-prompt-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const source = path.join(directory, "image.png")
      const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      )
      yield* Effect.promise(() => Bun.write(source, bytes))

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this image",
        files: [{ uri: pathToFileURL(source).href }],
        resume: false,
      })

      expect(message.data.files).toEqual([
        {
          data: bytes.toString("base64"),
          mime: "image/png",
          source: { type: "uri", uri: pathToFileURL(source).href },
          name: "image.png",
        },
      ])
      const stored = yield* admitted(message.id)
      expect(stored?.type === "user" ? stored.data.files : undefined).toEqual(message.data.files)
    }),
  )

  it.effect("sniffs data URL content instead of trusting its declared MIME", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const uri = `data:video/mp2t;base64,${Buffer.from("export const value = 1\n").toString("base64")}`

      const message = yield* session.prompt({
        sessionID,
        text: "Inspect this",
        files: [{ uri, name: "main.ts" }],
        resume: false,
      })

      expect(message.data.files).toEqual([
        {
          data: Buffer.from("export const value = 1\n").toString("base64"),
          mime: "text/plain",
          source: { type: "inline" },
          name: "main.ts",
        },
      ])
    }),
  )

  it.effect("rejects malformed base64 data URLs", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const uri = "data:image/png;base64,not-base64"

      const error = yield* session
        .prompt({
          sessionID,
          text: "Inspect this",
          files: [{ uri, name: "image.png" }],
          resume: false,
        })
        .pipe(Effect.flip)

      expect(error).toMatchObject({
        _tag: "Session.AttachmentError",
        uri,
        message: "Invalid attachment data URL",
      })
    }),
  )

  it.effect("streams durable Session events after an aggregate sequence", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const publicEvents = (input: { sessionID: SessionV2.ID; after?: number }) =>
        session
          .log({ ...input, follow: true })
          .pipe(Stream.filter((item): item is SessionEvent.DurableEvent => !EventV2.isSynced(item)))
      const fiber = yield* publicEvents({ sessionID }).pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.prompt({ sessionID, text: "First", resume: false })
      yield* session.prompt({ sessionID, text: "Second", resume: false })
      yield* SessionInput.promoteSteers(db, events, sessionID)
      const streamed = Array.from(yield* Fiber.join(fiber))

      expect(streamed.map((event): [number | undefined, string] => [event.durable?.seq, event.type])).toEqual([
        [0, "session.input.admitted"],
        [1, "session.input.admitted"],
        [2, "session.input.promoted"],
        [3, "session.input.promoted"],
      ])
      expect(
        Array.from(
          yield* publicEvents({ sessionID, after: streamed[0].durable?.seq }).pipe(Stream.take(1), Stream.runCollect),
        ).map((event): [number | undefined, string] => [event.durable?.seq, event.type]),
      ).toEqual([[1, "session.input.admitted"]])
    }),
  )

  it.effect("resumes through a recorded message without appending another prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })

      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).not.toHaveProperty("promotedSeq")
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("records distinct messages when the ID is omitted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = { sessionID, text: "Fix the failing tests", resume: false }

      const first = yield* session.prompt(input)
      const second = yield* session.prompt(input)

      expect(second.id).not.toBe(first.id)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(2)
    }),
  )

  it.effect("returns the original recorded message when the ID is retried", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("wakes execution when an exact prompt retry recovers a committed message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Recover committed prompt",
        resume: false,
      }
      const first = yield* session.prompt(input)
      wakeCalls.length = 0

      const retried = yield* session.prompt({ ...input, resume: true })

      expect(retried).toEqual(first)
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("rejects reuse of one ID with a different prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
      })
      const failure = yield* session
        .prompt({
          sessionID,
          id: messageID,
          text: "Delete the failing tests",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
      expect(yield* session.messages({ sessionID })).toHaveLength(0)
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("rejects reuse of one ID with a different delivery mode", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Fix the failing tests",
        resume: false,
      })
      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          text: "Fix the failing tests",
          delivery: "queue",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("returns one recorded message to concurrent exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        text: "Fix the failing tests",
        resume: false,
      }

      const messages = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(messages[1]).toEqual(messages[0])
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
      expect(yield* eventCount(EventV2.versionedType(SessionEvent.InputAdmitted.type, 1))).toBe(1)
    }),
  )

  it.effect("promotes one message once under concurrent promotion attempts", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Promote once",
        resume: false,
      })

      yield* Effect.all(
        [SessionInput.promoteSteers(db, events, sessionID), SessionInput.promoteSteers(db, events, sessionID)],
        { concurrency: "unbounded" },
      )

      expect(yield* eventCount(EventV2.versionedType(SessionEvent.InputPromoted.type, 1))).toBe(1)
      expect(yield* admitted(messageID)).toMatchObject({ promotedSeq: 1 })
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: messageID, type: "user", text: "Promote once" },
      ])
    }),
  )

  it.effect("reprojects pending inbox input without scheduling execution", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      wakeCalls.length = 0
      yield* session.prompt({
        id: messageID,
        sessionID,
        text: "Replay pending",
        resume: false,
      })
      const syntheticID = SessionMessage.ID.create()
      yield* session.synthetic({ id: syntheticID, sessionID, text: "Replay synthetic", resume: false })
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)

      yield* events.remove(sessionID)
      yield* db.delete(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          created: DateTime.makeUnsafe(event.created),
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )

      expect(yield* admitted(messageID)).toMatchObject({
        id: messageID,
        type: "user",
        data: { text: "Replay pending" },
      })
      expect(yield* admitted(syntheticID)).toMatchObject({
        id: syntheticID,
        type: "synthetic",
        data: { text: "Replay synthetic" },
      })
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("rejects reuse of one globally unique message ID across sessions", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const other = SessionV2.ID.make("ses_prompt_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: other,
          project_id: Project.ID.global,
          slug: "other",
          directory: "/project",
          title: "other",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* session.prompt({ id: messageID, sessionID, text: "Fix the failing tests", resume: false })
      const failure = yield* session
        .prompt({ id: messageID, sessionID: other, text: "Fix the failing tests", resume: false })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID: other, messageID })
    }),
  )

  it.effect("rejects a prompt ID already used by visible Session history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const {
        id: _,
        type,
        ...data
      } = encodeMessage({
        id: messageID,
        type: "synthetic",
        text: "Existing history",
        time: { created: DateTime.makeUnsafe(0) },
      })
      yield* db
        .insert(SessionMessageTable)
        .values({ id: messageID, session_id: sessionID, type, seq: 0, time_created: 0, data })
        .run()
        .pipe(Effect.orDie)

      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          text: "Conflicting prompt",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID, messageID })
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("starts execution by default after recording the prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, text: "Run by default" })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("starts execution when resume is explicitly true", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({
        sessionID,
        text: "Run explicitly",
        resume: true,
      })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("only records the prompt when resume is false", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, text: "Do not run", resume: false })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("treats prompt metadata as durable retry identity", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        id: messageID,
        sessionID,
        text: "Deploy",
        metadata: { source: "api" },
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)
      const failure = yield* session.prompt({ ...input, metadata: { source: "plugin" } }).pipe(Effect.flip)

      expect(retried).toEqual(first)
      expect(first.data.metadata).toEqual({ source: "api" })
      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("durably admits synthetic input before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      const input = yield* session.synthetic({
        id: messageID,
        sessionID,
        text: "Background work completed",
        description: "shell completion",
        metadata: { job: "shell" },
        resume: false,
      })

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(input.id)).toMatchObject({
        type: "synthetic",
        sessionID,
        delivery: "steer",
        data: {
          text: "Background work completed",
          description: "shell completion",
          metadata: { job: "shell" },
        },
      })

      yield* SessionInput.promoteSteers(db, events, sessionID)

      expect(yield* session.messages({ sessionID })).toMatchObject([
        {
          id: messageID,
          type: "synthetic",
          text: "Background work completed",
          description: "shell completion",
          metadata: { job: "shell" },
        },
      ])
    }),
  )

  it.effect("reconciles exact synthetic retries and rejects conflicting reuse", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const database = yield* Database.Service
      const input = { id: messageID, sessionID, text: "Completed", resume: false }

      const entries = yield* Effect.all([session.synthetic(input), session.synthetic(input)], {
        concurrency: "unbounded",
      })
      yield* SessionInput.promoteSteers(database.db, events, sessionID)
      const promotedRetry = yield* session.synthetic(input)
      const failure = yield* session.synthetic({ ...input, text: "Different completion" }).pipe(Effect.flip)

      expect(entries[1]).toEqual(entries[0])
      expect(promotedRetry).toMatchObject({ id: messageID, type: "synthetic", promotedSeq: expect.any(Number) })
      expect(failure).toMatchObject({ _tag: "Session.SyntheticConflictError", sessionID, inputID: messageID })
      expect(yield* admittedCount).toBe(1)
      expect(yield* eventCount(EventV2.versionedType(SessionEvent.InputAdmitted.type, 1))).toBe(1)
    }),
  )

  it.effect("keeps synthetic queue input pending until the queue boundary", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      const input = yield* session.synthetic({
        sessionID,
        text: "Queued completion",
        delivery: "queue",
        resume: false,
      })

      expect(input.delivery).toBe("queue")
      expect(yield* SessionInput.promoteSteers(db, events, sessionID)).toBe(0)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* SessionInput.promoteNextQueued(db, events, sessionID)).toBe(true)
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: input.id, type: "synthetic", text: "Queued completion" },
      ])
    }),
  )

  it.effect("promotes prompt and synthetic steers in admission order", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      yield* session.prompt({
        sessionID,
        text: "First prompt",
        resume: false,
      })
      yield* session.synthetic({ sessionID, text: "Background completion", resume: false })
      yield* session.prompt({
        sessionID,
        text: "Second prompt",
        resume: false,
      })

      yield* SessionInput.promoteSteers(db, events, sessionID)

      expect(
        (yield* session.messages({ sessionID, order: "asc" })).map((message) =>
          message.type === "user" || message.type === "synthetic" ? message.text : message.type,
        ),
      ).toEqual(["First prompt", "Background completion", "Second prompt"])
    }),
  )
})
