import { expect, test } from "bun:test"
import { ModalModels } from "@opencode-ai/core/modal/models"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { Money } from "@opencode-ai/schema/money"

const providerID = Provider.ID.make("modal")

test("modal plugin is registered", () => {
  expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.modal")
})

function template(id: string, overrides: Partial<Model.Info> = {}) {
  return Model.Info.make({
    ...Model.Info.default(providerID, Model.ID.make(id)),
    name: `${id} catalog`,
    family: Model.Family.make("catalog-family"),
    ...overrides,
  })
}

test("maps live Modal models onto catalog templates", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      expect(request.headers.get("Authorization")).toBe("Bearer test-key")
      expect(new URL(request.url).pathname).toBe("/v1/models")
      return Response.json({
        data: [
          {
            id: "live-model",
            base_model_id: "base-model",
            name: "Live Model",
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
            context_length: 128000,
            max_output_length: 8192,
            pricing: { prompt: "0.000001", completion: 0.000002, input_cache_read: "0.0000002" },
            supported_sampling_parameters: ["temperature"],
            supported_features: ["tools", "reasoning"],
            reasoning_options: [{ type: "effort", values: ["low", "high", null] }],
            interleaved: { field: "reasoning_content" },
          },
          {
            id: "standalone",
            context_length: 64000,
          },
          { id: "malformed", context_length: "huge" },
        ],
      })
    },
  })

  try {
    const base = template("base-model")
    const stale = template("stale")
    const models = await ModalModels.get(`${server.url.origin}/v1`, "test-key", [base, stale])

    expect(models.has(Model.ID.make("stale"))).toBe(false)
    expect(models.has(Model.ID.make("malformed"))).toBe(false)

    const model = models.get(Model.ID.make("live-model"))
    expect(model?.name).toBe("Live Model")
    expect(model?.family).toBe(Model.Family.make("catalog-family"))
    expect(model?.providerID).toBe(providerID)
    expect(model?.modelID).toBe(Model.ID.make("live-model"))
    expect(model?.package).toBe(Provider.aisdk("@ai-sdk/openai-compatible"))
    expect(model?.settings).toMatchObject({ baseURL: `${server.url.origin}/v1` })
    expect(model?.compatibility).toMatchObject({ reasoningField: "reasoning_content" })
    expect(model?.capabilities).toMatchObject({ tools: true, input: ["text", "image"], output: ["text"] })
    expect(model?.cost[0]?.input).toBe(Money.USDPerMillionTokens.make(1))
    expect(model?.cost[0]?.output).toBe(Money.USDPerMillionTokens.make(2))
    expect(Number(model?.cost[0]?.cache.read)).toBeCloseTo(0.2, 10)
    expect(model?.cost[0]?.cache.write).toBe(Money.USDPerMillionTokens.zero)
    expect(model?.limit).toMatchObject({ context: 128000, output: 8192 })
    expect(model?.variants.map((variant) => variant.id)).toEqual([
      Model.VariantID.make("low"),
      Model.VariantID.make("high"),
      Model.VariantID.make("none"),
    ])
    expect(model?.variants[0]?.settings).toMatchObject({ reasoningEffort: "low" })
    expect(model?.status).toBe("active")

    const fresh = models.get(Model.ID.make("standalone"))
    expect(fresh?.name).toBe("standalone")
    expect(fresh?.family).toBeUndefined()
    expect(fresh?.capabilities).toMatchObject({ tools: true, input: ["text"], output: ["text"] })
    expect(fresh?.variants).toEqual([])
    expect(fresh?.limit).toMatchObject({ context: 64000, output: 0 })
  } finally {
    await server.stop(true)
  }
})

test("keeps template cost and limits when the proxy omits them", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        data: [{ id: "sparse", hugging_face_id: "hf-base" }],
      }),
  })

  try {
    const base = template("hf-base", {
      cost: [
        {
          input: Money.USDPerMillionTokens.make(5),
          output: Money.USDPerMillionTokens.make(10),
          cache: { read: Money.USDPerMillionTokens.make(1), write: Money.USDPerMillionTokens.make(2) },
        },
      ],
      limit: { context: 1000, input: 500, output: 250 },
    })
    const models = await ModalModels.get(server.url.origin, "test-key", [base])
    const model = models.get(Model.ID.make("sparse"))
    expect(model?.name).toBe("hf-base catalog")
    expect(model?.cost[0]).toMatchObject({ input: 5, output: 10, cache: { read: 1, write: 2 } })
    expect(model?.limit).toMatchObject({ context: 1000, input: 500, output: 250 })
  } finally {
    await server.stop(true)
  }
})

test("throws on proxy failure so the plugin can fail soft", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("nope", { status: 500 }),
  })

  try {
    await expect(ModalModels.get(server.url.origin, "test-key", [])).rejects.toThrow()
  } finally {
    await server.stop(true)
  }
})
