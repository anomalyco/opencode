import { describe, expect, test } from "bun:test"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { CerebrasPlugin } from "../../src/plugin/cerebras"

type ChatParams = NonNullable<Hooks["chat.params"]>

function input(npm: string) {
  return {
    model: { api: { npm } },
  } as Parameters<ChatParams>[0]
}

function output(options: Record<string, unknown>) {
  return {
    maxOutputTokens: 32_000,
    options,
  } as Parameters<ChatParams>[1]
}

describe("CerebrasPlugin", () => {
  test("omits the generic output cap when max_completion_tokens is configured", async () => {
    const hook = (await CerebrasPlugin({} as PluginInput))["chat.params"]!
    const params = output({ max_completion_tokens: 64 })

    await hook(input("@ai-sdk/cerebras"), params)

    expect(params.maxOutputTokens).toBeUndefined()
  })

  test("preserves the generic output cap without max_completion_tokens", async () => {
    const hook = (await CerebrasPlugin({} as PluginInput))["chat.params"]!
    const params = output({})

    await hook(input("@ai-sdk/cerebras"), params)

    expect(params.maxOutputTokens).toBe(32_000)
  })

  test("does not change other providers", async () => {
    const hook = (await CerebrasPlugin({} as PluginInput))["chat.params"]!
    const params = output({ max_completion_tokens: 64 })

    await hook(input("@ai-sdk/openai"), params)

    expect(params.maxOutputTokens).toBe(32_000)
  })
})
