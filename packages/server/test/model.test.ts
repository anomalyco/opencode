import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("lists models without blocking on plugin initialization", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-model-endpoint-")))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(tmp.path, "opencode.json"),
        JSON.stringify({
          providers: {
            custom: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { apiKey: "secret" },
              models: { chat: {} },
            },
          },
        }),
      ),
    )
    const server = yield* startServer(tmp.path)
    const url = new URL("/api/model", server.base)
    url.searchParams.set("location[directory]", tmp.path)
    const request = Effect.fnUntraced(function* () {
      const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(response.status).toBe(200)
      const body: unknown = yield* Effect.promise(() => response.json())
      if (!isRecord(body) || !Array.isArray(body["data"])) throw new Error("Expected a model list response")
      return body["data"].some(
        (model) => isRecord(model) && model["providerID"] === "custom" && model["id"] === "chat",
      )
    })
    yield* request().pipe(
      Effect.filterOrFail((found) => found),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("2 seconds"),
    )
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
