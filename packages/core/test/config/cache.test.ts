import { describe, expect, test } from "bun:test"
import { Document, Info } from "@opencode/schema/config"
import { Result, Schema } from "effect"
import { ConfigCache } from "../../src/config/cache.js"
import { ConfigNormalize } from "../../src/config/normalize.js"

const document = (input: unknown) => new Document({ type: "document", info: Schema.decodeUnknownSync(Info)(input) })
const input = { provider: "anthropic", agent: "research", model: "claude", subagent: true }
const baseline = { options: { cache_control: { type: "ephemeral", ttl: "1h" } } } as const
const child = { when: { subagent: true }, options: { cache_control: { type: "ephemeral", ttl: "5m" } } } as const
const research = { when: { agent: "research", subagent: true }, options: {} }

const resolve = (entries: readonly Document[], context = input) =>
  Result.getOrThrow(ConfigCache.resolve(entries, context))

describe("ConfigCache", () => {
  test("selects the most specific rule independently of order", () => {
    expect(resolve([document({ cache: { anthropic: [baseline, child, research] } })])?.rule).toEqual(research)
    expect(resolve([document({ cache: { anthropic: [research, child, baseline] } })])?.rule).toEqual(research)
  })

  test("requires all conditions and uses exact configured model and provider IDs", () => {
    const entries = [document({ cache: { anthropic: [{ ...research, when: { ...research.when, model: "claude" } }] } })]
    expect(resolve(entries)?.rule.options).toEqual({})
    expect(resolve(entries, { ...input, agent: "build" })).toBeUndefined()
    expect(resolve(entries, { ...input, model: "claude-other" })).toBeUndefined()
    expect(resolve(entries, { ...input, subagent: false })).toBeUndefined()
    expect(resolve(entries, { ...input, provider: "openai" })).toBeUndefined()
  })

  test("validates ambiguous intersections before a request is made", () => {
    const agent = { when: { agent: "research" }, options: {} }
    expect(ConfigCache.validate([agent, child])).toContain("[0], [1]")
    expect(ConfigCache.validate([agent, child, research])).toBeUndefined()
    expect(Result.isFailure(ConfigCache.resolve([document({ cache: { anthropic: [agent, child] } })], input))).toBe(
      true,
    )
  })

  test("accepts an intersection completely covered by complementary subagent conditions", () => {
    const rules = [
      { when: { agent: "research" }, options: {} },
      { when: { model: "claude" }, options: {} },
      { when: { agent: "research", model: "claude", subagent: true }, options: {} },
      { when: { agent: "research", model: "claude", subagent: false }, options: {} },
    ]
    expect(ConfigCache.validate(rules)).toBeUndefined()
    expect(ConfigCache.validate(rules.slice(0, 3))).toContain("subagent=false")
  })

  test("detects duplicate rules even when shadowed by a more specific rule", () => {
    expect(ConfigCache.validate([child, child, research])).toContain("Ambiguous")
  })

  test("retains unrelated providers when replacing a whole rule array", () => {
    const low = document({
      cache: { anthropic: [baseline, child], openai: [{ options: { prompt_cache_retention: "24h" } }] },
    })
    const high = document({ cache: { anthropic: [baseline] } })
    expect(resolve([low, high])?.rule).toEqual(baseline)
    expect(resolve([low, high], { ...input, provider: "openai" })?.rule.options).toEqual({
      prompt_cache_retention: "24h",
    })
    expect(resolve([low, document({ cache: { anthropic: [] } })])).toBeUndefined()
  })
})

describe("cache config normalization", () => {
  test("isolates a misspelled condition without reviving lower-priority rules", () => {
    const unrelated = { permission: { bash: "ask" }, agents: { research: { description: "Research" } }, providers: {} }
    const ordinary = ConfigNormalize.normalize(unrelated)
    const result = ConfigNormalize.normalize({
      ...unrelated,
      cache: {
        anthropic: [{ when: { subAgent: true }, options: {} }],
        openai: [{ options: { prompt_cache_retention: "24h" } }],
      },
    })
    expect(result.type).toBe("normalized")
    if (result.type !== "normalized" || ordinary.type !== "normalized") throw new Error("Expected normalized config")
    expect(result.encoded).toMatchObject(ordinary.encoded)
    expect(result.encoded.cache).toEqual({ anthropic: [], openai: [{ options: { prompt_cache_retention: "24h" } }] })
    expect(result.diagnostics[0]?.path).toEqual(["cache", "anthropic"])
    expect(resolve([document({ cache: { anthropic: [baseline] } }), document(result.encoded)])).toBeUndefined()
  })

  test("reports conflicts at load time and disables only the affected provider", () => {
    const result = ConfigNormalize.normalize({
      cache: { anthropic: [child, { when: { agent: "research" }, options: {} }], openai: [{ options: {} }] },
    })
    expect(result).toMatchObject({
      type: "normalized",
      encoded: { cache: { anthropic: [], openai: [{ options: {} }] } },
    })
    expect(result.diagnostics[0]?.message).toContain("Ambiguous")
  })

  test("reports mixed native options when the config loads", () => {
    const result = ConfigNormalize.normalize({
      cache: {
        test: [
          {
            options: {
              cache_control: { type: "ephemeral" },
              prompt_cache_retention: "24h",
            },
          },
        ],
      },
    })
    expect(result).toMatchObject({ type: "normalized", encoded: { cache: { test: [] } } })
    expect(result.diagnostics[0]?.message).toContain("combines")
  })

  test("keeps permissions when the cache root is malformed", () => {
    const result = ConfigNormalize.normalize({ permission: { bash: "ask" }, cache: false })
    expect(result).toMatchObject({
      type: "normalized",
      encoded: { permissions: [{ action: "shell", resource: "*", effect: "ask" }] },
    })
    expect(result.diagnostics[0]?.path).toEqual(["cache"])
  })
})
