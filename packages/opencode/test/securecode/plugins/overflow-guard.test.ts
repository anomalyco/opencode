import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  OverflowGuardPlugin,
  estimateTokensCharBased,
  flattenMessageText,
  tokenizeViaVllm,
  truncateHeadTail,
  truncateMessagesInPlace,
  _testing_getCache,
  _testing_resetCache,
} from "../../../src/securecode/plugins/overflow-guard"

const stubPluginInput = {} as Parameters<typeof OverflowGuardPlugin>[0]
const REPLACEMENT_CHAR = "�"

beforeEach(() => {
  _testing_resetCache()
})

afterEach(() => {
  _testing_resetCache()
})

describe("truncateHeadTail", () => {
  test("returns original text unchanged when below threshold", () => {
    const text = "hello world"
    const result = truncateHeadTail(text, 100, 16, 16)
    expect(result.truncated).toBe(false)
    expect(result.output).toBe(text)
    expect(result.originalBytes).toBe(11)
  })

  test("truncates with head + tail + marker when above threshold", () => {
    const text = "A".repeat(50_000)
    const result = truncateHeadTail(text, 20_480, 8_192, 8_192)
    expect(result.truncated).toBe(true)
    expect(result.originalBytes).toBe(50_000)
    expect(result.output.length).toBeLessThan(text.length)
    expect(result.output.startsWith("A".repeat(8_192))).toBe(true)
    expect(result.output.endsWith("A".repeat(8_192))).toBe(true)
    expect(result.output).toContain("truncated by securecode overflow-guard")
    expect(result.output).toContain("original 50000 bytes")
  })

  test("does not produce U+FFFD when slicing through CJK multi-byte sequences", () => {
    // Each kanji is 3 bytes in UTF-8. 8192 % 3 == 2 so a naive byte slice at
    // 8192 lands mid-codepoint. The plugin must round to a UTF-8 boundary
    // before .toString("utf8") to avoid replacement chars.
    const kanji = "あ".repeat(10_000) // 30,000 bytes
    const result = truncateHeadTail(kanji, 20_480, 8_192, 8_192)
    expect(result.truncated).toBe(true)
    expect(result.originalBytes).toBe(30_000)
    expect(result.output.includes(REPLACEMENT_CHAR)).toBe(false)
    // Head and tail should both contain only the original kanji + marker.
    const marker = "[..."
    const idx = result.output.indexOf(marker)
    expect(idx).toBeGreaterThan(0)
    const headPortion = result.output.slice(0, idx)
    const tailPortion = result.output.slice(result.output.lastIndexOf("]") + 1)
    for (const ch of headPortion) {
      if (ch === "\n") continue
      expect(ch).toBe("あ")
    }
    for (const ch of tailPortion) {
      if (ch === "\n") continue
      expect(ch).toBe("あ")
    }
  })

  test("does not produce U+FFFD when slicing through 4-byte emoji sequences", () => {
    // Each "🙂" is 4 bytes in UTF-8.
    const emoji = "🙂".repeat(6_000) // 24,000 bytes
    const result = truncateHeadTail(emoji, 20_480, 8_192, 8_192)
    expect(result.truncated).toBe(true)
    expect(result.output.includes(REPLACEMENT_CHAR)).toBe(false)
  })

  test("handles tail of zero gracefully", () => {
    const text = "X".repeat(100)
    const result = truncateHeadTail(text, 50, 50, 0)
    expect(result.truncated).toBe(true)
    expect(result.output.startsWith("X".repeat(50))).toBe(true)
  })
})

describe("estimateTokensCharBased", () => {
  test("returns 0 for empty string", () => {
    expect(estimateTokensCharBased("")).toBe(0)
  })

  test("estimates ASCII at chars/4", () => {
    expect(estimateTokensCharBased("A".repeat(400))).toBe(100)
  })

  test("weights CJK characters more heavily than ASCII", () => {
    const cjkOnly = estimateTokensCharBased("あ".repeat(100))
    const asciiOnly = estimateTokensCharBased("a".repeat(100))
    // 100 CJK chars * 0.6 = 60 tokens vs 100 ASCII chars / 4 = 25 tokens.
    expect(cjkOnly).toBeGreaterThan(asciiOnly)
  })
})

