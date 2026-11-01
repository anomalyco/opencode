import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const server = ServerFetch.make({
  app: { version: "test" },
  database: { path: ":memory:" },
  fs: { filewatcher: false },
})

const createSession = (location: unknown) =>
  Effect.gen(function* () {
    const handler = yield* server
    return yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ location }),
        }),
      ),
    )
  })

it.live("rejects a session location directory with a NUL byte", () =>
  Effect.gen(function* () {
    const response = yield* createSession({ directory: "/tmp\u0000" })
    expect(response.status).toBe(400)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "InvalidRequestError" })
  }).pipe(Effect.scoped),
)

it.live("rejects a relative location directory when creating a session", () =>
  Effect.gen(function* () {
    const response = yield* createSession({ directory: "relative/dir" })
    expect(response.status).toBe(400)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "InvalidRequestError" })
  }).pipe(Effect.scoped),
)
