export * as SessionRunnerRetry from "./retry.js"

import { AIError, isRetryable } from "@opencode/ai/effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { SessionError } from "@opencode/schema/session-error"
import { Clock, Duration, Effect } from "effect"
import { Bus } from "../../bus.js"
import { ModelRetry } from "../../model-retry.js"
import type { PluginHooks } from "../../plugin/hooks.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"

export { isRetryable }

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

export const policy = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const decide = yield* ModelRetry.policy
    // Without this a stalled or failing provider is retried, and finally given up on, with nothing in the server log.
    // The response body is left out: it can be large and is already on the failed message.
    const log = (input: Input, retry: boolean, attempt?: number, delay?: number) =>
      Effect.logWarning(retry ? "provider request failed; retrying" : "provider request failed; not retrying", {
        sessionID,
        model: `${input.model.providerID}/${input.model.id}`,
        ...(attempt === undefined ? {} : { attempt }),
        ...(delay === undefined ? {} : { delay }),
        reason: input.cause.reason._tag,
        error: {
          type: input.error.type,
          message: input.error.message,
          ...(input.error.status === undefined ? {} : { status: input.error.status }),
        },
      })
    return (input: Input) =>
      Effect.gen(function* () {
        const next = yield* decide(input)
        if (!next) {
          yield* log(input, false)
          return { retry: false as const }
        }
        const event: PluginHooks.Domains["session"]["retry"] = {
          sessionID,
          agent: input.agent,
          model: input.model,
          error: input.error,
          attempt: next.attempt,
          decision: next.retry ? { retry: true, delay: next.delay } : { retry: false },
        }
        yield* input.hook(event)
        if (!event.decision.retry) {
          yield* log(input, false, next.attempt)
          return event.decision
        }
        const normalized =
          Number.isFinite(event.decision.delay) && event.decision.delay >= 0
            ? Math.ceil(event.decision.delay)
            : next.delay
        yield* log(input, true, next.attempt, normalized)
        return { retry: true as const, attempt: next.attempt, delay: normalized }
      })
  })

export const make = (bus: Bus.Interface, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const decide = yield* policy(sessionID)
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
