import { afterEach, expect } from "bun:test"
import { createServer, type Server } from "node:http"
import { streamText } from "ai"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node, CrossSpawnSpawner.node])),
)

it.live("apiKey array round-robins across requests", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => authHeaderServer()),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const language = yield* provider.getLanguage(model)
          for (let i = 0; i < 3; i++) {
            const result = streamText({
              model: language,
              messages: [{ role: "user", content: "hello" }],
            })
            expect(yield* Effect.promise(() => result.text)).toBe("ok")
          }
          expect(server.headers).toEqual(["Bearer key-1", "Bearer key-2", "Bearer key-1"])
        }),
      { config: providerConfig(server.url) },
    )
  }),
)

it.live("apiKey array of one sends that key", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => authHeaderServer()),
      (server) => Effect.sync(() => server.server.close()),
    )

    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            messages: [{ role: "user", content: "hello" }],
          })
          expect(yield* Effect.promise(() => result.text)).toBe("ok")
          expect(server.headers).toEqual(["Bearer solo-key"])
        }),
      { config: providerConfig(server.url, ["solo-key"]) },
    )
  }),
)

function providerConfig(url: string, keys: string[] = ["key-1", "key-2"]) {
  const config = testProviderConfig(url)
  return {
    ...config,
    provider: {
      test: {
        ...config.provider.test,
        options: { ...config.provider.test.options, apiKey: keys },
      },
    },
  }
}

async function authHeaderServer(): Promise<{ server: Server; url: string; headers: string[] }> {
  const headers: string[] = []
  const server = createServer((req, res) => {
    headers.push(req.headers.authorization ?? "")
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port")
  return { server, url: `http://127.0.0.1:${address.port}`, headers }
}
