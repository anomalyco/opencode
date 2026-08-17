// Subprocess integration tests for `opencode serve`. Spawns the real CLI in
// headless mode and exercises it over HTTP — this is the only test tier that
// catches bugs spanning argv → server boot → routing → instance loading.
//
// `serve` is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The bound port is parsed
// off the "listening on http://..." line — `--port 0` asks for 4096 first and
// falls back to an OS-assigned port only if that bind fails.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"

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
        // GlobalHealth returns { healthy: true, version } (handlers/global.ts).
        // We don't lock in further shape here — any 200 with parseable JSON is
        // enough proof that argv → server boot → routing works. It does NOT
        // prove instance loading: `serve` runs with instance: false and the
        // global health route loads no instance (src/cli/effect-cmd.ts).
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
        const client = yield* HttpClient.HttpClient
        const handle = yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* opencode.serve()
            const response = yield* client.get(`${server.url}/global/health`)
            expect(response.status).toBe(200)
            return { url: server.url, exited: server.exited }
          }),
        )

        yield* Effect.promise(() => handle.exited)

        const request = () =>
          client.get(`${handle.url}/global/health`).pipe(Effect.exit, Effect.timeout("1 second"))
        const first = yield* request()
        yield* Effect.sleep("75 millis")
        const second = yield* request()
        yield* Effect.sleep("75 millis")
        const third = yield* request()

        expect([first, second, third].map((result) => result._tag)).toEqual(["Failure", "Failure", "Failure"])
      }).pipe(Effect.timeout("20 seconds")),
    60_000,
  )
})
