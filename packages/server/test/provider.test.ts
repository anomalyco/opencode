import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live(
  "lists providers without blocking on plugin initialization",
  () =>
    Effect.gen(function* () {
      const fixture = yield* configuredProvider("opencode-provider-list-endpoint-")
      const url = new URL("/api/provider", fixture.server.base)
      url.searchParams.set("location[directory]", fixture.path)
      yield* Effect.promise(async () => {
        const response = await fetch(url, { headers: fixture.server.headers })
        if (response.status !== 200) return false
        const body: unknown = await response.json()
        return isRecord(body) && Array.isArray(body["data"])
          ? body["data"].some((provider) => isRecord(provider) && provider["id"] === "custom")
          : false
      }).pipe(
        Effect.filterOrFail((found) => found),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
    }),
  15_000,
)

it.live(
  "gets providers without blocking on plugin initialization",
  () =>
    Effect.gen(function* () {
      const fixture = yield* configuredProvider("opencode-provider-get-endpoint-")
      const url = new URL("/api/provider/custom", fixture.server.base)
      url.searchParams.set("location[directory]", fixture.path)
      const body: unknown = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, { headers: fixture.server.headers })
          if (response.status !== 200) throw new Error(`Provider not ready: ${response.status}`)
          return response.json()
        },
        catch: (cause) => cause,
      }).pipe(Effect.retry(Schedule.spaced("10 millis")), Effect.timeout("2 seconds"))
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
