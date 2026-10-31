import { expect, test } from "bun:test"
import { GmiCloudModels } from "@opencode/core/gmicloud/models"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Money } from "@opencode/schema/money"

const providerID = Provider.ID.make("gmicloud")

function template(id: string, overrides: Partial<Model.Info> = {}) {
  return Model.Info.make({
    ...Model.Info.default(providerID, Model.ID.make(id)),
    name: `${id} catalog`,
    family: Model.Family.make("catalog-family"),
    ...overrides,
  })
}

test("matches exact catalog templates case-insensitively and inherits their type", () => {
  const existing = template("OpenAI/GPT-5.5", { type: "image" })
  const models = GmiCloudModels.derive("https://gmi.example/v1", [{ id: "openai/gpt-5.5" }], [existing])
  const model = models.get(Model.ID.make("openai/gpt-5.5"))

  expect(model?.name).toBe("OpenAI/GPT-5.5 catalog")
  expect(model?.type).toBe("image")
  expect(model?.family).toBe(Model.Family.make("catalog-family"))
})

test("inherits type and compatibility from the closest same-org model template", () => {
  const farther = template("zai-org/GLM-4.7", {
    compatibility: { reasoningField: "reasoning" },
    variants: [{ id: Model.VariantID.make("old") }],
    limit: { context: 1, output: 4096 },
  })
  const closest = template("zai-org/GLM-5.2-FP8", {
    type: "decision",
    compatibility: { reasoningField: "reasoning_content" },
    variants: [{ id: Model.VariantID.make("high") }],
    headers: { "x-family": "closest" },
    body: { family: "closest" },
    settings: { stale: true },
    time: { released: 123 },
    status: "beta",
    enabled: false,
    cost: [
      {
        input: Money.USDPerMillionTokens.make(10),
        output: Money.USDPerMillionTokens.make(20),
        cache: {
          read: Money.USDPerMillionTokens.make(4),
          write: Money.USDPerMillionTokens.make(2),
        },
      },
    ],
    limit: { context: 4096, input: 2048, output: 131072 },
  })
  const models = GmiCloudModels.derive(
    "https://gmi.example/v1",
    [
      {
        id: "zai-org/GLM-5.3",
        name: "Live GLM-5.3",
        context_length: 1048576,
        pricing: { prompt: "0.000000300", completion: "0.000000500", input_cache_read: "0.000000100" },
      },
    ],
    [farther, closest],
  )
  const model = models.get(Model.ID.make("zai-org/GLM-5.3"))

  expect(model?.type).toBe("decision")
  expect(model?.name).toBe("Live GLM-5.3")
  expect(model?.family).toBeUndefined()
  expect(model?.compatibility).toEqual({ reasoningField: "reasoning_content" })
  expect(model?.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
  expect(model?.variants).toEqual([])
  expect(model?.headers).toBeUndefined()
  expect(model?.body).toBeUndefined()
  expect(model?.settings).toMatchObject({ baseURL: "https://gmi.example/v1" })
  expect(model?.settings).not.toHaveProperty("stale")
  expect(model?.time).toEqual({ released: 0 })
  expect(model?.status).toBe("active")
  expect(model?.enabled).toBe(true)
  expect(model?.cost[0]).toMatchObject({ input: 0.3, output: 0.5, cache: { write: 0 } })
  expect(Number(model?.cost[0]?.cache.read)).toBeCloseTo(0.1, 10)
  expect(model?.limit).toEqual({ context: 1048576, output: 0 })
})

test("does not inherit family from a related model template", () => {
  const existing = template("moonshotai/kimi-k2.7-code-highspeed", {
    family: Model.Family.make("kimi-k2"),
    compatibility: { reasoningField: "reasoning_content" },
  })
  const models = GmiCloudModels.derive("https://gmi.example/v1", [{ id: "moonshotai/kimi-k3" }], [existing])
  const model = models.get(Model.ID.make("moonshotai/kimi-k3"))

  expect(model?.family).toBeUndefined()
  expect(model?.compatibility).toEqual({ reasoningField: "reasoning_content" })
  expect(model?.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
})

test("does not inherit family variants or input capabilities", () => {
  const existing = template("openai/gpt-5.5", {
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [{ id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } }],
  })
  const models = GmiCloudModels.derive("https://gmi.example/v1", [{ id: "openai/gpt-oss-120b" }], [existing])
  const model = models.get(Model.ID.make("openai/gpt-oss-120b"))

  expect(model?.variants).toEqual([])
  expect(model?.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
})

test("does not use templates from another org or leading model word", () => {
  const models = GmiCloudModels.derive(
    "https://gmi.example/v1",
    [{ id: "google/gemini-3.8-flash" }, { id: "google/gpt-6-astra" }],
    [
      template("google/gemma-3.8", { family: Model.Family.make("gemma") }),
      template("openai/gpt-5.5", { family: Model.Family.make("gpt") }),
    ],
  )

  expect(models.get(Model.ID.make("google/gemini-3.8-flash"))?.family).toBeUndefined()
  expect(models.get(Model.ID.make("google/gpt-6-astra"))?.family).toBeUndefined()
})

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
