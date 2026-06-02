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
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const runtime = SessionRuntime.localLayer.pipe(Layer.provide(events), Layer.provide(database))
const sessions = SessionV2.layer.pipe(Layer.provide(events), Layer.provide(database), Layer.provide(Project.defaultLayer), Layer.provide(runtime))
const it = testEffect(Layer.mergeAll(database, events, projector, runtime, sessions))
const sessionID = SessionV2.ID.make("ses_prompt_test")
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
      const message = yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Fix the failing tests" }) })

      yield* session.resume(sessionID)

      expect(yield* session.messages({ sessionID })).toEqual([message])
    }),
  )

  it.effect("admits distinct messages when the application key is omitted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = { sessionID, prompt: new Prompt({ text: "Fix the failing tests" }) }

      const first = yield* session.prompt(input)
      const second = yield* session.prompt(input)

      expect(second.id).not.toBe(first.id)
      expect(yield* session.messages({ sessionID })).toEqual([second, first])
    }),
  )

  it.effect("returns the original admitted message when the application key is retried", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        idempotencyKey: Prompt.IdempotencyKey.make("discord-message-123"),
        prompt: new Prompt({ text: "Fix the failing tests" }),
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(yield* session.messages({ sessionID })).toEqual([first])
    }),
  )

  it.effect("rejects reuse of one application key with a different prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID,
        idempotencyKey: Prompt.IdempotencyKey.make("discord-message-123"),
        prompt: new Prompt({ text: "Fix the failing tests" }),
      })
      const failure = yield* session
        .prompt({
          sessionID,
          idempotencyKey: Prompt.IdempotencyKey.make("discord-message-123"),
          prompt: new Prompt({ text: "Delete the failing tests" }),
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
        idempotencyKey: Prompt.IdempotencyKey.make("discord-message-123"),
        prompt: new Prompt({ text: "Fix the failing tests" }),
      }

      const admitted = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(admitted[1]).toEqual(admitted[0])
      expect(yield* session.messages({ sessionID })).toEqual([admitted[0]])
    }),
  )
})
