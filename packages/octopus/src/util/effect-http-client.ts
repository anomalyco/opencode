import { Schedule } from "effect"
import { HttpClient } from "effect/unstable/http"

export const withTransientReadRetry = <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
  client.pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      times: 2,
      schedule: Schedule.exponential(200).pipe(Schedule.jittered),
    }),
  )
