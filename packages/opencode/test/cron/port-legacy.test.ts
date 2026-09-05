import { describe, expect } from "bun:test"
import { Cause, Effect, Layer, Exit } from "effect"
import { CronDeliveryPort, CronDeliveryError } from "@opencode-ai/core/cron/port"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { InstanceState } from "@/effect/instance-state"
import { CronDeliveryPortLive } from "@/cron/port-legacy"
import { testEffect } from "../lib/effect"

const mockInstance = { directory: "/tmp/cron-test", worktree: "/tmp/cron-test", project: { id: "p1" } } as any

let seenInstance: unknown
let promptCalled = false

const mockPrompt = Layer.mock(SessionPrompt.Service)({
  prompt: () =>
    Effect.gen(function* () {
      seenInstance = yield* InstanceState.context
      promptCalled = true
      return {} as any
    }),
})

const mockSession = Layer.mock(Session.Service)({
  get: () => Effect.die("unexpected session.get in this test"),
})

const it = testEffect(CronDeliveryPortLive.pipe(Layer.provide(mockPrompt), Layer.provide(mockSession)))

describe("legacy cron delivery port", () => {
  it.effect("deliver replays the captured InstanceRef so SessionPrompt can read InstanceState.context", () =>
    Effect.gen(function* () {
      promptCalled = false
      seenInstance = undefined
      const port = yield* CronDeliveryPort
      yield* port.deliver("ses_test", "say hello", {
        context: { instance: mockInstance, workspace: "w1" },
      })
      expect(promptCalled).toBe(true)
      expect(seenInstance).toBe(mockInstance)
    }),
  )

  it.effect("deliver with no captured context and no ambient InstanceRef fails (documents the requirement)", () =>
    Effect.gen(function* () {
      const port = yield* CronDeliveryPort
      const exit = yield* port.deliver("ses_test", "hi", { context: undefined }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})

// --- exists ---

const existsSessionLayer = Layer.succeed(
  Session.Service,
  Session.Service.of({
    get: (id: SessionID) =>
      id === SessionID.make("ses_test") ? Effect.succeed({ id } as any) : Effect.fail(new Error("Session not found")),
  } as any),
)

const existsHappyIt = testEffect(
  CronDeliveryPortLive.pipe(
    Layer.provide(
      Layer.mock(SessionPrompt.Service)({
        prompt: () => Effect.succeed({} as any),
      }),
    ),
    Layer.provide(existsSessionLayer),
  ),
)

describe("legacy cron delivery port — exists", () => {
  existsHappyIt.effect("returns true when session.get succeeds", () =>
    Effect.gen(function* () {
      const port = yield* CronDeliveryPort
      const exists = yield* port.exists(SessionID.make("ses_test"))
      expect(exists).toBe(true)
    }),
  )

  existsHappyIt.effect("returns false when session.get fails (orElseSucceed fallback)", () =>
    Effect.gen(function* () {
      const port = yield* CronDeliveryPort
      const exists = yield* port.exists("ses_missing")
      expect(exists).toBe(false)
    }),
  )
})

// --- deliver error mapping ---

const deliverErrorIt = testEffect(
  CronDeliveryPortLive.pipe(
    Layer.provide(
      Layer.mock(SessionPrompt.Service)({
        prompt: () => Effect.fail(new Error("prompt service down")) as any,
      }),
    ),
    Layer.provide(
      Layer.mock(Session.Service)({
        get: () => Effect.succeed({ id: "ses_test" } as any),
      }),
    ),
  ),
)

describe("legacy cron delivery port — deliver error mapping", () => {
  deliverErrorIt.effect("maps prompt failures to CronDeliveryError", () =>
    Effect.gen(function* () {
      const port = yield* CronDeliveryPort
      const exit = yield* port.deliver("ses_test", "hello", { context: { instance: mockInstance } }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) return
      const err = Cause.squash(exit.cause)
      expect(err).toBeInstanceOf(CronDeliveryError)
      expect(String(err)).toContain("prompt service down")
    }),
  )
})
