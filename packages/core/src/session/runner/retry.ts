export * as SessionRunnerRetry from "./retry.js"

import { AIError } from "@opencode-ai/ai"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Data, Duration, Effect, Schedule } from "effect"
import { Bus } from "../../bus.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"

export class RetryableFailure extends Data.TaggedError("SessionRunner.RetryableFailure")<{
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly step: number
}> {}

function providerRetryOverride(error: AIError) {
  if (!("http" in error.reason)) return undefined
  const headers = error.reason.http?.response?.headers
  if (!headers) return undefined
  const header = Object.entries(headers).find((entry) => entry[0].toLowerCase() === "x-should-retry")
  const value = header?.[1].trim().toLowerCase()
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

export function isRetryable(error: AIError) {
  const override = providerRetryOverride(error)
  if (override !== undefined) return override
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
    Schedule.jittered,
    Schedule.setInputType<RetryableFailure>(),
    Schedule.modifyDelay(({ input: failure, duration: delay }) => {
      const minimum = retryAfter(failure)
      const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
      return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
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
