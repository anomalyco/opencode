import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "../../src/provider/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const SAP_AI_CORE = ProviderV2.ID.make("sap-ai-core")
const it = testEffect(LayerNode.compile(Provider.node))

const withEnv = <A, E, R>(values: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]] as const))
      Object.entries(values).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

describe("sap-ai-core provider", () => {
  it.instance(
    "autoloads when AICORE_SERVICE_KEY is set and configures fetch wrapper",
    () =>
      withEnv(
        {
          AICORE_SERVICE_KEY: '{"serviceUrl":"https://test","clientId":"id","clientSecret":"secret"}',
          AICORE_DEPLOYMENT_ID: "deploy-123",
          AICORE_RESOURCE_GROUP: "default",
        },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          expect(providers[SAP_AI_CORE]).toBeDefined()
          expect(providers[SAP_AI_CORE].options?.deploymentId).toBe("deploy-123")
          expect(providers[SAP_AI_CORE].options?.resourceGroup).toBe("default")
          expect(typeof providers[SAP_AI_CORE].options?.fetch).toBe("function")

          // Test the fetch wrapper normalizes finish_reason in SSE stream
          const customFetch = providers[SAP_AI_CORE].options!.fetch
          const chunk = `data: {"choices":[{"delta":{"content":"Hi!"},"finish_reason":null,"index":0}]}\n\n`

          yield* Effect.promise(async () => {
            const originalFetch = globalThis.fetch
            globalThis.fetch = (async () =>
              new Response(
                new ReadableStream({
                  start(ctrl) {
                    ctrl.enqueue(new TextEncoder().encode(chunk))
                    ctrl.close()
                  },
                }),
                {
                  status: 200,
                  headers: { "content-type": "text/event-stream" },
                },
              )) as any

            try {
              const res = await customFetch("https://api.test/v1/chat")
              const text = await res.text()
              expect(text).toContain('"finish_reason":"stop"')
              expect(text).not.toContain('"finish_reason":null')
            } finally {
              globalThis.fetch = originalFetch
            }
          })
        }),
      ),
    { config: {} },
  )
})
