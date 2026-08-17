import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("waits for plugin initialization before listing models", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-model-endpoint-")),
    (tmp) =>
      Effect.gen(function* () {
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
        const server = yield* ServerProcess.start<never, never>({
          hostname: "127.0.0.1",
          port: 0,
          password: "secret",
          app: { version: "test-version" },
          database: { path: ":memory:" },
          config: { directory: tmp.path },
          fs: { filewatcher: false },
        })
        const url = new URL("/api/model", HttpServer.formatAddress(server.address))
        url.searchParams.set("location[directory]", tmp.path)
        const response = yield* Effect.promise(() =>
          fetch(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
        )

        expect(response.status).toBe(200)
        const body: unknown = yield* Effect.promise(() => response.json())
        if (!isRecord(body) || !Array.isArray(body["data"])) throw new Error("Expected a model list response")
        expect(
          body["data"].some((model) => isRecord(model) && model["providerID"] === "custom" && model["id"] === "chat"),
        ).toBeTrue()
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
