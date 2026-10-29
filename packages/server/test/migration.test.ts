import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("requires an explicit affirmative acknowledgment at the migration endpoint", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    for (const [payload, status] of [
      [{}, 400],
      [{ acknowledged: false }, 400],
      [{ acknowledged: true }, 200],
    ] as const) {
      const response = yield* Effect.promise(() =>
        handler(
          new Request("http://opencode.local/api/experimental/migration/v1/accept", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        ),
      )
      expect(response.status).toBe(status)
    }
  }),
)
