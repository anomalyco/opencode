export * as SessionRunnerRetry from "./retry.js"

import { AIError } from "@opencode-ai/ai"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Duration, Effect, Schedule } from "effect"
import { Bus } from "../../bus.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"

export interface Input {
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly assistantMessageID: SessionMessage.ID
}

export function isRetryable(error: AIError) {
  const override = "http" in error.reason ? error.reason.http?.response?.headers["x-should-retry"] : undefined
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
    case "Authentication":
    case "QuotaExceeded":
    case "ContentPolicy":
    case "InvalidRequest":
    case "NoRoute":
    case "UnknownProvider":
      return false
    default: {
      const exhaustive: never = error.reason
      return exhaustive
    }
  }
}

const retryAfter = (input: Input) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs
  return undefined
}

export const schedule = (bus: Bus.Interface, sessionID: SessionSchema.ID) =>
  Schedule.max([Schedule.exponential("2 seconds"), Schedule.recurs(4)]).pipe(
    Schedule.jittered,
    Schedule.setInputType<Input>(),
    Schedule.modifyDelay(({ input, duration: delay }) => {
      const minimum = retryAfter(input)
      const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
      return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
    }),
    Schedule.tap((metadata) =>
      bus.publish(SessionEvent.RetryScheduled, {
        sessionID,
        assistantMessageID: metadata.input.assistantMessageID,
        attempt: metadata.attempt + 1,
        at: metadata.now + Duration.toMillis(metadata.duration),
        error: metadata.input.error,
      }),
    ),
  )
