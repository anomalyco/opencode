import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ModalPlugin } from "@opencode-ai/core/plugin/provider/modal"
import { Provider } from "@opencode-ai/core/provider"
import { State } from "@opencode-ai/core/state"
import { Money } from "@opencode-ai/schema/money"
import { expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("modal")
const integrationID = Integration.ID.make("modal")
const baseModelID = Model.ID.make("thinkingmachines/Inkling-NVFP4")
const runtimeModelID = Model.ID.make("workspace--inkling.us-west.modal.direct")

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

const setup = Effect.fn(function* (baseURL: string, key?: string) {
  const catalog = yield* Catalog.Service
  const integrations = yield* Integration.Service
  yield* integrations.transform((draft) => {
    draft.method.update({ integrationID, method: { type: "key" } })
  })
  if (key) yield* integrations.connection.key({ integrationID, key })
  yield* State.batch(
    Effect.gen(function* () {
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.name = "Modal"
          provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
          provider.settings = { baseURL }
          provider.integrationID = integrationID
        })
        draft.model.update(providerID, baseModelID, (model) => {
          model.name = "Inkling"
          model.family = Model.Family.make("ling")
          model.compatibility = { reasoningField: "reasoning_content" }
          model.capabilities = { tools: true, input: ["text", "image", "audio"], output: ["text"] }
          model.variants = [{ id: Model.VariantID.make("fallback"), settings: { reasoningEffort: "fallback" } }]
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(4),
              cache: {
                read: Money.USDPerMillionTokens.make(0.2),
                write: Money.USDPerMillionTokens.zero,
              },
            },
          ]
          model.limit = { context: 128_000, output: 8_192 }
          model.time = { released: Date.parse("2026-07-15") }
        })
      })
      yield* ModalPlugin.effect(yield* PluginHost.make(yield* Plugin.Service))
    }),
  )
})

it.live("discovers Modal workspace models", () =>
  Effect.gen(function* () {
    const requests: Array<{ authorization: string | null; path: string }> = []
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push({ authorization: request.headers.get("authorization"), path: new URL(request.url).pathname })
        return Response.json({
          data: [
            {
              id: runtimeModelID,
              base_model_id: baseModelID,
              name: "Thinking Machines: Inkling",
              input_modalities: ["text", "image", "audio"],
              output_modalities: ["text"],
              context_length: 1_048_576,
              max_output_length: 262_144,
              pricing: { prompt: "0.0000012", completion: "0.000005", input_cache_read: "0.00000027" },
              supported_features: ["tools", "reasoning"],
              reasoning_options: [{ type: "effort", values: ["none", "low", "high"] }],
              interleaved: { field: "reasoning_content" },
            },
          ],
        })
      },
    })
    yield* setup(`${server.url}v1`, "test-token")

    const models = yield* eventually(
      (yield* Catalog.Service).model
        .all()
        .pipe(Effect.map((models) => models.filter((model) => model.providerID === providerID))),
      (models) => models.some((model) => model.id === runtimeModelID),
    )
    expect(requests).toEqual([{ authorization: "Bearer test-token", path: "/v1/models" }])
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: runtimeModelID,
      modelID: runtimeModelID,
      name: "Thinking Machines: Inkling",
      family: "ling",
      compatibility: { reasoningField: "reasoning_content" },
      settings: { baseURL: `${server.url}v1` },
      capabilities: { tools: true, input: ["text", "image", "audio"], output: ["text"] },
      variants: [
        { id: "none", settings: { reasoningEffort: "none" } },
        { id: "low", settings: { reasoningEffort: "low" } },
        { id: "high", settings: { reasoningEffort: "high" } },
      ],
      cost: [{ input: 1.2, output: 5, cache: { read: 0.27, write: 0 } }],
      limit: { context: 1_048_576, output: 262_144 },
    })
  }),
)

it.live("hides static Modal models when discovery fails", () =>
  Effect.gen(function* () {
    using server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 503 }) })
    yield* setup(`${server.url}v1`, "test-token")
    const models = yield* eventually(
      (yield* Catalog.Service).model
        .all()
        .pipe(Effect.map((models) => models.filter((model) => model.providerID === providerID))),
      (models) => models.length === 0,
    )
    expect(models).toEqual([])
  }),
)
