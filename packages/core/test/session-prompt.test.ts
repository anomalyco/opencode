import { describe, expect } from "bun:test"
import { DateTime, Effect, Fiber, Layer, Stream } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const store = SessionStore.layer.pipe(Layer.provide(database))
const executionCalls: SessionV2.ID[] = []
const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    resume: (sessionID) =>
      Effect.sync(() => {
        executionCalls.push(sessionID)
      }),
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(store),
  Layer.provide(Project.defaultLayer),
  Layer.provide(execution),
)
const it = testEffect(Layer.mergeAll(database, events, projector, store, execution, sessions))
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

describe("SessionV2.prompt", () => {
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

  it.effect("durably admits one user message before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: new Prompt({ text: "Fix the failing tests" }),
        resume: false,
      })

      expect(message.type).toBe("user")
      expect(message.text).toBe("Fix the failing tests")
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).toMatchObject({
        id: message.id,
        sessionID,
        prompt: { text: "Fix the failing tests" },
        delivery: "steer",
      })
    }),
  )

  it.effect("streams durable Session events after an aggregate cursor", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const fiber = yield* session.events({ sessionID }).pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "First" }), resume: false })
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Second" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, sessionID)
      const streamed = Array.from(yield* Fiber.join(fiber))

      expect(
        streamed.map((event) => [event.cursor, event.event.type, (event.event.data as { prompt: Prompt }).prompt.text]),
      ).toEqual([
        [EventV2.Cursor.make(0), "session.next.prompted", "First"],
        [EventV2.Cursor.make(1), "session.next.prompted", "Second"],
      ])
      expect(
        Array.from(
          yield* session.events({ sessionID, after: streamed[0]!.cursor }).pipe(Stream.take(1), Stream.runCollect),
        ).map((event) => [event.cursor, (event.event.data as { prompt: Prompt }).prompt.text]),
      ).toEqual([[EventV2.Cursor.make(1), "Second"]])
    }),
  )

  it.effect("resumes through a recorded message without appending another prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        prompt: new Prompt({ text: "Fix the failing tests" }),
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
      const input = { sessionID, prompt: new Prompt({ text: "Fix the failing tests" }), resume: false }

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
        prompt: new Prompt({ text: "Fix the failing tests" }),
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
        prompt: new Prompt({ text: "Recover committed prompt" }),
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
        prompt: new Prompt({ text: "Fix the failing tests" }),
      })
      const failure = yield* session
        .prompt({
          sessionID,
          id: messageID,
          prompt: new Prompt({ text: "Delete the failing tests" }),
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
        prompt: new Prompt({ text: "Fix the failing tests" }),
        resume: false,
      })
      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          prompt: new Prompt({ text: "Fix the failing tests" }),
          delivery: "queue",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("does not match pending inputs when no delivery modes are eligible", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Wait" }), resume: false })

      expect(yield* SessionInput.hasPending(db, sessionID, [])).toBe(false)
    }),
  )

  it.effect("returns one recorded message to concurrent exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: new Prompt({ text: "Fix the failing tests" }),
        resume: false,
      }

      const messages = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(messages[1]).toEqual(messages[0])
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("reconciles an existing projected prompt into a promoted inbox record", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const prompt = new Prompt({ text: "Historical prompt" })
      yield* events.publish(
        SessionEvent.Prompted,
        { sessionID, timestamp: yield* DateTime.now, prompt, delivery: "steer" },
        { id: messageID },
      )

      const retried = yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })

      expect(retried).toMatchObject({ id: messageID, text: "Historical prompt" })
      expect(yield* admitted(messageID)).toHaveProperty("promotedSeq")
    }),
  )

  it.effect("reconciles an existing projected queued prompt with its delivery mode", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const prompt = new Prompt({ text: "Historical queued prompt" })
      yield* events.publish(
        SessionEvent.Prompted,
        { sessionID, timestamp: yield* DateTime.now, prompt, delivery: "queue" },
        { id: messageID },
      )

      const retried = yield* session.prompt({ id: messageID, sessionID, prompt, delivery: "queue", resume: false })

      expect(retried).toMatchObject({ id: messageID, text: "Historical queued prompt" })
      expect(yield* admitted(messageID)).toMatchObject({ delivery: "queue" })
    }),
  )

  it.effect("rejects an input ID already used by a durable non-prompt event", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      yield* events.publish(
        SessionEvent.Synthetic,
        { sessionID, timestamp: yield* DateTime.now, text: "Collision" },
        { id: messageID },
      )

      const failure = yield* session
        .prompt({ id: messageID, sessionID, prompt: new Prompt({ text: "Collision" }), resume: false })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("rejects a durable event ID reserved by an admitted prompt without poisoning promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const prompt = new Prompt({ text: "Reserved prompt" })
      yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })

      const failure = yield* events
        .publish(
          SessionEvent.Synthetic,
          { sessionID, timestamp: yield* DateTime.now, text: "Conflicting synthetic" },
          { id: messageID },
        )
        .pipe(Effect.catchDefect(Effect.succeed))

      expect(failure).toBe("Durable event conflicts with admitted prompt input")
      expect(yield* admitted(messageID)).not.toHaveProperty("promotedSeq")
      expect(yield* session.messages({ sessionID })).toEqual([])

      yield* SessionInput.promoteSteers(db, events, sessionID)

      expect(yield* admitted(messageID)).toMatchObject({ promotedSeq: 0 })
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: messageID, type: "user", text: "Reserved prompt" },
      ])
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
      const prompt = new Prompt({ text: "Fix the failing tests" })

      yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })
      const failure = yield* session
        .prompt({ id: messageID, sessionID: other, prompt, resume: false })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID: other, messageID })
    }),
  )

  it.effect("starts execution by default after recording the prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Run by default" }) })

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

      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Run explicitly" }), resume: true })

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

      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Do not run" }), resume: false })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )
})
