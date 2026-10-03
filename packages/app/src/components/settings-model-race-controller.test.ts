import { describe, expect, test } from "bun:test"
import { ConfigModelRace } from "@opencode-ai/core/config/model-race"

describe("model race desktop settings", () => {
  test("normalizes missing configuration to defaults", () => {
    expect(ConfigModelRace.normalize()).toEqual(ConfigModelRace.defaults)
  })

  test("requires two models when racing is enabled", () => {
    expect(ConfigModelRace.validate({ ...ConfigModelRace.defaults, enabled: true, models: ["test/a"] })).toContain(
      "Select at least two candidate models",
    )
  })
})
