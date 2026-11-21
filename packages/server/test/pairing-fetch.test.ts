import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("rejects pairing redemption when an embedded server has no password", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test-version" },
      database: { path: ":memory:" },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    for (const method of ["GET", "POST"]) {
      const issued = yield* Effect.promise(() =>
        handler(new Request("http://opencode.local/api/pair", { method: "POST" })),
      )
      expect(issued.status).toBe(200)
      const pairing = (yield* Effect.promise(() => issued.json())) as { code: string }
      const response = yield* Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/auth/connect/${pairing.code}`, {
            method,
            headers: { host: "opencode.local", origin: "http://opencode.local" },
          }),
        ),
      )
      expect(response.status).toBe(401)
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(yield* Effect.promise(() => response.text())).toContain("expired or")
    }
  }),
)
