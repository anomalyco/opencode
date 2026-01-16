import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionCompaction } from "../../src/session/compaction"
import { LLM } from "../../src/session/llm"
import { Token } from "../../src/util/token"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import type { Provider } from "../../src/provider/provider"

Log.init({ print: false })

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { id: "anthropic", npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

describe("session.compaction.shouldCompact", () => {
  test("returns needed=true when estimated tokens exceed threshold", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(400_000) }, // ~100k tokens
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.needed).toBe(true)
        expect(result.contextLimit).toBe(100_000)
        expect(result.threshold).toBe(0.9)
        expect(result.estimatedTokens).toBeGreaterThan(result.contextLimit * result.threshold)
      },
    })
  })

  test("returns needed=false when estimated tokens under threshold", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(100_000) }, // ~25k tokens
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.needed).toBe(false)
        expect(result.estimatedTokens).toBeLessThanOrEqual(result.contextLimit * result.threshold)
      },
    })
  })

  test("returns needed=false when model context limit is 0", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 0, output: 32_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(400_000) },
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.needed).toBe(false)
        expect(result.contextLimit).toBe(0)
      },
    })
  })

  test("respects maxContext when set lower than model context", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { maxContext: 50_000 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(200_000) }, // ~50k tokens
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.contextLimit).toBe(50_000)
        expect(result.needed).toBe(true) // 50k tokens > 50k * 0.9 = 45k
      },
    })
  })

  test("uses model context when maxContext is higher", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { maxContext: 500_000 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(380_000) }, // ~95k tokens
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.contextLimit).toBe(100_000) // Should use model's lower limit
        expect(result.needed).toBe(true) // 95k > 100k * 0.9 = 90k
      },
    })
  })

  test("respects custom threshold from config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { threshold: 0.8 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(340_000) }, // ~85k tokens
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.threshold).toBe(0.8)
        expect(result.needed).toBe(true) // 85k > 100k * 0.8 = 80k
      },
    })
  })

  test("uses input limit when available", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(1_000_000) }, // ~250k tokens
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.contextLimit).toBe(272_000) // Should use input limit
        expect(result.needed).toBe(true) // 250k > 272k * 0.9 = 244.8k
      },
    })
  })

  test("returns correct estimatedTokens value", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const agent = { permission: [] } as any
        const messages = [
          { role: "user" as const, content: "x".repeat(4000) }, // exactly 1000 tokens
        ]

        const result = await SessionCompaction.shouldCompact({ model, agent, messages })

        expect(result.estimatedTokens).toBeGreaterThan(0)
        // Should be around 1000 tokens plus system prompt
      },
    })
  })
})

describe("session.compaction.isOverflow", () => {
  test("returns true when token count exceeds usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when token count within usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("includes cache.read in token count", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 50_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("respects input limit for input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 271_000, output: 1_000, reasoning: 0, cache: { read: 2_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when input/output are within input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 200_000, output: 20_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when output within limit with input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, input: 120_000, output: 10_000 })
        const tokens = { input: 50_000, output: 9_999, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when model context limit is 0", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 0, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when compaction.auto is disabled", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { auto: false },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("respects maxContext when set lower than model context", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { maxContext: 50_000 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Model has 200k context, but maxContext limits to 50k
        const model = createModel({ context: 200_000, output: 32_000 })
        // 30k tokens would be fine for 200k context, but exceeds 50k - 32k = 18k usable
        const tokens = { input: 20_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("uses model context when maxContext is higher", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { maxContext: 500_000 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // maxContext is 500k but model only has 100k
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        // Should still overflow based on model's 100k limit
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("maxContext works with input limit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { maxContext: 100_000 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Model has input limit of 272k, but maxContext is 100k
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        // 90k tokens would be fine for 272k input limit, but should respect maxContext
        const tokens = { input: 90_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })
})

describe("util.token.estimate", () => {
  test("estimates tokens from text (4 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1000)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(5000)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })
})

describe("session.getUsage", () => {
  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("does not subtract cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles reasoning tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 100,
      },
    })

    expect(result.tokens.reasoning).toBe(100)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(Number.isNaN(result.cost)).toBe(false)
  })

  test("calculates cost correctly", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
      },
    })

    expect(result.cost).toBe(3 + 1.5)
  })
})

describe("LLM.estimateInputTokens", () => {
  test("estimates tokens from string content messages", () => {
    const messages = [
      { role: "user" as const, content: "x".repeat(1000) },
      { role: "assistant" as const, content: "y".repeat(500) },
    ]
    const systemPrompt = ["z".repeat(200)]
    const result = LLM.estimateInputTokens(messages, systemPrompt)
    // Total chars: 1000 + 500 + 200 = 1700
    // Tokens: Math.ceil(1700 / 4) = 425
    expect(result).toBe(425)
  })

  test("estimates tokens from array content messages", () => {
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "x".repeat(800) }],
      },
    ]
    const systemPrompt: string[] = []
    const result = LLM.estimateInputTokens(messages, systemPrompt)
    // 800 chars / 4 = 200 tokens
    expect(result).toBe(200)
  })

  test("estimates tokens for images", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "describe this" },
          { type: "image" as const, image: new URL("https://example.com/img.png") },
        ],
      },
    ]
    const systemPrompt: string[] = []
    const result = LLM.estimateInputTokens(messages, systemPrompt)
    // "describe this" (13 chars) + image (2000 * 4 = 8000 chars) = 8013 chars
    // Math.ceil(8013 / 4) = 2004 tokens
    expect(result).toBe(2004)
  })

  test("handles empty messages", () => {
    const result = LLM.estimateInputTokens([], [])
    expect(result).toBe(0)
  })

  test("handles multiple system prompts", () => {
    const messages: { role: "user" | "assistant"; content: string }[] = []
    const systemPrompt = ["prompt1".repeat(100), "prompt2".repeat(50)]
    const result = LLM.estimateInputTokens(messages, systemPrompt)
    // (700 + 350) / 4 = 262.5 → Math.ceil = 263
    expect(result).toBe(263)
  })
})
