import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util/token"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionProcessor } from "../../src/session/processor"
import { SessionSummary } from "../../src/session/summary"
import { LLM } from "../../src/session/llm"
import { MessageID } from "../../src/session/schema"

Log.init({ print: false })

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
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
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function createAgent() {
  return {
    name: "build",
    mode: "primary" as const,
    description: "test agent",
    prompt: "",
    permission: [],
    options: {},
  }
}

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
        const tokens = { input: 60_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
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

  // ─── Bug reproduction tests ───────────────────────────────────────────
  // These tests demonstrate that when limit.input is set, isOverflow()
  // does not subtract any headroom for the next model response. This means
  // compaction only triggers AFTER we've already consumed the full input
  // budget, leaving zero room for the next API call's output tokens.
  //
  // Compare: without limit.input, usable = context - output (reserves space).
  // With limit.input, usable = limit.input (reserves nothing).
  //
  // Related issues: #10634, #8089, #11086, #12621
  // Open PRs: #6875, #12924

  test("BUG: no headroom when limit.input is set — compaction should trigger near boundary but does not", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Simulate Claude with prompt caching: input limit = 200K, output limit = 32K
        const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })

        // We've used 198K tokens total. Only 2K under the input limit.
        // On the next turn, the full conversation (198K) becomes input,
        // plus the model needs room to generate output — this WILL overflow.
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
        // count = 180K + 3K + 15K = 198K
        // usable = limit.input = 200K (no output subtracted!)
        // 198K > 200K = false → no compaction triggered

        // WITHOUT limit.input: usable = 200K - 32K = 168K, and 198K > 168K = true ✓
        // WITH limit.input: usable = 200K, and 198K > 200K = false ✗

        // With 198K used and only 2K headroom, the next turn will overflow.
        // Compaction MUST trigger here.
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("BUG: without limit.input, same token count correctly triggers compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Same model but without limit.input — uses context - output instead
        const model = createModel({ context: 200_000, output: 32_000 })

        // Same token usage as above
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
        // count = 198K
        // usable = context - output = 200K - 32K = 168K
        // 198K > 168K = true → compaction correctly triggered

        const result = await SessionCompaction.isOverflow({ tokens, model })
        expect(result).toBe(true) // ← Correct: headroom is reserved
      },
    })
  })

  test("BUG: asymmetry — limit.input model allows 30K more usage before compaction than equivalent model without it", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Two models with identical context/output limits, differing only in limit.input
        const withInputLimit = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const withoutInputLimit = createModel({ context: 200_000, output: 32_000 })

        // 170K total tokens — well above context-output (168K) but below input limit (200K)
        const tokens = { input: 166_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }

        const withLimit = await SessionCompaction.isOverflow({ tokens, model: withInputLimit })
        const withoutLimit = await SessionCompaction.isOverflow({ tokens, model: withoutInputLimit })

        // Both models have identical real capacity — they should agree:
        expect(withLimit).toBe(true) // should compact (170K leaves no room for 32K output)
        expect(withoutLimit).toBe(true) // correctly compacts (170K > 168K)
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
})

describe("session.compaction.shouldAutoCompact", () => {
  test("returns true when usage crosses the 80 percent threshold", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 8_000 })
        expect(
          await SessionCompaction.shouldAutoCompact({
            tokens: { input: 70_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
            model,
            previous: {
              tokens: { input: 60_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
              model,
            },
          }),
        ).toBe(true)
      },
    })
  })

  test("returns false when usage stays above the threshold", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 8_000 })
        expect(
          await SessionCompaction.shouldAutoCompact({
            tokens: { input: 72_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
            model,
            previous: {
              tokens: { input: 71_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
              model,
            },
          }),
        ).toBe(false)
      },
    })
  })

  test("returns false when model context limit is unavailable", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          await SessionCompaction.shouldAutoCompact({
            tokens: { input: 72_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
        ).toBe(false)
      },
    })
  })

  test("respects configured threshold", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { threshold: 0.1 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 8_000 })
        expect(
          await SessionCompaction.shouldAutoCompact({
            tokens: { input: 12_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            model,
            previous: {
              tokens: { input: 9_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              model,
            },
          }),
        ).toBe(true)
      },
    })
  })
})

describe("session.compaction.create", () => {
  test("does not queue duplicate compactions while one is already active", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const input = {
          sessionID: session.id,
          agent: "default",
          model: {
            providerID: ProviderID.make("openai"),
            modelID: ModelID.make("gpt-4"),
          },
          auto: true,
        }

        expect(await SessionCompaction.create(input)).toBe(true)
        expect(await SessionCompaction.create(input)).toBe(false)

        const updated = await Session.get(session.id)
        expect(updated.time.compacting).toBeDefined()

        const messages = await Session.messages({ sessionID: session.id })
        const compactions = messages.flatMap((msg) => msg.parts.filter((part) => part.type === "compaction"))
        expect(compactions).toHaveLength(1)
      },
    })
  })
})

