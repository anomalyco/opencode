import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { options, references } from "../../src/model-race/config"

describe("model race config", () => {
  test("is disabled by default", () => {
    const config = Schema.decodeUnknownSync(ConfigV1.Info)({})

    expect(config.modelRace?.enabled).toBeUndefined()
  })

  test("parses provider/model references", () => {
    expect(references({ models: ["a/model", "b/provider/model", "a/model"] })).toEqual([
      { id: "a/model", providerID: "a", modelID: "model" },
      { id: "b/provider/model", providerID: "b", modelID: "provider/model" },
    ])
  })

  test("applies throughput defaults", () => {
    expect(options({ enabled: true })).toEqual({
      strategy: { firstToken: true, throughput: true, toolCall: true },
      throughput: { warmupTokens: 8, measurementWindowMs: 1000 },
      switch: { enabled: true },
    })
  })

  test("preserves modelRace during V1 migration", () => {
    const config = Schema.decodeUnknownSync(ConfigV1.Info)({
      modelRace: {
        enabled: true,
        models: ["a/model", "b/model"],
        throughput: { warmupTokens: 4, measurementWindowMs: 500 },
      },
    })

    expect(ConfigMigrateV1.migrate(config).modelRace).toEqual(config.modelRace)
  })
})
