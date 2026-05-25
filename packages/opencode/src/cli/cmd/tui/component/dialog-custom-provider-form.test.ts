import { describe, expect, test } from "bun:test"
import { validateCustomProvider } from "./dialog-custom-provider-form"

describe("validateCustomProvider", () => {
  test("builds an OpenAI-compatible provider config", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com/v1 ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ id: " model-a ", name: " Model A " }],
        headers: [
          { key: " X-Test ", value: " enabled " },
          { key: "", value: "" },
        ],
      },
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result).toEqual({
      ok: true,
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com/v1",
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

  test("rejects duplicate models and allows reconnecting disabled providers", () => {
    const duplicate = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { id: "model-a", name: "Model A" },
          { id: "model-a", name: "Model A 2" },
        ],
        headers: [],
      },
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(duplicate).toEqual({ ok: false, error: "Duplicate model ID: model-a" })

    const reconnected = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [{ id: "model-a", name: "Model A" }],
        headers: [],
      },
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(reconnected.ok).toBe(true)
  })
})
