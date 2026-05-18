import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  QwenThinkingDefaultPlugin,
  shouldApply,
} from "../../../src/securecode/plugins/qwen-thinking-default"

const stubPluginInput = {} as Parameters<typeof QwenThinkingDefaultPlugin>[0]

const DISABLE_ENV = "SECURECODE_QWEN_THINKING_DEFAULT_DISABLE"

const baseInput = (modelId: string) =>
  ({
    sessionID: "s1",
    agent: "build",
    model: { id: modelId, limit: { context: 262_144, output: 16_384 } },
    provider: { source: "config", info: {}, options: {} },
    message: {},
  }) as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof QwenThinkingDefaultPlugin>>["chat.params"]>>[0]

const baseOutput = () => ({
  temperature: 0.55,
  topP: 1,
  topK: 1,
  maxOutputTokens: 1024,
  options: {} as Record<string, any>,
})

beforeEach(() => {
  delete process.env[DISABLE_ENV]
})

afterEach(() => {
  delete process.env[DISABLE_ENV]
})

describe("shouldApply", () => {
  test.each([
    ["qwen3.6-35b-a3b-fp8", true],
    ["qwen3.0-7b", true],
    ["qwen3.5-coder", true],
    ["Qwen3.6-35B-A3B-FP8", true],
    ["qwen3-coder-next", false],
    ["qwen3-coder-480b-a35b-instruct", false],
    ["qwen-plus", false],
    ["qwq-32b", false],
    ["claude-sonnet-4-6", false],
    ["", false],
  ])("matches %s -> %p", (modelId, expected) => {
    expect(shouldApply(modelId)).toBe(expected)
  })

  test("rejects null / undefined", () => {
    expect(shouldApply(null)).toBe(false)
    expect(shouldApply(undefined)).toBe(false)
  })
})

describe("QwenThinkingDefaultPlugin chat.params", () => {
  test("sets enable_thinking=false default for qwen3.x", async () => {
    const hooks = await QwenThinkingDefaultPlugin(stubPluginInput)
    const chatParams = hooks["chat.params"]!
    const output = baseOutput()
    await chatParams(baseInput("qwen3.6-35b-a3b-fp8"), output as any)
    expect(output.options.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  test("merges into existing chat_template_kwargs without overwriting siblings", async () => {
    const hooks = await QwenThinkingDefaultPlugin(stubPluginInput)
    const chatParams = hooks["chat.params"]!
    const output = baseOutput()
    output.options.chat_template_kwargs = { custom_flag: true }
    await chatParams(baseInput("qwen3.6-35b-a3b-fp8"), output as any)
    expect(output.options.chat_template_kwargs).toEqual({
      custom_flag: true,
      enable_thinking: false,
    })
  })

  test("respects user-set enable_thinking=true (does not overwrite)", async () => {
    const hooks = await QwenThinkingDefaultPlugin(stubPluginInput)
    const chatParams = hooks["chat.params"]!
    const output = baseOutput()
    output.options.chat_template_kwargs = { enable_thinking: true }
    await chatParams(baseInput("qwen3.6-35b-a3b-fp8"), output as any)
    expect(output.options.chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  test("respects user-set enable_thinking=false (does not duplicate)", async () => {
    const hooks = await QwenThinkingDefaultPlugin(stubPluginInput)
    const chatParams = hooks["chat.params"]!
    const output = baseOutput()
    output.options.chat_template_kwargs = { enable_thinking: false }
    await chatParams(baseInput("qwen3.6-35b-a3b-fp8"), output as any)
    expect(output.options.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  test("does not touch options for non-qwen3.x models", async () => {
    const hooks = await QwenThinkingDefaultPlugin(stubPluginInput)
    const chatParams = hooks["chat.params"]!
    const output = baseOutput()
    await chatParams(baseInput("qwen3-coder-next"), output as any)
    expect(output.options).toEqual({})
  })

  test("does not touch options when model.id is missing", async () => {
    const hooks = await QwenThinkingDefaultPlugin(stubPluginInput)
    const chatParams = hooks["chat.params"]!
    const output = baseOutput()
    const input = baseInput("qwen3.6-35b-a3b-fp8") as any
    input.model = {}
    await chatParams(input, output as any)
    expect(output.options).toEqual({})
  })
})

describe("QwenThinkingDefaultPlugin disable env var", () => {
  test("returns no hooks when SECURECODE_QWEN_THINKING_DEFAULT_DISABLE=1", async () => {
    process.env[DISABLE_ENV] = "1"
    const hooks = await QwenThinkingDefaultPlugin(stubPluginInput)
    expect(hooks["chat.params"]).toBeUndefined()
  })
})
