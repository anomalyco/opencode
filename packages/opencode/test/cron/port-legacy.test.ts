import { describe, expect } from "bun:test"
import { Effect, Layer, Exit } from "effect"
import { CronDeliveryPort } from "@opencode-ai/core/cron/port"
import { SessionPrompt } from "@/session/prompt"
import { SessionRunState } from "@/session/run-state"
import { Session } from "@/session/session"
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

const mockRunState = Layer.mock(SessionRunState.Service)({
  assertNotBusy: () =>
    Effect.gen(function* () {
      seenInstance = yield* InstanceState.context
    }),
})

const mockSession = Layer.mock(Session.Service)({
  get: () => Effect.die("unexpected session.get in this test"),
})

const it = testEffect(
  CronDeliveryPortLive.pipe(
    Layer.provide(mockRunState),
    Layer.provide(mockPrompt),
    Layer.provide(mockSession),
  ),
)

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
    }))

  it.effect("isBusy replays the captured InstanceRef so assertNotBusy can read InstanceState.context", () =>
    Effect.gen(function* () {
      seenInstance = undefined
      const port = yield* CronDeliveryPort
      const busy = yield* port.isBusy("ses_test", { context: { instance: mockInstance } })
      expect(busy).toBe(false)
      expect(seenInstance).toBe(mockInstance)
    }))

  it.effect("deliver with no captured context and no ambient InstanceRef fails (documents the requirement)", () =>
    Effect.gen(function* () {
      const port = yield* CronDeliveryPort
      const exit = yield* port.deliver("ses_test", "hi", { context: undefined }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }))
})
