export * as ModelRetry from "./model-retry.js"

import { AIError, isRetryable } from "@opencode/ai/effect"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"

interface Input {
  readonly cause: AIError
  readonly retry: boolean
}

/** Bound provider-requested delays so a hostile or buggy retry-after cannot stall a call for hours. */
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")

const retryAfter = (input: Input) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs === undefined
      ? undefined
      : Math.min(input.cause.reason.retryAfterMs, RETRY_AFTER_MAX)
  return undefined
}

// Exponential from 2s capped at 10s per gap, for 10 retries: 2, 4, 8, then 10 × 7, about 84s of
// waiting when every attempt fails (67–101s with jitter). `min` takes the faster schedule, so the
// cap applies per gap; `max` with `recurs` bounds the count.
const schedule = Schedule.max([
  Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")]),
  Schedule.recurs(10),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  Schedule.modifyDelay(({ input, duration: delay }) => {
    const minimum = retryAfter(input)
    const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
    return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
  }),
)

// This machine has no network path to the provider: the host name didn't resolve, or there is no route or interface.
// While that lasts every attempt fails before reaching the provider, and the outage behind it (a router restart, a
// dropped VPN, a laptop between networks) usually outlasts the general allowance, so these retry on their own budget:
// exponential from 2s capped at 30s per gap, for up to an hour after the first one. A refused connection is left out:
// something answered, so it is the server's state. Bun's fetch reports a failed getaddrinfo as ENOTFOUND, EAI_AGAIN,
// EBADRESP (EAI_FAIL), ESERVFAIL (EAI_SYSTEM) or, on glibc, ETIMEOUT.
const LOOKUP_CODES = ["ENOTFOUND", "EAI_AGAIN", "EBADRESP", "ESERVFAIL", "ETIMEOUT"]
export const UNREACHABLE_CODES = new Set([...LOOKUP_CODES, "ENETUNREACH", "EHOSTUNREACH", "ENETDOWN"])
export const UNREACHABLE_WINDOW = Duration.hours(1)
const UNREACHABLE_GAP_MAX = 30_000

/** Whether the failure says this machine has no network path to the provider's host. */
export const isUnreachable = (error: AIError) =>
  error.reason._tag === "Transport" && error.reason.code !== undefined && UNREACHABLE_CODES.has(error.reason.code)

const unreachableSchedule = Schedule.max([
  Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced(Duration.millis(UNREACHABLE_GAP_MAX))]),
  Schedule.during(UNREACHABLE_WINDOW),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  // Jitter scales the capped gap by up to 1.2, so cap it again after.
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.millis(Math.min(Math.ceil(Duration.toMillis(duration)), UNREACHABLE_GAP_MAX))),
  ),
)

// A timed-out attempt already waited minutes before failing, so the general allowance would let a
// dead provider hold a call for most of an hour. Cap those attempts well below it.
const MAX_TIMEOUT_RETRIES = 3

export const policy = Effect.gen(function* () {
  const step = yield* Schedule.toStep(schedule)
  const unreachable = yield* Schedule.toStep(unreachableSchedule)
  let attempt = 1
  let timeouts = 0
  return (input: Input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      // Unreachable failures don't spend the general allowance, so a flaky link that also drops streams keeps it.
      const next = yield* (input.retry && isUnreachable(input.cause) ? unreachable : step)(now, input).pipe(
        Pull.catchDone(() => Effect.succeed(undefined)),
      )
      if (!next) return undefined
      const [, duration] = next
      attempt++
      if (input.cause.reason._tag === "Transport" && input.cause.reason.code === "Timeout") timeouts++
      return {
        attempt,
        delay: Math.ceil(Duration.toMillis(duration)),
        retry: input.retry && timeouts <= MAX_TIMEOUT_RETRIES,
      }
    })
})

/** Retry a buffered model call from scratch; failed attempts never contribute to its returned output. */
export const retry = <A, R>(effect: Effect.Effect<A, AIError, R>) =>
  Effect.gen(function* () {
    const decide = yield* policy
    while (true) {
      const result = yield* Effect.result(effect)
      if (result._tag === "Success") return result.success
      const decision = yield* decide({ cause: result.failure, retry: isRetryable(result.failure) })
      if (!decision?.retry) return yield* result.failure
      yield* Effect.sleep(Duration.millis(decision.delay))
    }
  })

// One-shot generations (stateless text, images, decisions) can be billed per attempt, so they retry only failures
// the provider never ran, a few times, with the same backoff and retry-after handling.
const ONE_SHOT_RETRIES = 3
// Only codes that fail before a connection exists: a dropped interface or route can also fail a response already being read.
const NOT_SENT_CODES = new Set(["ECONNREFUSED", ...LOOKUP_CODES])

const notRun = (error: AIError) => {
  const override = error.reason.http?.headers["x-should-retry"]
  if (override === "true") return true
  if (override === "false") return false
  const reason = error.reason
  if (reason._tag === "RateLimit") return true
  if (reason._tag === "ProviderInternal") return reason.http?.status === 503 || reason.http?.status === 529
  if (reason._tag === "Transport")
    return reason.delivery === "not-sent" || (reason.code !== undefined && NOT_SENT_CODES.has(reason.code))
  return false
}

/** Retry a one-shot call only when the provider clearly didn't run it: rate limits, overload, unreachable hosts. */
export const retryOneShot = <A, R>(effect: Effect.Effect<A, AIError, R>) =>
  Effect.gen(function* () {
    const decide = yield* policy
    let retries = 0
    while (true) {
      const result = yield* Effect.result(effect)
      if (result._tag === "Success") return result.success
      const decision = yield* decide({ cause: result.failure, retry: notRun(result.failure) })
      if (!decision?.retry || retries++ >= ONE_SHOT_RETRIES) return yield* result.failure
      yield* Effect.sleep(Duration.millis(decision.delay))
    }
  })
