import assert from "node:assert/strict"
import { Cause, Deferred, Effect, Exit, Fiber, Latch, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/unstable/http"
import { refuseNetwork } from "../../../core/test/lib/effect"
import { ServerProcess } from "../../src/process"

const phase = process.argv[2]
assert(phase === "ready" || phase === "failed")
const violations: string[] = []

await Effect.runPromise(
  Effect.gen(function* () {
    const listening = yield* Deferred.make<{ address: HttpServer.Address; shutdown: Effect.Effect<void> }>()
    const release = yield* Latch.make()
    const ready = yield* Latch.make()
    const server = yield* Effect.gen(function* () {
      const running = yield* ServerProcess.start(
        {
          hostname: "127.0.0.1",
          port: 0,
          password: "health-test",
          app: { version: "test-version" },
          // Opening a directory as SQLite deterministically fails real application boot.
          database: { path: phase === "failed" ? process.cwd() : ":memory:" },
          models: { fetch: false },
          config: { directory: process.cwd(), project: false },
          fs: { filewatcher: false, fff: false },
        },
        {
          onListen: (address, shutdown) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(listening, { address, shutdown })
              yield* release.await
              return Effect.void
            }),
        },
      )
      yield* ready.open
      yield* running.shutdown
    }).pipe(Effect.scoped, Effect.exit, Effect.forkScoped)

    yield* Effect.gen(function* () {
      const bound = yield* Deferred.await(listening)
      const base = HttpServer.formatAddress(bound.address)
      yield* checkHealth(base, 503)
      yield* release.open
      if (phase === "ready") yield* ready.await
      if (phase === "failed")
        yield* request(base, "/api/info").pipe(
          Effect.filterOrFail((response) => response.status === 500),
          Effect.retry(Schedule.spaced("10 millis")),
        )
      yield* checkHealth(base, phase === "ready" ? 200 : 500)
      yield* bound.shutdown
      const exit = yield* Fiber.join(server)
      if (phase === "ready") assert(Exit.isSuccess(exit))
      if (phase === "failed") {
        assert(Exit.isFailure(exit))
        assert(Cause.hasInterruptsOnly(exit.cause))
      }
    }).pipe(Effect.timeout("10 seconds"), Effect.ensuring(release.open))
  }).pipe(Effect.scoped, Effect.provideService(FetchHttpClient.Fetch, refuseNetwork(violations))),
)
assert.deepEqual(violations, [])
console.log(`health compatibility passed: ${phase}`)

function checkHealth(base: string, status: number) {
  return Effect.forEach(["/api/info", "/api/status"], (pathname) =>
    Effect.gen(function* () {
      const response = yield* request(base, pathname)
      assert.equal(response.status, status, `${pathname} lifecycle status`)
      assert.equal(response.retryAfter, status === 503 ? "1" : null)
      assert.deepEqual(
        Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String, pid: Schema.Number }))(response.body),
        { version: "test-version", pid: process.pid },
        `${pathname} process identity`,
      )
      for (const password of [null, "wrong-password"]) {
        const denied = yield* request(base, pathname, password)
        assert.equal(denied.status, 401, `${pathname} authentication`)
        assert.equal(denied.challenge, 'Basic realm="Secure Area"')
        assert.deepEqual(denied.body, { _tag: "UnauthorizedError", message: "Authentication required" })
      }
    }),
  )
}

function request(base: string, pathname: string, password: string | null = "health-test") {
  return Effect.tryPromise(async (signal) => {
    const response = await fetch(new URL(pathname, base), {
      headers: password === null ? undefined : { authorization: `Basic ${btoa(`opencode:${password}`)}` },
      signal,
    })
    const body: unknown = await response.json()
    return {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      challenge: response.headers.get("www-authenticate"),
      body,
    }
  }).pipe(Effect.timeout("1 second"))
}