describe("flattenMessageText", () => {
  test("collects text from text parts", () => {
    const result = flattenMessageText([
      {
        info: { sessionID: "s1" },
        parts: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
    ])
    expect(result).toContain("hello")
    expect(result).toContain("world")
  })

  test("collects text from completed tool parts", () => {
    const result = flattenMessageText([
      {
        info: { sessionID: "s1" },
        parts: [
          {
            type: "tool",
            state: {
              status: "completed",
              input: { path: "/foo.txt" },
              output: "tool output payload",
            },
          },
        ],
      },
    ])
    expect(result).toContain("tool output payload")
    expect(result).toContain("/foo.txt")
  })

  test("ignores unknown part types without crashing", () => {
    const result = flattenMessageText([
      {
        info: { sessionID: "s1" },
        parts: [
          { type: "unknown-type", anything: 42 },
          { type: "text", text: "kept" },
        ] as any,
      },
    ])
    expect(result).toContain("kept")
  })
})

describe("tokenizeViaVllm", () => {
  test("returns count when endpoint responds with count", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ count: 42 }), { status: 200 })) as unknown as typeof fetch
    const n = await tokenizeViaVllm("http://x/tokenize", "qwen", "hello", 1000, fakeFetch)
    expect(n).toBe(42)
  })

  test("falls back to tokens.length when count is missing", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ tokens: [1, 2, 3, 4, 5] }), { status: 200 })) as unknown as typeof fetch
    const n = await tokenizeViaVllm("http://x/tokenize", "qwen", "hello", 1000, fakeFetch)
    expect(n).toBe(5)
  })

  test("returns null on non-2xx", async () => {
    const fakeFetch = (async () =>
      new Response("upstream error", { status: 503 })) as unknown as typeof fetch
    const n = await tokenizeViaVllm("http://x/tokenize", "qwen", "hello", 1000, fakeFetch)
    expect(n).toBe(null)
  })

  test("returns null on fetch throwing", async () => {
    const fakeFetch = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    const n = await tokenizeViaVllm("http://x/tokenize", "qwen", "hello", 1000, fakeFetch)
    expect(n).toBe(null)
  })
})

describe("truncateMessagesInPlace", () => {
  test("rewrites large completed tool outputs and records metadata", () => {
    const messages = [
      {
        info: { sessionID: "s1" },
        parts: [
          {
            type: "tool",
            state: {
              status: "completed",
              input: { query: "incident" },
              output: "Z".repeat(50_000),
            },
          },
          {
            type: "tool",
            state: {
              status: "completed",
              input: { path: "/x" },
              output: "small",
            },
          },
        ],
      },
    ]
    const stats = truncateMessagesInPlace(messages as any)
    expect(stats.truncatedParts).toBe(1)
    expect(stats.bytesSaved).toBeGreaterThan(0)
    expect(messages[0].parts[0].state.output.length).toBeLessThan(50_000)
    expect(messages[0].parts[0].state.output).toContain("truncated by securecode overflow-guard")
    expect((messages[0].parts[0] as any).metadata.securecodeOverflowGuard).toMatchObject({
      truncated: true,
      originalBytes: 50_000,
    })
    // Small output must remain unchanged.
    expect(messages[0].parts[1].state.output).toBe("small")
    expect((messages[0].parts[1] as any).metadata).toBeUndefined()
  })

  test("skips tool parts that are not completed", () => {
    const messages = [
      {
        info: { sessionID: "s1" },
        parts: [
          {
            type: "tool",
            state: { status: "running", input: {} },
          },
          {
            type: "tool",
            state: {
              status: "error",
              input: {},
              error: "boom",
            },
          },
          {
            type: "tool",
            state: { status: "pending" },
          },
        ],
      },
    ]
    const stats = truncateMessagesInPlace(messages as any)
    expect(stats.truncatedParts).toBe(0)
  })

  test("does not throw on malformed parts", () => {
    const messages = [
      {
        info: { sessionID: "s1" },
        parts: [
          { type: "text", text: "noop" },
          { type: "tool" }, // missing state
          { type: "tool", state: null }, // null state
          { type: "tool", state: { status: "completed", input: {}, output: 42 } }, // non-string output
        ],
      },
    ]
    const stats = truncateMessagesInPlace(messages as any)
    expect(stats.truncatedParts).toBe(0)
  })
})

describe("OverflowGuardPlugin experimental.chat.messages.transform", () => {
  test("truncates large tool outputs (covers MCP path) and updates token estimate", async () => {
    const hooks = await OverflowGuardPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.messages.transform"]!

    // Simulate the message shape that opencode produces after MCP tools have
    // been normalized into MessageV2.ToolPart.state.output.
    const messages = [
      {
        info: { sessionID: "mcp-session" },
        parts: [
          {
            type: "tool",
            state: {
              status: "completed",
              input: { query: "incident" },
              output: "Y".repeat(23_099), // matches issue #54 slack_search_public size
            },
          },
        ],
      },
    ]

    await transform({} as any, { messages } as any)

    const part = messages[0].parts[0]
    expect(part.state.output.length).toBeLessThan(23_099)
    expect(part.state.output).toContain("truncated by securecode overflow-guard")
    const cached = _testing_getCache("mcp-session")
    expect(cached?.estimate).toBeGreaterThan(0)
  })

  test("token estimate reflects the post-truncation text", async () => {
    const hooks = await OverflowGuardPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.messages.transform"]!

    const messagesBig = [
      {
        info: { sessionID: "fit" },
        parts: [
          {
            type: "tool",
            state: { status: "completed", input: {}, output: "X".repeat(100_000) },
          },
        ],
      },
    ]
    await transform({} as any, { messages: messagesBig } as any)
    const cachedBig = _testing_getCache("fit")
    // After truncation, the flat text should be roughly head + marker + tail
    // (~16-17KB for default settings) — well below the raw 100KB estimate.
    expect(cachedBig?.estimate).toBeLessThan(100_000 / 4)
    expect(cachedBig?.estimate).toBeGreaterThan(0)
  })
})

