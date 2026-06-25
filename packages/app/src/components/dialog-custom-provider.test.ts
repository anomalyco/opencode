import { describe, expect, test } from "bun:test"
import { type ModelRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key
const model = (input: Partial<ModelRow>): ModelRow => ({ ...modelRow(), ...input })

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
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  test("emits reasoning variants and fast preset", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [model({ row: "m0", id: "model-a", name: "Model A", reasoning: true, fast: true })],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      "model-a": {
        name: "Model A",
        reasoning: true,
        variants: {
          fast: { serviceTier: "fast" },
          none: { reasoningEffort: "none" },
          low: { reasoningEffort: "low" },
          medium: { reasoningEffort: "medium" },
          high: { reasoningEffort: "high" },
          xhigh: { reasoningEffort: "xhigh" },
        },
      },
    })
  })

  test("emits disabled variants for unsupported fast and efforts", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          model({
            row: "m0",
            id: "model-a",
            name: "Model A",
            reasoning: true,
            fast: false,
            efforts: { none: true, low: true, medium: true, high: false, xhigh: true },
          }),
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      "model-a": {
        name: "Model A",
        reasoning: true,
        variants: {
          fast: { disabled: true },
          none: { reasoningEffort: "none" },
          low: { reasoningEffort: "low" },
          medium: { reasoningEffort: "medium" },
          high: { disabled: true },
          xhigh: { reasoningEffort: "xhigh" },
        },
      },
    })
  })

  test("emits fast preset independently from reasoning support", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [model({ row: "m0", id: "model-a", name: "Model A", fast: true })],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      "model-a": {
        name: "Model A",
        variants: {
          fast: { serviceTier: "fast" },
        },
      },
    })
  })
})
