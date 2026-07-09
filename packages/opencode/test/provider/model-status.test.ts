import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { CatalogModelStatus, ModelStatus } from "@/provider/model-status"
import { Provider } from "@/provider/provider"

describe("provider model status schemas", () => {
  test("keeps catalog status separate from normalized provider status", () => {
    expect(Schema.decodeUnknownSync(CatalogModelStatus)("deprecated")).toBe("deprecated")
    expect(() => Schema.decodeUnknownSync(CatalogModelStatus)("active")).toThrow()
    expect(Schema.decodeUnknownSync(ModelStatus)("active")).toBe("active")
  })

  test("accepts active status across public provider schemas", () => {
    expect(Schema.decodeUnknownSync(ConfigProviderV1.Model)({ status: "active" }).status).toBe("active")
    expect(
      Schema.decodeUnknownSync(Provider.Model)({
        id: "test-model",
        providerID: "test-provider",
        api: {
          id: "test-model",
          url: "",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "Test Model",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: { read: 0, write: 0 },
        },
        limit: { context: 128000, output: 8192 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-01-01",
      }).status,
    ).toBe("active")
  })
})
