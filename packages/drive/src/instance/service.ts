import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import { instanceError } from "./error.js"
import { isProcessAlive } from "./registry.js"

/**
 * Terminates any OpenCode managed services discovered through the instance's
 * private state directory, escalating from SIGTERM to SIGKILL.
 */
export const stopService = Effect.fn("OpenCodeInstance.stopService")(function* (
  state: string,
) {
  const files = [
    join(state, "opencode", "server.json"),
    join(state, "opencode", "service-local.json"),
    join(state, "opencode", "service.json"),
  ]
  const info = yield* Effect.tryPromise({
    try: () =>
      Promise.all(
        files.map((file) =>
          Bun.file(file)
            .json()
            .catch(() => undefined),
        ),
      ),
    catch: (cause) => instanceError("read service state", cause),
  })
  yield* Effect.forEach(info, (value) => {
    if (!isServiceInfo(value)) return Effect.void
    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        try {
          process.kill(value.pid, "SIGTERM")
        } catch {
          return
        }
      })
      yield* Effect.suspend(() =>
        isProcessAlive(value.pid) ? Effect.fail(undefined) : Effect.void,
      ).pipe(
        Effect.retry(
          Schedule.spaced(25).pipe(
            Schedule.upTo({ times: 39 }),
          ),
        ),
        Effect.catch(() => Effect.void),
      )
      if (isProcessAlive(value.pid))
        yield* Effect.sync(() => process.kill(value.pid, "SIGKILL"))
    })
  }, { concurrency: "unbounded", discard: true })
})

function isServiceInfo(value: unknown): value is { readonly pid: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "pid" in value &&
    typeof value.pid === "number"
  )
}
