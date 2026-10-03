import { ClientError, OpenCode } from "@opencode/client"
import { Service, type Endpoint } from "@opencode/client/effect/service"
import { Effect } from "effect"

export const bootstrap = Effect.fn("Tui.bootstrap")(function* (
  server: {
    endpoint: Endpoint
    service?: { reconnect: (signal: AbortSignal) => Promise<Endpoint> }
  },
  directory: string,
) {
  return yield* connect(server.endpoint, directory).pipe(
    Effect.catch((error) => {
      const service = server.service
      if (!service || !(error instanceof ClientError) || error.reason !== "Transport") return Effect.fail(error)
      // Recovery is outside connect: a second transport failure cannot start another retry.
      return Effect.tryPromise({ try: (signal) => service.reconnect(signal), catch: (cause) => cause }).pipe(
        Effect.flatMap((endpoint) => connect(endpoint, directory)),
      )
    }),
    Effect.timeoutOrElse({
      duration: "2 minutes",
      orElse: () =>
        Effect.fail(
          new Error("Timed out connecting to the server during TUI startup. Check service status and try again."),
        ),
    }),
  )
})

const connect = Effect.fnUntraced(function* (endpoint: Endpoint, directory: string) {
  const api = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const location = yield* Effect.tryPromise({
    try: (signal) => api.file.list({ location: { directory } }, { signal }),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((response) => response.location),
    Effect.catch((error) => {
      // A lost connection needs a fresh endpoint, not another request to the same URL.
      if (error instanceof ClientError && error.reason === "Transport") return Effect.fail(error)
      return Effect.tryPromise({ try: (signal) => api.location.get(undefined, { signal }), catch: (cause) => cause })
    }),
  )
  return { api, endpoint, location }
})
