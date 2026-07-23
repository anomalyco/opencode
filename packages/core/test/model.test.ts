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
