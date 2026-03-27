import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { ModelRewritePlugin } from "../../src/plugin/model-rewrite"
import type { PluginInput } from "@opencode-ai/plugin"

describe("ModelRewritePlugin", () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      OPENCODE_MODEL_REWRITE_PROVIDER: process.env.OPENCODE_MODEL_REWRITE_PROVIDER,
      OPENCODE_MODEL_REWRITE_MODEL: process.env.OPENCODE_MODEL_REWRITE_MODEL,
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  test("returns empty hooks when no env vars set", async () => {
    delete process.env.OPENCODE_MODEL_REWRITE_PROVIDER
    delete process.env.OPENCODE_MODEL_REWRITE_MODEL

    const hooks = await ModelRewritePlugin({} as PluginInput)
    expect(hooks["chat.message"]).toBeUndefined()
  })

  test("returns chat.message hook when env vars are set", async () => {
    process.env.OPENCODE_MODEL_REWRITE_PROVIDER = "alibaba"
    process.env.OPENCODE_MODEL_REWRITE_MODEL = "qwen-plus"

    const hooks = await ModelRewritePlugin({} as PluginInput)
    expect(hooks["chat.message"]).toBeDefined()
    expect(typeof hooks["chat.message"]).toBe("function")
  })

  test("rewrites model for user messages", async () => {
    process.env.OPENCODE_MODEL_REWRITE_PROVIDER = "alibaba"
    process.env.OPENCODE_MODEL_REWRITE_MODEL = "qwen-plus"

    const hooks = await ModelRewritePlugin({} as PluginInput)
    const output: any = {
      message: { role: "user", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
      parts: [],
    }

    await hooks["chat.message"]!(
      { sessionID: "test-session", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } } as any,
      output,
    )

    expect(output.message.model).toEqual({ providerID: "alibaba", modelID: "qwen-plus" })
  })

  test("does not modify non-user messages", async () => {
    process.env.OPENCODE_MODEL_REWRITE_PROVIDER = "alibaba"
    process.env.OPENCODE_MODEL_REWRITE_MODEL = "qwen-plus"

    const hooks = await ModelRewritePlugin({} as PluginInput)
    const output: any = {
      message: { role: "assistant", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
      parts: [],
    }

    await hooks["chat.message"]!(
      { sessionID: "test-session", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } } as any,
      output,
    )

    expect(output.message.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  test("trims whitespace from env vars", async () => {
    process.env.OPENCODE_MODEL_REWRITE_PROVIDER = "  alibaba  "
    process.env.OPENCODE_MODEL_REWRITE_MODEL = "  qwen-plus  "

    const hooks = await ModelRewritePlugin({} as PluginInput)
    const output: any = {
      message: { role: "user", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } },
      parts: [],
    }

    await hooks["chat.message"]!(
      { sessionID: "test-session", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } } as any,
      output,
    )

    expect(output.message.model).toEqual({ providerID: "alibaba", modelID: "qwen-plus" })
  })

  test("handles edge case with only provider set", async () => {
    process.env.OPENCODE_MODEL_REWRITE_PROVIDER = "alibaba"
    delete process.env.OPENCODE_MODEL_REWRITE_MODEL

    const hooks = await ModelRewritePlugin({} as PluginInput)
    expect(hooks["chat.message"]).toBeUndefined()
  })

  test("handles edge case with only model set", async () => {
    delete process.env.OPENCODE_MODEL_REWRITE_PROVIDER
    process.env.OPENCODE_MODEL_REWRITE_MODEL = "qwen-plus"

    const hooks = await ModelRewritePlugin({} as PluginInput)
    expect(hooks["chat.message"]).toBeUndefined()
  })

  test("handles empty env vars", async () => {
    process.env.OPENCODE_MODEL_REWRITE_PROVIDER = ""
    process.env.OPENCODE_MODEL_REWRITE_MODEL = ""

    const hooks = await ModelRewritePlugin({} as PluginInput)
    expect(hooks["chat.message"]).toBeUndefined()
  })

  test("handles whitespace-only env vars", async () => {
    process.env.OPENCODE_MODEL_REWRITE_PROVIDER = "   "
    process.env.OPENCODE_MODEL_REWRITE_MODEL = "   "

    const hooks = await ModelRewritePlugin({} as PluginInput)
    expect(hooks["chat.message"]).toBeUndefined()
  })
})
