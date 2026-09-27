// Subprocess integration tests for `opencode serve`. Spawns the real CLI in
// headless mode and exercises it over HTTP — this is the only test tier that
// catches bugs spanning argv → server boot → routing → instance loading.
//
// `serve` is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The OS-assigned port is
// parsed off the "listening on http://..." line.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import path from "node:path"
import { pollWithTimeout } from "../../lib/effect"
import { cliIt } from "../../lib/cli-process"

const mcpStdioFixture = path.join(import.meta.dir, "../../fixture/mcp-lifecycle-stdio.ts")

describe("opencode serve (subprocess)", () => {
  // Smoke test: server starts, binds a port, and /global/health responds.
  // If this fails, all other serve tests likely will too — debug here first.
  cliIt.live(
    "starts, binds a port, and serves /global/health",
    ({ opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/^http:\/\//)

        const client = yield* HttpClient.HttpClient
        const res = yield* client.get(`${server.url}/global/health`)
        expect(res.status).toBe(200)
        // GlobalHealth schema is { success: true, ... } | { success: false, error }.
        // We don't lock in further shape here — any 200 with parseable JSON is
        // enough proof the routing + auth-bypass + instance loading is alive.
        const body = yield* res.json
        expect(body).toBeDefined()
      }),
    60_000,
  )

  // The scope-close finalizer must actually terminate the child. Without this
  // test a regression in the kill path (e.g. a future refactor that forgets
  // to wire the finalizer) would leak processes on every test run.
  cliIt.live(
    "kills the subprocess on scope close",
    ({ opencode }) =>
      Effect.gen(function* () {
        // Inner scope so we can observe `.exited` resolving after it closes.
        const exitedPromise = yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* opencode.serve()
            // Capture the Promise, not the resolved value — scope closes after
            // this gen returns, at which point the finalizer kills the child.
            return server.exited
          }),
        )
        // After scope close: finalizer fired, process must have exited.
        const code = yield* Effect.promise(() => exitedPromise)
        // Bun reports the exit code; SIGTERM-killed processes return non-null
        // (typically 143 on POSIX). We just require resolution within a sane
        // window — anything else means the kill didn't take.
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )

  // A `docker run` MCP server is a real child process the server owns. If
  // SIGTERM only kills the server itself, the MCP child is orphaned — this
  // is the bug reported in #50780. Sending real SIGTERM (not scope close)
  // must still run the graceful stop path and take the MCP child with it.
  cliIt.live(
    "SIGTERM to the server also terminates a connected local MCP child",
    ({ opencode, home }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        const client = yield* HttpClient.HttpClient
        const pidFile = path.join(home, "mcp.pid")

        const added = yield* HttpClientRequest.post(`${server.url}/mcp`).pipe(
          HttpClientRequest.setHeader("x-opencode-directory", home),
          HttpClientRequest.bodyJson({
            name: "fake-docker",
            config: {
              type: "local",
              command: [process.execPath, mcpStdioFixture, "--keep-alive"],
              environment: { MCP_LIFECYCLE_PID_FILE: pidFile },
            },
          }),
          Effect.flatMap(client.execute),
        )
        expect(added.status).toBe(200)

        const pid = yield* pollWithTimeout(
          Effect.promise(async () => {
            const file = Bun.file(pidFile)
            return (await file.exists()) ? Number(await file.text()) : undefined
          }),
          "MCP child did not publish its pid",
        )

        server.kill()
        yield* Effect.promise(() => server.exited)

        yield* pollWithTimeout(
          Effect.sync(() => {
            try {
              process.kill(pid, 0)
              return undefined
            } catch {
              return true
            }
          }),
          "MCP child was not terminated after server SIGTERM",
        )
      }),
    60_000,
  )
})
