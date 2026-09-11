import { expect, test } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

const catalog: ModelsDev.Provider = {
  id: "longcat",
  name: "LongCat",
  env: ["LONGCAT_API_KEY"],
  npm: "@ai-sdk/openai-compatible",
  api: "https://api.longcat.chat/openai",
  models: {
    "LongCat-2.0": {
      id: "LongCat-2.0",
      name: "LongCat-2.0",
      family: "longcat",
      release_date: "2026-06-30",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      reasoning_options: [{ type: "toggle" }],
      interleaved: { field: "reasoning_content" },
      limit: { context: 1_000_000, output: 131_072 },
      modalities: { input: ["text"], output: ["text"] },
    },
  },
}

test.each([
  ["none", "disabled"],
  ["high", "enabled"],
] as const)("LongCat catalog variant %s sends thinking.type=%s", async (variant, type) => {
  const model = Provider.fromModelsDevProvider(catalog).models["LongCat-2.0"]
  const requests: { url: string; body: Record<string, unknown> }[] = []
  const sdk = createOpenAICompatible({
    name: model.providerID,
    baseURL: model.api.url,
    apiKey: "test-key",
    fetch: Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const request = new Request(input, init)
        requests.push({ url: request.url, body: await request.json() })
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: model.api.id,
          choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
      { preconnect: () => undefined },
    ),
  })

  await sdk.chatModel(model.api.id).doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    providerOptions: ProviderTransform.providerOptions(model, model.variants?.[variant] ?? {}),
  })

  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe("https://api.longcat.chat/openai/chat/completions")
  expect(requests[0].body.thinking).toEqual({ type })
  expect(requests[0].body).not.toHaveProperty("reasoning_effort")
  expect(Object.keys(model.variants ?? {})).toEqual(["none", "high"])
})

test.each([
  { id: "other", npm: "@ai-sdk/openai-compatible" },
  { id: "longcat", npm: "@ai-sdk/openai" },
])("LongCat thinking controls do not affect $id with $npm", ({ id, npm }) => {
  const model = Provider.fromModelsDevProvider({ ...catalog, id, npm }).models["LongCat-2.0"]

  expect(model.variants?.high).toHaveProperty("reasoningEffort", "high")
  expect(model.variants?.high).not.toHaveProperty("thinking")
})
