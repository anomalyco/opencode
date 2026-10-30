import { expect, test } from "bun:test"
import { GmiCloudModels } from "@opencode/core/gmicloud/models"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Money } from "@opencode/schema/money"

const providerID = Provider.ID.make("gmicloud")

test("GMI Cloud plugin is registered", () => {
  expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.gmicloud")
})

function template(id: string, overrides: Partial<Model.Info> = {}) {
  return Model.Info.make({
    ...Model.Info.default(providerID, Model.ID.make(id)),
    name: `${id} catalog`,
    family: Model.Family.make("catalog-family"),
    ...overrides,
  })
}

test("maps live GMI Cloud models onto catalog templates", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      expect(request.headers.get("Authorization")).toBe("Bearer test-key")
      expect(new URL(request.url).pathname).toBe("/v1/models")
      return Response.json({
        data: [
          {
            id: "known",
            name: "Live Known",
            context_length: 128000,
            pricing: { prompt: "0.000001", completion: 0.000002, input_cache_read: "0.0000002" },
          },
          {
            id: "new-model",
            name: "New Model",
            context_length: 64000,
            pricing: { prompt: "0.000000300" },
          },
          { id: "duplicate", name: "First duplicate" },
          { id: "duplicate", name: "Last duplicate" },
          { id: 123, name: "Malformed" },
        ],
      })
    },
  })

  try {
    const known = template("known", {
      limit: { context: 1000, input: 800, output: 500 },
      capabilities: { tools: false, input: ["text", "image"], output: ["text"] },
    })
    const stale = template("stale")
    const models = await GmiCloudModels.get(`${server.url.origin}/v1`, "test-key", [known, stale])

    expect(models.size).toBe(3)
    expect(models.has(Model.ID.make("stale"))).toBe(false)
    expect(models.has(Model.ID.make("123"))).toBe(false)

    const inherited = models.get(Model.ID.make("known"))
    expect(inherited?.name).toBe("Live Known")
    expect(inherited?.family).toBe(Model.Family.make("catalog-family"))
    expect(inherited?.providerID).toBe(providerID)
    expect(inherited?.modelID).toBe(Model.ID.make("known"))
    expect(inherited?.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(inherited?.settings).toMatchObject({ baseURL: `${server.url.origin}/v1` })
    expect(inherited?.capabilities).toMatchObject({ tools: false, input: ["text", "image"], output: ["text"] })
    expect(inherited?.cost[0]?.input).toBe(Money.USDPerMillionTokens.make(1))
    expect(inherited?.cost[0]?.output).toBe(Money.USDPerMillionTokens.make(2))
    expect(Number(inherited?.cost[0]?.cache.read)).toBeCloseTo(0.2, 10)
    expect(inherited?.limit).toMatchObject({ context: 128000, input: 800, output: 500 })

    const fresh = models.get(Model.ID.make("new-model"))
    expect(fresh?.name).toBe("New Model")
    expect(fresh?.cost[0]?.input).toBe(Money.USDPerMillionTokens.make(0.3))
    expect(fresh?.limit).toMatchObject({ context: 64000, output: 0 })
    expect(fresh?.capabilities).toMatchObject({ tools: true, input: ["text"], output: ["text"] })

    const duplicate = models.get(Model.ID.make("duplicate"))
    expect(duplicate?.name).toBe("Last duplicate")
  } finally {
    await server.stop(true)
  }
})

test("throws on GMI Cloud API failure so the plugin can fail soft", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("nope", { status: 503 }),
  })

  try {
    await expect(GmiCloudModels.get(server.url.origin, "test-key", [])).rejects.toThrow(
      "Failed to fetch GMI Cloud models: 503",
    )
  } finally {
    await server.stop(true)
  }
})
