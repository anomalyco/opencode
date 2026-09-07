import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { it, refuseNetwork } from "./lib/effect"

describe("test harness network guard", () => {
  test("refuses requests to hosts other than loopback", async () => {
    const violations: string[] = []
    const refused = refuseNetwork(violations)
    await expect(refused("https://models.opencode.ai/api.json")).rejects.toThrow(
      "test attempted network request: GET https://models.opencode.ai/api.json — provide an explicit HttpClient or disable the fetch",
    )
    await expect(refused(new Request("https://example.invalid/", { method: "POST" }))).rejects.toThrow(
      "test attempted network request: POST https://example.invalid/",
    )
    expect(violations).toHaveLength(2)
  })

  it.live("the default http client node requests through the harness fetch", () =>
    Effect.gen(function* () {
      const seen: string[] = []
      const response = yield* HttpClient.get("https://example.invalid/catalog").pipe(
        Effect.flatMap((response) => response.text),
        Effect.provide(AppNodeBuilder.build(LayerNodePlatform.httpClient)),
        Effect.provideService(
          FetchHttpClient.Fetch,
          Object.assign(
            (input: string | URL | Request) => {
              seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
              return Promise.resolve(new Response("from fetch"))
            },
            { preconnect: fetch.preconnect },
          ),
        ),
      )
      expect(response).toBe("from fetch")
      expect(seen).toEqual(["https://example.invalid/catalog"])
    }),
  )

  it.live("an explicit HttpClient replacement is what the node sees", () =>
    Effect.gen(function* () {
      const mock = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response("from mock"))),
      )
      const response = yield* HttpClient.get("https://example.invalid/catalog").pipe(
        Effect.flatMap((response) => response.text),
        Effect.provide(
          AppNodeBuilder.build(LayerNodePlatform.httpClient, [
            LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, mock)),
          ]),
        ),
      )
      expect(response).toBe("from mock")
    }),
  )

  it.live("loopback requests pass through to the real fetch", () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("local") })),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const response = yield* HttpClient.get(`http://127.0.0.1:${server.port}/`).pipe(
        Effect.flatMap((response) => response.text),
        Effect.provide(AppNodeBuilder.build(LayerNodePlatform.httpClient)),
      )
      expect(response).toBe("local")
    }),
  )
})
