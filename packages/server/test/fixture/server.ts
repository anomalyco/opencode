import { Effect, Schedule } from "effect"
import { HttpServer } from "effect/http"
import { ServerProcess } from "../../src/process"

export const startServer = Effect.fnUntraced(function* (directory: string) {
  const server = yield* ServerProcess.start<never, never>({
    hostname: "127.0.0.1",
    port: 0,
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
    config: { directory },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  return {
    base: HttpServer.formatAddress(server.address),
    headers: { authorization: `Basic ${btoa("opencode:secret")}` },
  }
})

/** A one-shot test client, unlike an attached browser, can reach the fresh Location before its agent policy exists. */
export const waitForAgentPolicy = (server: { base: string; headers: Record<string, string> }, directory: string) => {
  const url = new URL("/api/plugin", server.base)
  url.searchParams.set("location[directory]", directory)
  return Effect.promise(async () => {
    const response = await fetch(url, { headers: server.headers })
    const inventory = await response.json()
    return inventory.data.some(
      (plugin: { id: string; state: { status: string } }) =>
        plugin.id === "opencode.config.agent" && plugin.state.status === "active",
    )
  }).pipe(Effect.repeat({ until: Boolean, schedule: Schedule.spaced("25 millis") }), Effect.timeout("5 seconds"))
}
