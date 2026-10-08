import { describe, expect, test } from "bun:test"
import { Document, Info } from "@opencode/schema/config"
import { Schema } from "effect"
import { ConfigCache } from "../../src/config/cache.js"
import { ConfigNormalize } from "../../src/config/normalize.js"

const document = (input: unknown) => new Document({ type: "document", info: Schema.decodeUnknownSync(Info)(input) })
const input = { provider: "anthropic", agent: "research", model: "claude", subagent: true }
const baseline = { options: { cache_control: { type: "ephemeral", ttl: "1h" } } } as const
const child = { when: { subagent: true }, options: { cache_control: { type: "ephemeral", ttl: "5m" } } } as const
const research = { when: { agent: "research", subagent: true }, options: {} }

describe("ConfigCache.resolve", () => {
  test("chooses the containing condition independently of all six rule orders", () => {
    const rules = [baseline, child, research]
    rules.forEach((first) => {
      rules
        .filter((rule) => rule !== first)
        .forEach((second) => {
          const third = rules.find((rule) => rule !== first && rule !== second)!
          const entries = [document({ cache: { anthropic: [first, second, third] } })]
          expect(ConfigCache.resolve(entries, input)?.rule.options).toEqual({})
          expect(ConfigCache.resolve(entries, { ...input, agent: "build" })?.rule.options).toEqual(child.options)
          expect(ConfigCache.resolve(entries, { ...input, subagent: false })?.rule.options).toEqual(baseline.options)
        })
    })
  })

  test("requires all conditions and uses exact model IDs", () => {
    const entries = [document({ cache: { anthropic: [{ ...research, when: { ...research.when, model: "claude" } }] } })]
    expect(ConfigCache.resolve(entries, input)?.rule.options).toEqual({})
    expect(ConfigCache.resolve(entries, { ...input, agent: "build" })).toBeUndefined()
    expect(ConfigCache.resolve(entries, { ...input, model: "claude-other" })).toBeUndefined()
    expect(ConfigCache.resolve(entries, { ...input, subagent: false })).toBeUndefined()
    expect(ConfigCache.resolve(entries, { ...input, provider: "openai" })).toBeUndefined()
  })

  test("reports incomparable matches and accepts an explicit intersection", () => {
    const agent = { when: { agent: "research" }, options: {} }
    expect(() => ConfigCache.resolve([document({ cache: { anthropic: [agent, child] } })], input)).toThrow(
      'cache["anthropic"][0], cache["anthropic"][1]',
    )
    expect(ConfigCache.resolve([document({ cache: { anthropic: [agent, child, research] } })], input)?.rule).toEqual(
      research,
    )
  })

  test("rejects duplicate matching conditions, even with equal options or a more specific rule", () => {
    expect(() => ConfigCache.resolve([document({ cache: { anthropic: [research, research] } })], input)).toThrow(
      "Ambiguous",
    )
    expect(() => ConfigCache.resolve([document({ cache: { anthropic: [child, child, research] } })], input)).toThrow(
      "Ambiguous",
    )
  })

  test("replaces a provider's whole array and retains other providers across documents", () => {
    const low = document({
      cache: { anthropic: [baseline, child], openai: [{ options: { prompt_cache_retention: "24h" } }] },
    })
    const high = document({ cache: { anthropic: [baseline] } })
    expect(ConfigCache.resolve([low, high], input)?.rule.options).toEqual(baseline.options)
    expect(ConfigCache.resolve([low, high], { ...input, provider: "openai" })?.rule.options).toEqual({
      prompt_cache_retention: "24h",
    })
    expect(ConfigCache.resolve([low, document({ cache: { anthropic: [] } })], input)).toBeUndefined()
    expect(ConfigCache.resolve([low, document({})], input)?.rule.options).toEqual(child.options)
  })

  test("preserves native cache config during normalization and rejects unsafe partial rules", () => {
    const config = { cache: { anthropic: [baseline, child, research] } }
    expect(ConfigNormalize.normalize(config)).toEqual({ type: "normalized", encoded: config, diagnostics: [] })
    const invalid = ConfigNormalize.normalize({ cache: { anthropic: [{ when: { subAgent: true }, options: {} }] } })
    expect(invalid.type).toBe("rejected")
    expect(invalid.diagnostics[0]?.path).toEqual(["cache"])
  })
})
