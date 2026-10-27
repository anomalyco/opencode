import { expect } from "bun:test"
import { DebugRuntime } from "@opencode/protocol/groups/debug-runtime"
import { Effect, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const decode = Schema.decodeUnknownSync(DebugRuntime)

it.live("reports runtime memory and long-lived structure sizes", () =>
  Effect.gen(function* () {
    const config = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-debug-runtime-")))
    const handler = yield* ServerFetch.make({
      app: { version: "test-version" },
      database: { path: ":memory:" },
      config: { project: false, directory: config.path },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const get = (query = "") =>
      Effect.promise(() =>
        handler(new Request(`http://opencode.local/api/experimental/debug/runtime${query}`)).then(async (response) => {
          expect(response.status).toBe(200)
          return decode(await response.json())
        }),
      )
    const read = get()

    const before = yield* read
    expect(before.pid).toBe(process.pid)
    expect(before.memory.rss).toBeGreaterThan(0)
    expect(before.objectTypes).toBeUndefined()
    expect((yield* get("?heap=true")).objectTypes?.["Object"]).toBeGreaterThan(0)
    expect(before.locations).toBe(0)
    expect(before.gauges["bus.live.backlog"]).toBe(0)
    expect(before.gauges["job"]).toBe(0)

    // Booting a Location registers its plugin registry.
    const location = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/location", {
          headers: { "x-opencode-directory": encodeURIComponent(config.path) },
        }),
      ),
    )
    expect(location.status).toBe(200)
    const after = yield* read
    expect(after.locations).toBe(1)
    expect(after.gauges["plugin.active"]).toBeGreaterThanOrEqual(0)
  }),
)
