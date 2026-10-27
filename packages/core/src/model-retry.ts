export * as ModelRetry from "./model-retry.js"

import { AIError, isRetryable } from "@opencode/ai/effect"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"

interface Input {
  readonly cause: AIError
  readonly retry: boolean
}

/** Bound provider-requested delays so a hostile or buggy retry-after cannot stall a call for hours. */
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")
const RETRY_BACKOFF_MAX = 10_000

// Providers with minute-scale quota windows can outlast the default allowance (10 attempts, ~84s
// of backoff) and drop turns while the error is still transient. The budget is env-tunable so a
// deployment facing such windows can keep polling instead: OPENCODE_RETRY_MAX_RETRIES raises the
// attempt cap ("infinite", any case, removes it) and OPENCODE_RETRY_MAX_DELAY_MS bounds every wait
// between attempts — the backoff step and any honored retry-after alike. Unset or invalid values
// keep the defaults. Values are clamped below 2^31 so a timer never overflows into an
// immediate-retry storm.
const envNumber = (name: string) => {
  const parsed = Number(process.env[name] ?? "")
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 2_147_483_647) : undefined
}

const envCount = (name: string, fallback: number) =>
  process.env[name]?.toLowerCase() === "infinite" ? Number.POSITIVE_INFINITY : (envNumber(name) ?? fallback)

const retryAfter = (input: Input, max: number) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs === undefined ? undefined : Math.min(input.cause.reason.retryAfterMs, max)
  return undefined
}

// Exponential from 2s capped at 10s per gap, for 10 retries: 2, 4, 8, then 10 × 7, about 84s of
// waiting when every attempt fails (67–101s with jitter). `min` takes the faster schedule, so the
// cap applies per gap; `max` with `recurs` bounds the count. An unbounded count drops the `recurs`
// arm instead of pairing it with Infinity, which `Schedule.recurs` leaves undefined.
const makeSchedule = (maxRetries: number, backoffMax: number, retryAfterMax: number) => {
  const backoff = Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced(backoffMax)])
  const schedule = Number.isFinite(maxRetries) ? Schedule.max([backoff, Schedule.recurs(maxRetries)]) : backoff
  return schedule.pipe(
    Schedule.jittered,
    Schedule.setInputType<Input>(),
    Schedule.modifyDelay(({ input, duration: delay }) => {
      const minimum = retryAfter(input, retryAfterMax)
      const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
      return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
    }),
  )
}

// A timed-out attempt already waited minutes before failing, so the general allowance would let a
// dead provider hold a call for most of an hour. Cap those attempts well below it.
const MAX_TIMEOUT_RETRIES = 3

export const policy = Effect.gen(function* () {
  const delayMax = envNumber("OPENCODE_RETRY_MAX_DELAY_MS")
  const schedule = makeSchedule(
    envCount("OPENCODE_RETRY_MAX_RETRIES", 10),
    delayMax ?? RETRY_BACKOFF_MAX,
    delayMax ?? RETRY_AFTER_MAX,
  )
  const step = yield* Schedule.toStep(schedule)
  let attempt = 1
  let timeouts = 0
  return (input: Input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const next = yield* step(now, input).pipe(Pull.catchDone(() => Effect.succeed(undefined)))
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
