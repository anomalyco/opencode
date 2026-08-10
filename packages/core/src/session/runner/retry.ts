export * as SessionRunnerRetry from "./retry"

import { AIError } from "@opencode-ai/ai"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Data, Duration, Effect, Schedule } from "effect"
import { Bus } from "../../bus"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"

export class RetryableFailure extends Data.TaggedError("SessionRunner.RetryableFailure")<{
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly step: number
}> {}

export function isRetryable(error: AIError) {
  switch (error.reason._tag) {
    case "RateLimit":
    case "ProviderInternal":
    case "Transport":
      return true
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

const retryAfter = (failure: RetryableFailure) => {
  if (failure.cause.reason._tag === "RateLimit" || failure.cause.reason._tag === "ProviderInternal")
    return failure.cause.reason.retryAfterMs
  return undefined
}

export const schedule = (
  bus: Bus.Interface,
  sessionID: SessionSchema.ID,
  assistantMessageID: () => SessionMessage.ID,
) =>
  Schedule.max([Schedule.exponential("2 seconds"), Schedule.recurs(4)]).pipe(
    Schedule.setInputType<RetryableFailure>(),
    Schedule.modifyDelay(({ input: failure, duration: delay }) => {
      const minimum = retryAfter(failure)
      return Effect.succeed(minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum)))
    }),
    Schedule.tap((metadata) =>
      bus.publish(SessionEvent.RetryScheduled, {
        sessionID,
        assistantMessageID: assistantMessageID(),
        attempt: metadata.attempt + 1,
        at: metadata.now + Duration.toMillis(metadata.duration),
        error: metadata.input.error,
      }),
    ),
  )
