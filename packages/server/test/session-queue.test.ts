import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("admits queued selections without changing the active session", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-queue-")))
    const handler = yield* ServerFetch.make({
      app: { version: "test-version" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const id = "ses_queue_selection"
    const selection = { agent: "plan", model: { providerID: "demo", id: "model", variant: "high" } }
    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, agent: "build", location: { directory: tmp.path } }),
        }),
      ),
    )
    expect(created.status).toBe(200)
    const queued = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/session/${id}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "Review next", delivery: "queue", resume: false, ...selection }),
        }),
      ),
    )
    expect(queued.status).toBe(200)
    expect(yield* Effect.promise(() => queued.json())).toMatchObject({
      data: { delivery: "queue", payload: selection },
    })
    const session = yield* Effect.promise(() => handler(new Request(`http://opencode.local/api/session/${id}`)))
    expect(yield* Effect.promise(() => session.json())).toMatchObject({ data: { agent: "build" } })
  }),
)
