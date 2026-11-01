import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

// Mirrors the cold-location race covered for model.list: plugin.list must await
// plugin activation before reading the inventory, or configured local plugins
// that register during an async setup are missing from the first response.
it.live("waits for plugin initialization before listing plugins", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plugin-endpoint-")))
    const plugin = path.join(import.meta.dir, "fixture/await-plugin")
    yield* Effect.promise(() =>
      fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ plugins: [{ package: plugin }] })),
    )
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/plugin", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))

    expect(response.status).toBe(200)
    const body: unknown = yield* Effect.promise(() => response.json())
    if (!isRecord(body) || !Array.isArray(body["data"])) throw new Error("Expected a plugin list response")
    expect(
      body["data"].some((item) => isRecord(item) && item["id"] === "opencode.test.await"),
      `expected the configured await plugin in ${JSON.stringify(body["data"])}`,
    ).toBeTrue()
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
