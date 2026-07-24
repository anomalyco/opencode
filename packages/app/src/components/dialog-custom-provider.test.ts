import { describe, expect, test } from "bun:test"
import { validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [
          {
            row: "m0",
            id: " model-a ",
            name: " Model A ",
            reasoning: true,
            context: " 128000 ",
            output: " 8192 ",
            err: {},
          },
        ],
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
          "model-a": {
            name: "Model A",
            reasoning: true,
            limit: {
              context: 128000,
              output: 8192,
            },
          },
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
          {
            row: "m0",
            id: "model-a",
            name: "Model A",
            reasoning: false,
            context: "",
            output: "",
            err: {},
          },
          {
            row: "m1",
            id: "model-a",
            name: "Model A 2",
            reasoning: false,
            context: "",
            output: "",
            err: {},
          },
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
      context: undefined,
      output: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  test("requires a complete positive token limit", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          {
            row: "m0",
            id: "model-a",
            name: "Model A",
            reasoning: false,
            context: "128000",
            output: "",
            err: {},
          },
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.models[0]).toEqual({
      id: undefined,
      name: undefined,
      context: undefined,
      output: "provider.custom.error.required",
    })
  })
})
