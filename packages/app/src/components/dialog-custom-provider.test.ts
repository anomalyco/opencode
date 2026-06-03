import { describe, expect, test } from "bun:test"
import { modelConfig, validateCustomProvider, type ModelRow } from "./dialog-custom-provider-form"

const t = (key: string) => key

function model(input: { row: string; id: string; name: string; values?: Record<string, string> }): ModelRow {
  return {
    row: input.row,
    id: input.id,
    name: input.name,
    expanded: false,
    config: modelConfig().map((item) => ({
      ...item,
      value: input.values?.[item.key] ?? item.value,
    })),
    err: {},
  }
}

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [model({ row: "m0", id: " model-a ", name: " Model A " })],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("parses optional model config values and omits blanks", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          model({
            row: "m0",
            id: "model-a",
            name: "Model A",
            values: {
              reasoning: "true",
              temperature: "false",
              "limit.context": "128000",
              "modalities.input": "text,image",
              options: '{"reasoningEffort":"high"}',
            },
          }),
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models as unknown).toEqual({
      "model-a": {
        name: "Model A",
        reasoning: true,
        temperature: false,
        limit: {
          context: 128000,
        },
        modalities: {
          input: ["text", "image"],
        },
        options: {
          reasoningEffort: "high",
        },
      },
    })
  })

  test("flags invalid model config values on the matching key", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          model({
            row: "m0",
            id: "model-a",
            name: "Model A",
            values: {
              reasoning: "maybe",
              options: "{bad",
            },
          }),
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.models[0].config).toEqual({
      reasoning: "provider.custom.error.boolean",
      options: "provider.custom.error.json",
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          model({ row: "m0", id: "model-a", name: "Model A" }),
          model({ row: "m1", id: "model-a", name: "Model A 2" }),
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
      config: {},
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })
})
