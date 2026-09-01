import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"

const decode = Schema.decodeUnknownSync(Model.Ref)

describe("Model.parse", () => {
  test.each([
    ["vendor/model", "vendor", "model"],
    ["vendor/team/model", "vendor", "team/model"],
    ["vendor", "vendor", ""],
    ["", "", ""],
    ["/model", "", "model"],
    ["vendor/", "vendor", ""],
    ["vendor//model/", "vendor", "/model/"],
  ])("parses %j at the first slash", (input, providerID, modelID) => {
    expect(Model.parse(input)).toEqual({
      providerID: Provider.ID.make(providerID),
      modelID: Model.ID.make(modelID),
    })
  })
})

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
