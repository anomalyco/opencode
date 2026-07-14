import { Effect } from "effect"

export function availableEndpoint() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const endpoint = `ws://127.0.0.1:${server.port}`
  server.stop(true)
  return endpoint
}

export function connect(endpoint: string) {
  return Effect.acquireRelease(
    Effect.callback<WebSocket, Error>((resume) => {
      const socket = new WebSocket(endpoint)
      const open = () => resume(Effect.succeed(socket))
      const error = () => resume(Effect.fail(new Error(`Failed to connect to ${endpoint}`)))
      socket.addEventListener("open", open, { once: true })
      socket.addEventListener("error", error, { once: true })
      return Effect.sync(() => {
        socket.removeEventListener("open", open)
        socket.removeEventListener("error", error)
        socket.close()
      })
    }),
    (socket) => Effect.sync(() => socket.close()),
  )
}
