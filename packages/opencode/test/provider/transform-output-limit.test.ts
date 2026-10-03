import { describe, expect, test } from "bun:test"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { usable } from "@/session/overflow"

const model = (output: number) => ({ limit: { context: 1_000_000, output } }) as Provider.Model

describe("ProviderTransform.maxOutputTokens", () => {
  test("uses the catalog output limit for LongCat instead of 32K", () => {
    expect(ProviderTransform.maxOutputTokens(model(131_072))).toBe(131_072)
    expect(usable({ cfg: {} as ConfigV1.Info, model: model(131_072) })).toBe(1_000_000 - 131_072)
  })

  test("keeps smaller model limits and the 32K fallback for unknown output limits", () => {
    expect(ProviderTransform.maxOutputTokens(model(8_192))).toBe(8_192)
    expect(ProviderTransform.maxOutputTokens(model(0))).toBe(32_000)
  })

  test("caps exceptionally large catalog limits at the V2 256K ceiling", () => {
    expect(ProviderTransform.maxOutputTokens(model(384_000))).toBe(256_000)
  })

  test("preserves the explicit experimental output-token override", () => {
    expect(ProviderTransform.maxOutputTokens(model(131_072), 16_000)).toBe(16_000)
    expect(ProviderTransform.maxOutputTokens(model(384_000), 384_000)).toBe(384_000)
  })
})
