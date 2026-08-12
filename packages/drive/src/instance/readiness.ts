import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import type * as Process from "./process.js"
import { instanceError, type OpenCodeInstanceError } from "./error.js"

/** Allocates a free localhost port by briefly binding an ephemeral server. */
export const freePort = Effect.tryPromise({
  try: async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(),
    })
    const port = server.port
    await server.stop(true)
    return port
  },
  catch: (cause) => instanceError("allocate port", cause),
})

/**
 * Polls a WebSocket endpoint until it accepts connections, failing early when
 * the owning process exits or the timeout elapses.
 */
export const waitForWebSocket = Effect.fn("OpenCodeInstance.waitForWebSocket")(
  (url: string, process: Process.Running, timeout: number) =>
    Effect.raceFirst(
      open(url).pipe(Effect.retry(Schedule.spaced(50))),
      process.exitCode.pipe(
        Effect.flatMap((status) =>
          Effect.fail(
            instanceError(
              "wait for endpoint",
              `OpenCode exited with status ${status} before ${url} became ready`,
            ),
          ),
        ),
      ),
    ).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            instanceError("wait for endpoint", `timed out waiting for drive endpoint ${url}`),
          ),
      }),
    ),
)

const open = (url: string) =>
  Effect.callback<void, OpenCodeInstanceError>((resume) => {
    const socket = new WebSocket(url)
    const onOpen = () => {
      cleanup()
      socket.terminate()
      resume(Effect.void)
    }
    const onError = () => {
      cleanup()
      socket.terminate()
      resume(Effect.fail(instanceError("connect", `cannot connect to ${url}`)))
    }
    const cleanup = () => {
      socket.removeEventListener("open", onOpen)
      socket.removeEventListener("error", onError)
    }
    socket.addEventListener("open", onOpen)
    socket.addEventListener("error", onError)
    return Effect.sync(() => {
      cleanup()
      socket.terminate()
    })
  })