describe("OverflowGuardPlugin chat.params dynamic maxOutputTokens", () => {
  test("reduces maxOutputTokens when input occupies most of the context", async () => {
    const hooks = await OverflowGuardPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.messages.transform"]!
    const chatParams = hooks["chat.params"]!

    // Build a fake message stream large enough that char-based estimation
    // crosses the safety threshold for a 131K context model.
    await transform(
      {} as any,
      {
        messages: [
          {
            info: { sessionID: "s1" } as any,
            parts: [{ type: "text", text: "A".repeat(480_000) }] as any,
          },
        ],
      } as any,
    )
    const cached = _testing_getCache("s1")
    expect(cached?.estimate).toBeGreaterThan(100_000)

    const output = {
      temperature: 0.7,
      topP: 1,
      topK: 1,
      maxOutputTokens: 16_384,
      options: {},
    }
    await chatParams(
      {
        sessionID: "s1",
        agent: "build",
        model: { id: "qwen3-coder-next", limit: { context: 131_072, output: 16_384 } } as any,
        provider: { source: "config", info: {}, options: {} } as any,
        message: {} as any,
      } as any,
      output as any,
    )
    expect(output.maxOutputTokens).toBeLessThan(16_384)
    expect(output.maxOutputTokens).toBeGreaterThanOrEqual(1024)
  })

  test("leaves maxOutputTokens alone when prompt fits comfortably", async () => {
    const hooks = await OverflowGuardPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.messages.transform"]!
    const chatParams = hooks["chat.params"]!

    await transform(
      {} as any,
      {
        messages: [
          {
            info: { sessionID: "s2" } as any,
            parts: [{ type: "text", text: "tiny prompt" }] as any,
          },
        ],
      } as any,
    )
    const output = {
      temperature: 0.7,
      topP: 1,
      topK: 1,
      maxOutputTokens: 16_384,
      options: {},
    }
    await chatParams(
      {
        sessionID: "s2",
        agent: "build",
        model: { id: "qwen3-coder-next", limit: { context: 131_072, output: 16_384 } } as any,
        provider: { source: "config", info: {}, options: {} } as any,
        message: {} as any,
      } as any,
      output as any,
    )
    expect(output.maxOutputTokens).toBe(16_384)
  })

  test("uses vLLM /tokenize when fetchImpl is provided and URL configured", async () => {
    process.env.SECURECODE_TOKENIZE_URL = "http://test/tokenize"
    let receivedBody: any = undefined
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      receivedBody = init?.body ? JSON.parse(init.body as string) : undefined
      return new Response(JSON.stringify({ count: 100_000 }), { status: 200 })
    }) as unknown as typeof fetch
    try {
      const hooks = await OverflowGuardPlugin(stubPluginInput, { fetchImpl: fakeFetch })
      const transform = hooks["experimental.chat.messages.transform"]!
      const chatParams = hooks["chat.params"]!
      await transform(
        {} as any,
        {
          messages: [
            {
              info: { sessionID: "s3" } as any,
              parts: [{ type: "text", text: "anything" }] as any,
            },
          ],
        } as any,
      )
      const output = {
        temperature: 0.7,
        topP: 1,
        topK: 1,
        maxOutputTokens: 16_384,
        options: {},
      }
      await chatParams(
        {
          sessionID: "s3",
          agent: "build",
          model: { id: "qwen3-coder-next", limit: { context: 131_072, output: 16_384 } } as any,
          provider: { source: "config", info: {}, options: {} } as any,
          message: {} as any,
        } as any,
        output as any,
      )
      expect(receivedBody?.model).toBe("qwen3-coder-next")
      // 100_000 input vs 131_072 context with default 1024 margin → ~30K
      // remaining for output, so the requested 16_384 should pass through.
      expect(output.maxOutputTokens).toBe(16_384)
    } finally {
      delete process.env.SECURECODE_TOKENIZE_URL
    }
  })
})
