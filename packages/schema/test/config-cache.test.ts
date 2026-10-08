import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "../src/config.js"

const decode = Schema.decodeUnknownSync(Config.Info)

describe("Config cache rules", () => {
  test("round-trips native options, conditions, and empty defaults", () => {
    const input = {
      cache: {
        anthropic: [
          { options: { cache_control: { type: "ephemeral", ttl: "1h" } } },
          { when: { agent: "research", model: "claude-sonnet-4-5", subagent: true }, options: {} },
        ],
        openai: [{ options: { prompt_cache_retention: "24h" } }],
      },
    } as const
    expect(Schema.encodeSync(Config.Info)(decode(input))).toEqual(input)
    expect(Schema.encodeSync(Config.Info)(decode({}))).not.toHaveProperty("cache")
  })

  test.each([
    { when: { subagent: "true" }, options: {} },
    { when: { agent: 1 }, options: {} },
    { when: { agent: "" }, options: {} },
    { when: { execution: "subagent" }, options: {} },
    { when: { subAgent: true }, options: {} },
    { options: { ttlSeconds: 3600 } },
    { options: { cache_control: { type: "ephemeral", ttl: "10m" } } },
    { options: { cache_control: { type: "ephemeral", ttlSeconds: 3600 } } },
    { options: { prompt_cache_retention: "1h" } },
    { options: {}, priority: 1 },
    { when: {} },
  ])("rejects malformed or misspelled rules: %j", (rule) => {
    // Config loading normally ignores excess properties; cache rules must override that policy.
    expect(() =>
      Schema.decodeUnknownSync(Config.Info, { onExcessProperty: "ignore" })({ cache: { test: [rule] } }),
    ).toThrow()
  })
})
