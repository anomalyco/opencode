import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

const decode = Schema.decodeUnknownSync(ModelV2.Ref)

describe("ModelV2.Ref", () => {
  test("accepts a model selection without a variant", () => {
    expect(decode({ id: "claude-sonnet", providerID: "anthropic" })).toEqual({
      id: ModelV2.ID.make("claude-sonnet"),
      providerID: ProviderV2.ID.make("anthropic"),
    })
  })

  test("preserves an explicit model variant", () => {
    expect(decode({ id: "claude-sonnet", providerID: "anthropic", variant: "high" })).toEqual({
      id: ModelV2.ID.make("claude-sonnet"),
      providerID: ProviderV2.ID.make("anthropic"),
      variant: ModelV2.VariantID.make("high"),
    })
  })
})

describe("ModelV2.parse", () => {
  test("splits a plain provider/model reference", () => {
    expect(ModelV2.parse("anthropic/claude-sonnet")).toEqual({
      providerID: ProviderV2.ID.make("anthropic"),
      modelID: ModelV2.ID.make("claude-sonnet"),
    })
  })

  test("keeps slashes inside the model id", () => {
    expect(ModelV2.parse("qnaigc/openai/gpt-6-astra")).toEqual({
      providerID: ProviderV2.ID.make("qnaigc"),
      modelID: ModelV2.ID.make("openai/gpt-6-astra"),
    })
  })

  test("extracts an embedded variant", () => {
    expect(ModelV2.parse("anthropic/claude-sonnet#high")).toEqual({
      providerID: ProviderV2.ID.make("anthropic"),
      modelID: ModelV2.ID.make("claude-sonnet"),
      variant: ModelV2.VariantID.make("high"),
    })
  })

  test("extracts an embedded variant behind a slashed model id", () => {
    expect(ModelV2.parse("qnaigc/openai/gpt-6-astra#high")).toEqual({
      providerID: ProviderV2.ID.make("qnaigc"),
      modelID: ModelV2.ID.make("openai/gpt-6-astra"),
      variant: ModelV2.VariantID.make("high"),
    })
  })

  test("drops malformed embedded variants", () => {
    expect(ModelV2.parse("anthropic/claude-sonnet#")).toEqual({
      providerID: ProviderV2.ID.make("anthropic"),
      modelID: ModelV2.ID.make("claude-sonnet"),
    })
    expect(ModelV2.parse("anthropic/claude-sonnet#high#low")).toEqual({
      providerID: ProviderV2.ID.make("anthropic"),
      modelID: ModelV2.ID.make("claude-sonnet"),
    })
  })
})
