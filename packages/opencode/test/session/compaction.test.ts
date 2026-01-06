import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util/token"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"
import type { Provider } from "../../src/provider/provider"

Log.init({ print: false })

function createModel(opts: { context: number; output: number; cost?: Provider.Model["cost"] }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
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
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
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
        const tokens = { input: 50_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
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
})

describe("session.compaction.prune", () => {
  test("clears output and attachments when pruning tool parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a session
        const session = await Session.create({})

        // Create user messages with turns to get past the initial protection
        const userMsg1 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() - 10000 },
          agent: "coder",
          model: { providerID: "test", modelID: "test-model" },
        })

        // Create an assistant message with a completed tool part containing large output
        const assistantMsg1 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          parentID: userMsg1.id,
          sessionID: session.id,
          mode: "normal",
          agent: "coder",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() - 9000 },
        })

        // Create large output to exceed PRUNE_PROTECT (40,000 tokens = 160,000 chars)
        const largeOutput = "x".repeat(200_000)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMsg1.id,
          sessionID: session.id,
          type: "tool",
          callID: "call-1",
          tool: "read",
          state: {
            status: "completed",
            input: { path: "/test/file.ts" },
            output: largeOutput,
            title: "Read file",
            metadata: {},
            time: { start: Date.now() - 8000, end: Date.now() - 7000 },
            attachments: [
              {
                id: Identifier.ascending("part"),
                messageID: assistantMsg1.id,
                sessionID: session.id,
                type: "file",
                mime: "image/png",
                filename: "screenshot.png",
                url: "data:image/png;base64," + "A".repeat(50000),
              },
            ],
          },
        } as MessageV2.ToolPart)

        // Create a second user message (turn 2)
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() - 5000 },
          agent: "coder",
          model: { providerID: "test", modelID: "test-model" },
        })

        // Create a third user message (turn 3) to get past the turn protection
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "coder",
          model: { providerID: "test", modelID: "test-model" },
        })

        // Verify initial state - output and attachments exist
        const initialParts = await MessageV2.parts(assistantMsg1.id)
        const initialToolPart = initialParts.find((p) => p.type === "tool") as MessageV2.ToolPart
        expect(initialToolPart.state.status).toBe("completed")
        if (initialToolPart.state.status === "completed") {
          expect(initialToolPart.state.output.length).toBe(200_000)
          expect(initialToolPart.state.attachments?.length).toBe(1)
        }

        // Run prune
        await SessionCompaction.prune({ sessionID: session.id })

        // Verify output and attachments are cleared
        const prunedParts = await MessageV2.parts(assistantMsg1.id)
        const prunedToolPart = prunedParts.find((p) => p.type === "tool") as MessageV2.ToolPart
        expect(prunedToolPart.state.status).toBe("completed")
        if (prunedToolPart.state.status === "completed") {
          expect(prunedToolPart.state.output).toBe("")
          expect(prunedToolPart.state.attachments).toBeUndefined()
          expect(prunedToolPart.state.time.compacted).toBeDefined()
        }

        // Cleanup
        await Session.remove(session.id)
      },
    })
  })

  test("does not prune when prune config is disabled", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ compaction: { prune: false } }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Create user message
        const userMsg1 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() - 10000 },
          agent: "coder",
          model: { providerID: "test", modelID: "test-model" },
        })

        // Create an assistant message with a tool part containing large output
        const assistantMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          parentID: userMsg1.id,
          sessionID: session.id,
          mode: "normal",
          agent: "coder",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() - 9000 },
        })

        // Create large output
        const largeOutput = "x".repeat(200_000)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMsg.id,
          sessionID: session.id,
          type: "tool",
          callID: "call-1",
          tool: "read",
          state: {
            status: "completed",
            input: { path: "/test/file.ts" },
            output: largeOutput,
            title: "Read file",
            metadata: {},
            time: { start: Date.now() - 8000, end: Date.now() - 7000 },
            attachments: [
              {
                id: Identifier.ascending("part"),
                messageID: assistantMsg.id,
                sessionID: session.id,
                type: "file",
                mime: "image/png",
                filename: "screenshot.png",
                url: "data:image/png;base64," + "A".repeat(50000),
              },
            ],
          },
        } as MessageV2.ToolPart)

        // Create additional user messages to get past turn protection
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() - 5000 },
          agent: "coder",
          model: { providerID: "test", modelID: "test-model" },
        })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "coder",
          model: { providerID: "test", modelID: "test-model" },
        })

        // Run prune - should return early due to config
        await SessionCompaction.prune({ sessionID: session.id })

        // Verify output and attachments remain unchanged (not compacted)
        const parts = await MessageV2.parts(assistantMsg.id)
        const toolPart = parts.find((p) => p.type === "tool") as MessageV2.ToolPart
        expect(toolPart.state.status).toBe("completed")
        if (toolPart.state.status === "completed") {
          expect(toolPart.state.output.length).toBe(200_000)
          expect(toolPart.state.attachments?.length).toBe(1)
          expect(toolPart.state.time.compacted).toBeUndefined()
        }

        // Cleanup
        await Session.remove(session.id)
      },
    })
  })
})
