import { describe, expect, test } from "bun:test"
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { providerDisplaySdk, providerSdkFromModels } from "./config-provider-display"

type ProviderModelMap = ProviderListResponse["all"][number]["models"]

function model(npm: string): ProviderModelMap[string] {
  return {
    id: "model",
    providerID: "provider",
    api: { id: "model", url: "", npm },
    name: "Model",
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: false,
      toolcall: false,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, output: 0 },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
  }
}

describe("provider display sdk", () => {
  test("infers sdk from model metadata when config provider entry is absent", () => {
    const models = {
      fast: model("@ai-sdk/google"),
      pro: model("@ai-sdk/google"),
      fallback: model("@ai-sdk/openai"),
    }

    expect(providerSdkFromModels(models)).toBe("@ai-sdk/google")
    expect(providerDisplaySdk({ models })).toEqual({ sdk: "@ai-sdk/google", custom: false })
  })

  test("uses configured custom sdk when present", () => {
    const models = { base: model("@ai-sdk/google") }

    expect(providerDisplaySdk({ config: { npm: "@ai-sdk/openai" }, models })).toEqual({
      sdk: "@ai-sdk/openai",
      custom: true,
    })
  })
})
