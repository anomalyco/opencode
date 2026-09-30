import { expect, test } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { generateText, jsonSchema } from "ai"
import type { Model } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"

// Regression for #52390: referenced object parameters were sent as JSON strings.
test.each([
  "nvidia/nemotron-3.5-super-vl-preview",
  "qwen/qwen3.8-flash-next",
  "claude-opus-5-5",
  "gpt-6-astra",
  "kimi-k2.6",
])("prepares MCP tool references for %s without mutating the original schema", async (id) => {
  const settings: JSONSchema7 = {
    type: "object",
    properties: { notifications: { type: "boolean" } },
    required: ["notifications"],
    additionalProperties: false,
  }
  const parameters: JSONSchema7 = {
    type: "object",
    properties: { settings: { $ref: "#/$defs/Settings" } },
    $defs: { Settings: settings },
  }
  const original = structuredClone(parameters)
  const model = {
    id,
    providerID: "custom",
    api: { id, url: "https://example.com/v1", npm: "@ai-sdk/openai-compatible" },
  } as Model
  let payload: { tools: { function: { parameters: typeof parameters } }[] } | undefined
  const provider = createOpenAICompatible({
    name: "custom",
    baseURL: model.api.url,
    apiKey: "test",
    fetch: Object.assign(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        payload = JSON.parse(String(init?.body))
        return Response.json({
          id: "test",
          created: 1,
          model: id,
          choices: [{ index: 0, message: { role: "assistant", content: "Done" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
      { preconnect: () => undefined },
    ),
  })
  await generateText({
    model: provider.chatModel(id),
    prompt: "Record the check.",
    maxRetries: 0,
    tools: {
      record: { description: "Record settings", inputSchema: jsonSchema(ProviderTransform.schema(model, parameters)) },
    },
  })
  expect(payload?.tools[0].function.parameters.properties?.settings).toEqual(
    /nemotron|qwen/.test(id) ? settings : { $ref: "#/$defs/Settings" },
  )
  expect(parameters).toEqual(original)
})
