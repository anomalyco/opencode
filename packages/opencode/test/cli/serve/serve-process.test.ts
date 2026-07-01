// Subprocess integration tests for `opencode serve`. Spawns the real CLI in
// headless mode and exercises it over HTTP — this is the only test tier that
// catches bugs spanning argv → server boot → routing → instance loading.
//
// `serve` is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The OS-assigned port is
// parsed off the "listening on http://..." line.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"
import { withTimeout } from "../../../src/util/timeout"

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

  cliIt.live(
    "exits after the last global event client disconnects when requested",
    ({ opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve({ extraArgs: ["--shutdown-after-last-client"] })
        const abort = new AbortController()
        const response = yield* Effect.promise(() => fetch(`${server.url}/global/event`, { signal: abort.signal }))
        expect(response.status).toBe(200)
        const reader = response.body?.getReader()
        if (!reader) throw new Error("global event response has no body")
        const first = yield* Effect.promise(() =>
          withTimeout(reader.read(), 5_000, "timed out waiting for global event stream"),
        )
        if (first.done || !first.value) throw new Error("global event stream closed before first event")
        expect(new TextDecoder().decode(first.value)).toContain("server.connected")

        yield* Effect.promise(() => reader.cancel().catch(() => undefined))
        abort.abort()
        const code = yield* Effect.promise(() =>
          withTimeout(server.exited, 10_000, "timed out waiting for self-managed serve exit"),
        )
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )
})
