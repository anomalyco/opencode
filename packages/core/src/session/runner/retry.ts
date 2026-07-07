export * as SessionRunnerRetry from "./retry"

import { LLMError } from "@opencode-ai/llm"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Data, Duration, Effect, Schedule } from "effect"
import { EventV2 } from "../../event"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import type { SessionRunner } from "./index"

export class RetryableFailure extends Data.TaggedError("SessionRunner.RetryableFailure")<{
  readonly cause: LLMError
  readonly assistantMessageID: SessionMessage.ID
  readonly error: SessionError.Error
  readonly step: number
}> {}

export function isRetryable(error: LLMError) {
  switch (error.reason._tag) {
    case "RateLimit":
    case "ProviderInternal":
    case "Transport":
      return true
    case "Authentication":
    case "QuotaExceeded":
    case "ContentPolicy":
    case "InvalidProviderOutput":
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

export const schedule = (events: EventV2.Interface, sessionID: SessionSchema.ID) =>
  Schedule.exponential("2 seconds").pipe(
    Schedule.take(4),
    Schedule.setInputType<RetryableFailure | SessionRunner.RunError>(),
    Schedule.passthrough,
    Schedule.while(({ input }) => input instanceof RetryableFailure),
    Schedule.modifyDelay((failure, delay) => {
      const minimum = failure instanceof RetryableFailure ? retryAfter(failure) : undefined
      return Effect.succeed(minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum)))
    }),
    Schedule.tap((metadata) =>
      metadata.input instanceof RetryableFailure
        ? events.publish(SessionEvent.RetryScheduled, {
            sessionID,
            assistantMessageID: metadata.input.assistantMessageID,
            attempt: metadata.attempt + 1,
            at: metadata.now + Duration.toMillis(metadata.duration),
            error: metadata.input.error,
          })
        : Effect.void,
    ),
  )
