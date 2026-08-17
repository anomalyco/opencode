import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"

const decode = Schema.decodeUnknownSync(Model.Ref)

describe("Model.Ref", () => {
  test("accepts a model selection without a variant", () => {
    expect(decode({ id: "claude-sonnet", providerID: "anthropic" })).toEqual({
      id: Model.ID.make("claude-sonnet"),
      providerID: Provider.ID.make("anthropic"),
    })
  })

  test("preserves an explicit model variant", () => {
    expect(decode({ id: "claude-sonnet", providerID: "anthropic", variant: "high" })).toEqual({
      id: Model.ID.make("claude-sonnet"),
      providerID: Provider.ID.make("anthropic"),
      variant: Model.VariantID.make("high"),
    })
  })
})
