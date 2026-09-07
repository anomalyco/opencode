export * as SessionRunnerRetry from "./retry.js"

import { AIError } from "@opencode-ai/ai"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"
import { Bus } from "../../bus.js"
import type { Credential } from "../../credential.js"
import type { PluginHooks } from "../../plugin/hooks.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import type { SessionRunnerFailover } from "./failover.js"

interface Input {
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly hook: (event: PluginHooks.Domains["session"]["retry"]) => Effect.Effect<void>
  readonly retry: boolean
}

export interface Decision {
  readonly retry: true
  readonly attempt: number
  readonly delay: number
}

export function isRetryable(error: AIError) {
  const override = error.reason.http?.headers["x-should-retry"]
  if (override === "true") return true
  if (override === "false") return false
  switch (error.reason._tag) {
    case "RateLimit":
    case "ProviderInternal":
      return true
    case "Transport":
      return error.reason.delivery === undefined || error.reason.delivery === "not-sent"
    case "InvalidProviderOutput":
      return error.reason.classification === "incomplete-stream"
    // Unrecognized failures retry: classification records affirmative
    // deterministic evidence, and transient failures are exactly the ones
    // that arrive in shapes no classifier anticipates.
    case "UnknownProvider":
      return true
    case "Authentication":
    case "QuotaExceeded":
    case "ContentPolicy":
    case "InvalidRequest":
    case "UnsupportedOperation":
    case "NoRoute":
      return false
    default: {
      const exhaustive: never = error.reason
      return exhaustive
    }
  }
}

/** Bound provider-requested delays so a hostile or buggy retry-after cannot stall a session for hours. */
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")

const retryAfter = (input: Input) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs === undefined
      ? undefined
      : Math.min(input.cause.reason.retryAfterMs, RETRY_AFTER_MAX)
  return undefined
}

const schedule = Schedule.max([Schedule.exponential("2 seconds"), Schedule.recurs(4)]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  Schedule.modifyDelay(({ input, duration: delay }) => {
    const minimum = retryAfter(input)
    const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
    return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
  }),
)

/** Retries on the current account before treating it as exhausted. */
const ACCOUNT_ATTEMPTS = 2

/** A provider asking for a longer wait than this exhausts the account instead. */
const ACCOUNT_RETRY_AFTER_MAX = Duration.toMillis("30 seconds")

/** The next account starts immediately; the pause only covers credential propagation. */
const SWITCH_DELAY = 1_000

export const policy = (sessionID: SessionSchema.ID, failover?: SessionRunnerFailover.Interface) =>
  Effect.gen(function* () {
    let step = yield* Schedule.toStep(schedule)
    let attempt = 1
    let accountAttempts = 0
    const exhausted = new Set<Credential.ID>()
    const propose = Effect.fnUntraced(function* (input: Input, retry: boolean, delay: number) {
      attempt++
      const event: PluginHooks.Domains["session"]["retry"] = {
        sessionID,
        agent: input.agent,
        model: input.model,
        error: input.error,
        attempt,
        decision: retry ? { retry: true, delay } : { retry: false },
      }
      yield* input.hook(event)
      if (!event.decision.retry) return event.decision
      const normalized =
        Number.isFinite(event.decision.delay) && event.decision.delay >= 0 ? Math.ceil(event.decision.delay) : delay
      return { retry: true as const, attempt, delay: normalized }
    })
    return (input: Input) =>
      Effect.gen(function* () {
        const reason = input.cause.reason._tag
        if (failover && (reason === "RateLimit" || reason === "QuotaExceeded")) {
          const requested = retryAfter(input)
          const spent =
            reason === "QuotaExceeded" ||
            accountAttempts >= ACCOUNT_ATTEMPTS ||
            (requested !== undefined && requested > ACCOUNT_RETRY_AFTER_MAX)
          const previous = spent ? yield* failover.next(input.model, exhausted) : undefined
          if (previous) {
            exhausted.add(previous)
            accountAttempts = 0
            // The account that just took over owns a full retry budget.
            step = yield* Schedule.toStep(schedule)
            return yield* propose(input, true, SWITCH_DELAY)
          }
          accountAttempts++
        }
        const now = yield* Clock.currentTimeMillis
        const next = yield* step(now, input).pipe(Pull.catchDone(() => Effect.succeed(undefined)))
        if (!next) return { retry: false as const }
        const [, duration] = next
        return yield* propose(input, input.retry, Math.ceil(Duration.toMillis(duration)))
      })
  })

export const make = (bus: Bus.Interface, sessionID: SessionSchema.ID, failover: SessionRunnerFailover.Interface) =>
  Effect.gen(function* () {
    const decide = yield* policy(sessionID, failover)
    const wait = (input: {
      readonly decision: Decision
      readonly assistantMessageID: SessionMessage.ID
      readonly error: SessionError.Error
    }) =>
      Effect.gen(function* () {
        const scheduled = yield* Clock.currentTimeMillis
        yield* bus.publish(SessionEvent.RetryScheduled, {
          sessionID,
          assistantMessageID: input.assistantMessageID,
          attempt: input.decision.attempt,
          at: scheduled + input.decision.delay,
          error: input.error,
        })
        const remaining = Math.max(0, scheduled + input.decision.delay - (yield* Clock.currentTimeMillis))
        yield* Effect.sleep(Duration.millis(remaining))
      })
    return { decide, wait }
  })
