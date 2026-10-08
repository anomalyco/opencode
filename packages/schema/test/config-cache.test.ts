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
        openai: [
          { when: { model: "gpt-5.4" }, options: { prompt_cache_retention: "24h" } },
          { when: { model: "gpt-5.6" }, options: { prompt_cache_options: { mode: "implicit", ttl: "30m" } } },
        ],
      },
    } as const
    expect(Schema.encodeSync(Config.Info)(decode(input))).toEqual(input)
    expect(Schema.encodeSync(Config.Info)(decode({}))).not.toHaveProperty("cache")
  })

  test.each([{}, { ttl: "30m" }, { mode: "implicit" }, { mode: "explicit" }] as const)(
    "preserves omitted OpenAI cache fields without inserting defaults: %j",
    (options) => {
      const input = { cache: { openai: [{ options: { prompt_cache_options: options } }] } }
      expect(Schema.encodeSync(Config.Info)(decode(input))).toEqual(input)
    },
  )

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
    { options: { prompt_cache_options: { ttl: "1h" } } },
    { options: { prompt_cache_options: { ttl: "24h" } } },
    { options: { prompt_cache_options: { mode: "auto" } } },
    { options: { prompt_cache_options: { ttlSeconds: 1800 } } },
    { options: { prompt_cache_options: { mode: true } } },
    { options: {}, priority: 1 },
    { when: {} },
  ])("rejects malformed or misspelled rules: %j", (rule) => {
    // Config loading normally ignores excess properties; cache rules must override that policy.
    expect(() =>
      Schema.decodeUnknownSync(Config.Info, { onExcessProperty: "ignore" })({ cache: { test: [rule] } }),
    ).toThrow()
  })
})
