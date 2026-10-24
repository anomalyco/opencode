import { describe, expect } from "bun:test"
import { AIError, ProviderInternalError, TransportError } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Effect } from "effect"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const idle = new AIError({
  reason: new TransportError({
    message: "Timed out waiting for WebSocket data",
    transport: "websocket",
    operation: "read",
    code: "idle-timeout",
    phase: "receive",
    delivery: "accepted",
  }),
})
const disconnected = new AIError({
  reason: new TransportError({
    message: "WebSocket closed with code 1006",
    transport: "websocket",
    operation: "read",
    code: "1006",
    phase: "close",
    delivery: "accepted",
  }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })

const input = (cause: AIError) => ({
  cause,
  error: toSessionError(cause),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
  hook: () => Effect.void,
  retry: SessionRunnerRetry.isRetryable(cause),
})

// Decisions for `count` consecutive failures of the same cause within one step.
const decisions = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
    const results: boolean[] = []
    for (let i = 0; i < count; i++) results.push((yield* policy(input(cause))).retry)
    return results
  })

describe("SessionRunnerRetry.policy", () => {
  it.effect("stops retrying transport timeouts after three attempts", () =>
    Effect.gen(function* () {
      expect(yield* decisions(timeout, 4)).toEqual([true, true, true, false])
    }),
  )

  it.effect("stops retrying WebSocket idle timeouts after three retries", () =>
    Effect.gen(function* () {
      expect(yield* decisions(idle, 4)).toEqual([true, true, true, false])
    }),
  )

  it.effect("shares the timeout allowance across HTTP and WebSocket failures", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      expect([
        (yield* policy(input(timeout))).retry,
        (yield* policy(input(idle))).retry,
        (yield* policy(input(timeout))).retry,
        (yield* policy(input(idle))).retry,
      ]).toEqual([true, true, true, false])
    }),
  )

  it.effect("keeps the general allowance for WebSocket connection failures", () =>
    Effect.gen(function* () {
      expect(yield* decisions(disconnected, 11)).toEqual([...Array(10).fill(true), false])
    }),
  )

  it.effect("keeps the general allowance for other transient failures", () =>
    Effect.gen(function* () {
      expect(yield* decisions(internal, 11)).toEqual([...Array(10).fill(true), false])
    }),
  )
})
