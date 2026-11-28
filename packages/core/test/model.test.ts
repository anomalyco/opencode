import { describe, expect, test } from "bun:test"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"

describe("Model.parse", () => {
  test.each([
    ["vendor/model", "vendor", "model"],
    ["vendor/team/model", "vendor", "team/model"],
    ["vendor", "vendor", ""],
  ])("parses %j at the first slash", (input, providerID, modelID) => {
    expect(Model.parse(input)).toEqual({
      providerID: Provider.ID.make(providerID),
      modelID: Model.ID.make(modelID),
    })
  })
})
