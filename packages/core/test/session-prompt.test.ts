import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRuntime } from "@opencode-ai/core/session/runtime"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const runnerCalls: SessionV2.ID[] = []
const runner = Layer.succeed(SessionRunner.Service, SessionRunner.Service.of({
  run: (sessionID) => Effect.sync(() => {
    runnerCalls.push(sessionID)
  }),
}))
const runtime = SessionRuntime.localLayer.pipe(Layer.provide(events), Layer.provide(database), Layer.provide(runner))
const sessions = SessionV2.layer.pipe(Layer.provide(events), Layer.provide(database), Layer.provide(Project.defaultLayer), Layer.provide(runtime))
const it = testEffect(Layer.mergeAll(database, events, projector, runner, runtime, sessions))
const sessionID = SessionV2.ID.make("ses_prompt_test")
const messageID = SessionMessage.ID.create()
const runtimeCalls: SessionRuntime.PromptInput[] = []
const resumeCalls: SessionV2.ID[] = []
const delegatedMessage = new SessionMessage.User({
  id: SessionMessage.ID.make("msg_delegated"),
  type: "user",
  text: "Fix the failing tests",
  time: { created: DateTime.makeUnsafe(0) },
})
const recordingRuntime = Layer.succeed(SessionRuntime.Service, SessionRuntime.Service.of({
  prompt: (input) => Effect.sync(() => {
    runtimeCalls.push(input)
    return delegatedMessage
  }),
  resume: (input) => Effect.sync(() => {
    resumeCalls.push(input)
  }),
}))
const recordingSessions = SessionV2.layer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(Project.defaultLayer),
  Layer.provide(recordingRuntime),
)
const recordingIt = testEffect(Layer.mergeAll(database, events, projector, recordingRuntime, recordingSessions))

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

describe("SessionV2.prompt", () => {
  recordingIt.effect("delegates runtime-bound prompt admission through SessionRuntime", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = { sessionID, prompt: new Prompt({ text: "Fix the failing tests" }) }

      runtimeCalls.length = 0
      expect(yield* session.prompt(input)).toEqual(delegatedMessage)
      expect(runtimeCalls).toEqual([input])
    }),
  )

  recordingIt.effect("delegates execution continuation through SessionRuntime", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      resumeCalls.length = 0
      yield* session.resume(sessionID)
      expect(resumeCalls).toEqual([sessionID])
    }),
  )

  it.effect("durably admits one projected user message", () =>
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
      expect(yield* session.messages({ sessionID })).toContainEqual(message)
    }),
  )

  it.effect("resumes through an admitted message without appending another prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Fix the failing tests" }), resume: false })

      runnerCalls.length = 0
      yield* session.resume(sessionID)

      expect(yield* session.messages({ sessionID })).toEqual([message])
      expect(runnerCalls).toEqual([sessionID])
    }),
  )

  it.effect("admits distinct messages when the ID is omitted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = { sessionID, prompt: new Prompt({ text: "Fix the failing tests" }), resume: false }

      const first = yield* session.prompt(input)
      const second = yield* session.prompt(input)

      expect(second.id).not.toBe(first.id)
      expect(yield* session.messages({ sessionID })).toEqual([second, first])
    }),
  )

  it.effect("returns the original admitted message when the ID is retried", () =>
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
      expect(yield* session.messages({ sessionID })).toEqual([first])
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
      expect(yield* session.messages({ sessionID })).toHaveLength(1)
    }),
  )

  it.effect("returns one admitted message to concurrent exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: new Prompt({ text: "Fix the failing tests" }),
        resume: false,
      }

      const admitted = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(admitted[1]).toEqual(admitted[0])
      expect(yield* session.messages({ sessionID })).toEqual([admitted[0]])
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
        .values({ id: other, project_id: Project.ID.global, slug: "other", directory: "/project", title: "other", version: "test" })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const prompt = new Prompt({ text: "Fix the failing tests" })

      yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })
      const failure = yield* session.prompt({ id: messageID, sessionID: other, prompt, resume: false }).pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID: other, messageID })
    }),
  )

  it.effect("starts execution by default after admitting the prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      runnerCalls.length = 0

      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Run by default" }) })

      expect(runnerCalls).toEqual([sessionID])
    }),
  )

  it.effect("starts execution when resume is explicitly true", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      runnerCalls.length = 0

      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Run explicitly" }), resume: true })

      expect(runnerCalls).toEqual([sessionID])
    }),
  )

  it.effect("only admits the prompt when resume is false", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      runnerCalls.length = 0

      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Do not run" }), resume: false })

      expect(runnerCalls).toEqual([])
    }),
  )
})
