import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live(
  "waits for plugin initialization on the first provider list request",
  () =>
    Effect.gen(function* () {
      const fixture = yield* configuredProvider("opencode-provider-list-endpoint-")
      const url = new URL("/api/provider", fixture.server.base)
      url.searchParams.set("location[directory]", fixture.path)
      const response = yield* Effect.promise(() => fetch(url, { headers: fixture.server.headers }))

      expect(response.status).toBe(200)
      const body: unknown = yield* Effect.promise(() => response.json())
      if (!isRecord(body) || !Array.isArray(body["data"])) throw new Error("Expected a provider list response")
      expect(body["data"].some((provider) => isRecord(provider) && provider["id"] === "custom")).toBeTrue()
    }),
  15_000,
)

it.live(
  "waits for plugin initialization on the first provider get request",
  () =>
    Effect.gen(function* () {
      const fixture = yield* configuredProvider("opencode-provider-get-endpoint-")
      const url = new URL("/api/provider/custom", fixture.server.base)
      url.searchParams.set("location[directory]", fixture.path)
      const response = yield* Effect.promise(() => fetch(url, { headers: fixture.server.headers }))

      expect(response.status).toBe(200)
      const body: unknown = yield* Effect.promise(() => response.json())
      if (!isRecord(body) || !isRecord(body["data"])) throw new Error("Expected a provider response")
      expect(body["data"]["id"]).toBe("custom")
    }),
  15_000,
)

const configuredProvider = Effect.fnUntraced(function* (prefix: string) {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir(prefix)))
  yield* Effect.promise(() =>
    fs.writeFile(
      path.join(tmp.path, "opencode.json"),
      JSON.stringify({
        providers: {
          custom: {
            package: "@opencode-ai/ai/providers/openai-compatible",
            settings: { apiKey: "secret" },
            models: { chat: {} },
          },
        },
      }),
    ),
  )
  return { server: yield* startServer(tmp.path), path: tmp.path }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
