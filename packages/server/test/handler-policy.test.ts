import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { SessionNotFoundError, ServiceUnavailableError, UnknownError } from "@opencode-ai/protocol/errors"
import { expect, test } from "bun:test"
import { Effect, Layer, Logger, References } from "effect"
import { pluginReadiness } from "../src/handlers/plugin-readiness"
import { failedMessageDecode, missingSession } from "../src/handlers/session-error"

test("yieldable session errors preserve the handler failure policy", async () => {
  const sessionID = Session.ID.create()
  const error = await Effect.runPromise(
    Effect.fail(new Session.NotFoundError({ sessionID })).pipe(
      Effect.catchTag("Session.NotFoundError", missingSession),
      Effect.flip,
    ),
  )

  expect(error).toBeInstanceOf(SessionNotFoundError)
  expect(error).toMatchObject({ sessionID, message: `Session not found: ${sessionID}` })
})

test("message decode policy preserves its reference and log annotations", async () => {
  const sessionID = Session.ID.create()
  const messageID = SessionMessage.ID.create()
  const messages: unknown[] = []
  const annotations: Array<Record<string, unknown>> = []
  const logger = Logger.make<unknown, void>((options) => {
    messages.push(options.message)
    annotations.push({ ...options.fiber.getRef(References.CurrentLogAnnotations) })
  })
  const error = await Effect.runPromise(
    Effect.fail(new Session.MessageDecodeError({ sessionID, messageID })).pipe(
      Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
      Effect.flip,
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    ),
  )

  expect(error).toBeInstanceOf(UnknownError)
  expect(error.message).toBe("Unexpected server error. Check server logs for details.")
  expect(error.ref).toMatch(/^err_[0-9a-f]{8}$/)
  expect(messages).toEqual([["failed to decode session message"]])
  expect(annotations).toEqual([{ ref: error.ref, sessionID, messageID }])
})

test("plugin readiness stays lazy and resolves the supervisor for every execution", async () => {
  let flushes = 0
  const readiness = pluginReadiness(
    () => new ServiceUnavailableError({ message: "initialization timed out", service: "test" }),
  )
  const layer = Layer.succeed(PluginSupervisor.Service, {
    check: () => Effect.succeed({ mutable: false }),
    flush: Effect.sync(() => {
      flushes++
    }),
  })

  expect(flushes).toBe(0)
  await Effect.runPromise(Effect.all([readiness, readiness], { concurrency: 1 }).pipe(Effect.provide(layer)))
  expect(flushes).toBe(2)
})
