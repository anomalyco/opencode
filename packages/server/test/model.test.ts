import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("lists configured models on the first request after plugin initialization", () =>
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
      return body["data"].some((model) => isRecord(model) && model["providerID"] === "custom" && model["id"] === "chat")
    })
    expect(yield* request()).toBe(true)
  }),
)

it.live("bootstraps discovery on the first HTTP model read after key login", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch: async (request) => {
          if (request.headers.get("authorization") !== "Bearer saved-model-key")
            return new Response(null, { status: 401 })
          await Bun.sleep(30)
          return Response.json({ data: [{ id: "remote-worker", context_window: 262144 }] })
        },
      }),
    ),
    (gateway) =>
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-model-login-")))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, "opencode.json"),
            JSON.stringify({
              providers: { gateway: { settings: { baseURL: `${gateway.url.origin}/v1`, modelDiscovery: true } } },
            }),
          ),
        )
        const server = yield* startServer(tmp.path)
        const url = (pathname: string) => {
          const result = new URL(pathname, server.base)
          result.searchParams.set("location[directory]", tmp.path)
          return result
        }
        const initial = yield* Effect.promise(() => fetch(url("/api/model"), { headers: server.headers }))
        expect(initial.status).toBe(200)
        const connected = yield* Effect.promise(() =>
          fetch(url("/api/integration/gateway/connect/key"), {
            method: "POST",
            headers: { ...server.headers, "content-type": "application/json" },
            body: JSON.stringify({ key: "saved-model-key" }),
          }),
        )
        expect(connected.status).toBe(204)
        const listed = yield* Effect.promise(() => fetch(url("/api/model"), { headers: server.headers }))
        expect(listed.status).toBe(200)
        const body: unknown = yield* Effect.promise(() => listed.json())
        expect(
          isRecord(body) &&
            Array.isArray(body["data"]) &&
            body["data"].some(
              (model) =>
                isRecord(model) &&
                model["providerID"] === "gateway" &&
                model["id"] === "remote-worker" &&
                isRecord(model["limit"]) &&
                model["limit"]["context"] === 262144,
            ),
        ).toBe(true)
      }),
    (gateway) => Effect.promise(() => gateway.stop(true)),
  ),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
