import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { LLM, Message } from "@opencode-ai/ai"
import { LLMClient, RequestExecutor } from "@opencode-ai/ai/route"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Model } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { MergeGatewayPlugin } from "@opencode-ai/core/plugin/provider/merge-gateway"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("merge-gateway")
const modelID = Model.ID.make("zai/glm-5.3-flash")
const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* MergeGatewayPlugin.effect(host)
})

describe("MergeGatewayPlugin", () => {
  test("is registered as a built-in provider plugin", () => {
    expect(ProviderPlugins).toContain(MergeGatewayPlugin)
  })

  it.effect("sets gateway defaults by effective package and leaves later overrides intact", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const other = Model.ID.make("other")
      const custom = Provider.ID.make("custom")
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.package = Provider.aisdk("merge-gateway-ai-sdk-provider")
        })
        draft.model.update(providerID, modelID, (model) => {
          model.compatibility = { reasoningField: "reasoning_content", requireFinishReason: true }
        })
        draft.model.update(providerID, other, (model) => {
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
        draft.model.update(custom, modelID, (model) => {
          model.package = Provider.aisdk("merge-gateway-ai-sdk-provider")
        })
      })
      yield* addPlugin()
      expect((yield* catalog.model.get(providerID, modelID))?.compatibility).toEqual({
        reasoningField: "thinking",
        maxTokensField: "max_tokens",
        requireReasoning: false,
        requireFinishReason: true,
      })
      expect((yield* catalog.model.get(providerID, other))?.compatibility).toBeUndefined()
      expect((yield* catalog.model.get(custom, modelID))?.compatibility?.reasoningField).toBe("thinking")
      yield* catalog.transform((draft) => {
        draft.model.update(providerID, modelID, (model) => {
          model.compatibility = { ...model.compatibility, reasoningField: "custom_thinking" }
        })
      })
      expect((yield* catalog.model.get(providerID, modelID))?.compatibility?.reasoningField).toBe("custom_thinking")
    }),
  )

  it.effect("uses native HTTP for images, thinking, tool calls, and usage", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.package = Provider.aisdk("merge-gateway-ai-sdk-provider")
        })
        draft.model.update(providerID, modelID, (model) => {
          model.body = { tags: [{ key: "env", value: "test" }] }
        })
      })
      yield* addPlugin()
      const info = yield* catalog.model.get(providerID, modelID)
      if (!info) throw new Error("Missing Merge model")
      const model = yield* ModelResolver.fromCatalogModel(info, Credential.Key.make({ type: "key", key: "test-key" }))
      const transport = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            expect(request.url).toBe("https://api-gateway.merge.dev/v1/ai-sdk/chat/completions")
            expect(request.headers.authorization).toBe("Bearer test-key")
            if (request.body._tag !== "Uint8Array") throw new Error("Expected JSON request")
            const body = JSON.parse(new TextDecoder().decode(request.body.body))
            expect(body.max_tokens).toBe(100)
            expect(body).not.toHaveProperty("max_completion_tokens")
            expect(body.tags).toEqual([{ key: "env", value: "test" }])
            expect(body.messages[0]).toMatchObject({
              role: "user",
              content: [{ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }],
            })
            expect(body.messages[1]).not.toHaveProperty("thinking")
            const chunks = [
              { choices: [{ index: 0, delta: { thinking: "Inspecting the image." }, finish_reason: null }] },
              { choices: [{ index: 0, delta: { content: "I see it." }, finish_reason: null }] },
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_1",
                          type: "function",
                          function: { name: "read", arguments: '{"path":"image.png"}' },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              },
              { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
            ]
            return HttpClientResponse.fromWeb(
              request,
              new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
                headers: { "content-type": "text/event-stream" },
              }),
            )
          }),
        ),
      )
      const response = yield* LLMClient.generate(
        LLM.request({
          model,
          generation: { maxTokens: 100 },
          messages: [
            Message.user({ type: "media", mediaType: "image/png", data: "iVBORw0KGgo=" }),
            Message.assistant("Let me look."),
            Message.user("Continue"),
          ],
        }),
      ).pipe(Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(transport))))))
      expect(response.text).toBe("I see it.")
      expect(response.reasoning).toBe("Inspecting the image.")
      expect(response.toolCalls).toMatchObject([{ name: "read", input: { path: "image.png" } }])
      expect(response.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
    }),
  )
})
