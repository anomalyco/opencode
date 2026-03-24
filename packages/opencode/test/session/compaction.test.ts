import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util/token"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionProcessor } from "../../src/session/processor"

Log.init({ print: false })

afterEach(() => {
  mock.restore()
})

const ref = {
  providerID: ProviderID.make("openai"),
  modelID: ModelID.make("gpt-5.2"),
}

const zero = {
  output: 0,
  input: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

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

async function user(input: {
  sessionID: SessionID
  text?: string
  file?: {
    mime: string
    url: string
    filename?: string
  }
}) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    agent: "build",
    model: ref,
    time: {
      created: Date.now(),
    },
  })
  if (input.text) {
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID: input.sessionID,
      type: "text",
      text: input.text,
    })
  }
  if (input.file) {
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID: input.sessionID,
      type: "file",
      mime: input.file.mime,
      url: input.file.url,
      filename: input.file.filename,
    })
  }
  return msg
}

async function assistant(input: {
  sessionID: SessionID
  parentID: MessageID
  dir: string
  finish?: string
}) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: input.sessionID,
    mode: "build",
    agent: "build",
    path: {
      cwd: input.dir,
      root: input.dir,
    },
    cost: 0,
    tokens: zero,
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID: input.parentID,
    time: {
      created: Date.now(),
      ...(input.finish ? { completed: Date.now() } : {}),
    },
    ...(input.finish ? { finish: input.finish } : {}),
  }
  await Session.updateMessage(msg)
  return msg
}

async function compact(input: { sessionID: SessionID; overflow?: boolean }) {
  await SessionCompaction.create({
    sessionID: input.sessionID,
    agent: "build",
    model: ref,
    auto: true,
    overflow: input.overflow,
  })
  return (await Session.messages({ sessionID: input.sessionID })).at(-1)!
}

function stub(model: Provider.Model) {
  spyOn(Provider, "getModel").mockResolvedValue(model)
  spyOn(SessionProcessor, "create").mockImplementation(
    (input) =>
      ({
        message: input.assistantMessage,
        partFromToolCall() {
          throw new Error("not used")
        },
        async process() {
          input.assistantMessage.finish = "stop"
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          return "continue"
        },
      }) satisfies SessionProcessor.Info,
  )
}

function texts(msg: MessageV2.WithParts) {
  return msg.parts.filter((part) => part.type === "text").map((part) => part.text)
}

function synthetic(msgs: MessageV2.WithParts[]) {
  return msgs.findLast((msg) =>
    msg.parts.some((part) => part.type === "text" && part.synthetic && part.text.includes("Continue if you have next steps")),
  )
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

describe("session.compaction.process", () => {
  test("does not inject a synthetic continue message after a natural stop", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        stub(model)

        const session = await Session.create({})
        const first = await user({ sessionID: session.id, text: "hello" })
        await assistant({
          sessionID: session.id,
          parentID: first.id,
          dir: tmp.path,
          finish: "stop",
        })
        const task = await compact({ sessionID: session.id })

        if (task.info.role !== "user") throw new Error("expected compaction user message")

        await SessionCompaction.process({
          parentID: task.info.id,
          messages: await Session.messages({ sessionID: session.id }),
          sessionID: session.id,
          abort: new AbortController().signal,
          auto: true,
        })

        const msgs = await Session.messages({ sessionID: session.id })
        expect(synthetic(msgs)).toBeUndefined()
        expect(msgs.at(-1)?.info.role).toBe("assistant")
      },
    })
  })

  test("replays the interrupted user message when overflow compaction has replay context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        stub(model)

        const session = await Session.create({})
        const first = await user({ sessionID: session.id, text: "keep this context" })
        await assistant({
          sessionID: session.id,
          parentID: first.id,
          dir: tmp.path,
          finish: "stop",
        })
        const replay = await user({
          sessionID: session.id,
          text: "please continue",
          file: {
            mime: "image/png",
            url: "data:image/png;base64,AA==",
            filename: "shot.png",
          },
        })
        await assistant({
          sessionID: session.id,
          parentID: replay.id,
          dir: tmp.path,
        })
        const task = await compact({ sessionID: session.id, overflow: true })

        if (task.info.role !== "user") throw new Error("expected compaction user message")

        await SessionCompaction.process({
          parentID: task.info.id,
          messages: await Session.messages({ sessionID: session.id }),
          sessionID: session.id,
          abort: new AbortController().signal,
          auto: true,
          overflow: true,
        })

        const msgs = await Session.messages({ sessionID: session.id })
        const last = msgs.at(-1)
        if (!last || last.info.role !== "user") throw new Error("expected replay user message")
        expect(texts(last)).toEqual(["please continue", "[Attached image/png: shot.png]"])
        expect(synthetic(msgs)).toBeUndefined()
      },
    })
  })

  test("keeps the overflow synthetic continue when replay is unavailable", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        stub(model)

        const session = await Session.create({})
        const first = await user({
          sessionID: session.id,
          text: "look at this image",
          file: {
            mime: "image/png",
            url: "data:image/png;base64,AA==",
            filename: "big.png",
          },
        })
        await assistant({
          sessionID: session.id,
          parentID: first.id,
          dir: tmp.path,
        })
        const task = await compact({ sessionID: session.id, overflow: true })

        if (task.info.role !== "user") throw new Error("expected compaction user message")

        await SessionCompaction.process({
          parentID: task.info.id,
          messages: await Session.messages({ sessionID: session.id }),
          sessionID: session.id,
          abort: new AbortController().signal,
          auto: true,
          overflow: true,
        })

        const msgs = await Session.messages({ sessionID: session.id })
        const last = synthetic(msgs)
        if (!last || last.info.role !== "user") throw new Error("expected synthetic continue user message")
        expect(texts(last)[0]).toContain("The previous request exceeded the provider's size limit")
      },
    })
  })
})
