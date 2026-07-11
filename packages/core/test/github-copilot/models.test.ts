import { expect, test } from "bun:test"
import { CopilotModels } from "@opencode-ai/core/github-copilot/models"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

test("defensively syncs advertised Copilot models", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        data: [
          {
            model_picker_enabled: true,
            id: "gpt-5",
            name: "GPT-5 remote",
            version: "gpt-5-2026-06-01",
            supported_endpoints: ["/responses"],
            billing: {
              token_prices: {
                batch_size: 0,
                default: { input_price: 10, output_price: 20, cache_price: 5 },
              },
            },
            capabilities: {
              family: "gpt",
              limits: {
                max_context_window_tokens: 200000,
                max_output_tokens: 16384,
                max_prompt_tokens: 180000,
              },
              supports: { tool_calls: true, reasoning_effort: ["low", "high"] },
            },
          },
          {
            model_picker_enabled: false,
            id: "utility",
            name: "Utility",
            version: "utility-2026-06-01",
            capabilities: {
              family: "utility",
              limits: { max_output_tokens: 1000, max_prompt_tokens: 8000 },
              supports: { tool_calls: false },
            },
          },
          { model_picker_enabled: true, id: "incomplete" },
        ],
      }),
  })

  try {
    const existing = ModelV2.Info.make({
      ...ModelV2.Info.empty(ProviderV2.ID.githubCopilot, ModelV2.ID.make("gpt-5")),
      modelID: ModelV2.ID.make("gpt-5"),
      name: "GPT-5 local",
    })
    const stale = ModelV2.Info.make({
      ...ModelV2.Info.empty(ProviderV2.ID.githubCopilot, ModelV2.ID.make("stale")),
      modelID: ModelV2.ID.make("stale"),
    })
    const models = await CopilotModels.get(server.url.origin, {}, [existing, stale])
    const model = models.get(ModelV2.ID.make("gpt-5"))

    expect(model?.name).toBe("GPT-5 local")
    expect(model?.settings).toMatchObject({ baseURL: server.url.origin, endpoint: "responses" })
    expect(model?.cost[0]).toMatchObject({ input: 0, output: 0, cache: { read: 0, write: 0 } })
    expect(model?.variants.map((variant) => variant.id)).toEqual([
      ModelV2.VariantID.make("low"),
      ModelV2.VariantID.make("high"),
    ])
    expect(models.get(ModelV2.ID.make("utility"))?.enabled).toBe(false)
    expect(models.has(ModelV2.ID.make("stale"))).toBe(false)
    expect(models.has(ModelV2.ID.make("incomplete"))).toBe(false)
  } finally {
    await server.stop(true)
  }
})
