import { Schedule } from "effect"
import { HttpClient } from "effect/unstable/http"

/**
 * HTTP client with transient read retry capability.
 *
 * Provides a wrapper that adds exponential backoff retry with jitter
 * for transient HTTP errors and failed responses.
 *
 * @param client - The HttpClient to wrap with retry logic
 * @returns The client with retry behavior applied
 *
 * @example
 * ```typescript
 * const client = withTransientReadRetry(HttpClient.makeDefault())
 * const response = await client.get("https://api.example.com/data")
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