describe("session.processor auto-compaction", () => {
  test("returns compact immediately after a turn crosses the threshold", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        compaction: {
          threshold: 0.05,
          auto: true,
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 1_000 })
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() },
        })) as Extract<Awaited<ReturnType<typeof Session.updateMessage>>, { role: "user" }>
        const assistant = (await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.id,
          agent: "build",
          mode: "build",
          modelID: ModelID.make("test-model"),
          providerID: ProviderID.make("test"),
          sessionID: session.id,
          time: { created: Date.now() },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
        })) as Extract<Awaited<ReturnType<typeof Session.updateMessage>>, { role: "assistant" }>

        const summarySpy = spyOn(SessionSummary, "summarize")
        summarySpy.mockImplementation((async () => {}) as any)
        const modelSpy = spyOn(Provider, "getModel")
        modelSpy.mockResolvedValue(model as any)
        spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 4_500, outputTokens: 1_500, totalTokens: 6_000 },
              providerMetadata: undefined,
            }
            yield { type: "finish" }
          })(),
        } as unknown as Awaited<ReturnType<typeof LLM.stream>>)

        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model,
          abort: new AbortController().signal,
        })

        const result = await processor.process({
          user: user,
          sessionID: session.id,
          agent: createAgent(),
          model,
          abort: new AbortController().signal,
          system: [],
          messages: [],
          tools: {},
        })

        expect(result).toBe("compact")
        modelSpy.mockRestore()
        summarySpy.mockRestore()
      },
    })
  })

  test("does not re-trigger when the previous turn was already above threshold", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        compaction: {
          threshold: 0.05,
          auto: true,
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 1_000 })
        const session = await Session.create({})
        const user1 = (await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() - 10_000 },
        })) as Extract<Awaited<ReturnType<typeof Session.updateMessage>>, { role: "user" }>
        await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user1.id,
          agent: "build",
          mode: "build",
          modelID: ModelID.make("test-model"),
          providerID: ProviderID.make("test"),
          sessionID: session.id,
          time: { created: Date.now() - 9_000, completed: Date.now() - 9_000 },
          tokens: { total: 7_000, input: 5_000, output: 2_000, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          finish: "stop",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
        })

        const user2 = (await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
          time: { created: Date.now() },
        })) as Extract<Awaited<ReturnType<typeof Session.updateMessage>>, { role: "user" }>
        const assistant = (await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user2.id,
          agent: "build",
          mode: "build",
          modelID: ModelID.make("test-model"),
          providerID: ProviderID.make("test"),
          sessionID: session.id,
          time: { created: Date.now() },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
        })) as Extract<Awaited<ReturnType<typeof Session.updateMessage>>, { role: "assistant" }>

        const summarySpy = spyOn(SessionSummary, "summarize")
        summarySpy.mockImplementation((async () => {}) as any)
        const modelSpy = spyOn(Provider, "getModel")
        modelSpy.mockResolvedValue(model as any)
        spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 4_800, outputTokens: 2_200, totalTokens: 7_000 },
              providerMetadata: undefined,
            }
            yield { type: "finish" }
          })(),
        } as unknown as Awaited<ReturnType<typeof LLM.stream>>)

        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model,
          abort: new AbortController().signal,
        })

        const result = await processor.process({
          user: user2,
          sessionID: session.id,
          agent: createAgent(),
          model,
          abort: new AbortController().signal,
          system: [],
          messages: [],
          tools: {},
        })

        expect(result).toBe("continue")
        modelSpy.mockRestore()
        summarySpy.mockRestore()
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

  test.each(["@ai-sdk/anthropic", "@ai-sdk/amazon-bedrock", "@ai-sdk/google-vertex/anthropic"])(
    "computes total from components for %s models",
    (npm) => {
      const model = createModel({ context: 100_000, output: 32_000, npm })
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        // These providers typically report total as input + output only,
        // excluding cache read/write.
        totalTokens: 1500,
        cachedInputTokens: 200,
      }
      if (npm === "@ai-sdk/amazon-bedrock") {
        const result = Session.getUsage({
          model,
          usage,
          metadata: {
            bedrock: {
              usage: {
                cacheWriteInputTokens: 300,
              },
            },
          },
        })

        expect(result.tokens.input).toBe(1000)
        expect(result.tokens.cache.read).toBe(200)
        expect(result.tokens.cache.write).toBe(300)
        expect(result.tokens.total).toBe(2000)
        return
      }

      const result = Session.getUsage({
        model,
        usage,
        metadata: {
          anthropic: {
            cacheCreationInputTokens: 300,
          },
        },
      })

      expect(result.tokens.input).toBe(1000)
      expect(result.tokens.cache.read).toBe(200)
      expect(result.tokens.cache.write).toBe(300)
      expect(result.tokens.total).toBe(2000)
    },
  )
})
