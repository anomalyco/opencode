import { Schedule } from "effect"
import { HttpClient } from "effect/unstable/http"

/**
 * HTTP client utilities with retry logic for Effect.
 *
 * Provides retry configurations for transient HTTP failures using exponential
 * backoff with jitter to avoid thundering herd problems.
 *
 * @example
 * ```typescript
 * const client = HttpClient.make(...).pipe(withTransientReadRetry)
 * ```
 */

export const withTransientReadRetry = <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
  client.pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      times: 2,
      schedule: Schedule.exponential(200).pipe(Schedule.jittered),
    }),
  )
