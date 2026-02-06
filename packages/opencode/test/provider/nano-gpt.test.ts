import { test, expect, mock } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"

test("nano-gpt syncs missing models from /models", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString()
    if (url.includes("/models?detailed=true")) {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer test-key")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "moonshotai/kimi-k2.5:thinking",
                name: "Kimi K2.5 Thinking",
                context_length: 262144,
                max_output_tokens: 64000,
              },
              {
                id: "moonshotai/kimi-k2.5",
                name: "Kimi K2.5",
                context_length: 256000,
                max_output_tokens: 65536,
              },
              {
                id: "moonshotai/kimi-k2.5-original:thinking",
                name: "Kimi K2.5 Original Thinking",
                context_length: 128000,
                max_output_tokens: 16000,
              },
              {
                id: "moonshotai/kimi-k2-thinking",
                name: "Kimi K2 Thinking",
                context_length: 262144,
                max_output_tokens: 64000,
              },
            ],
          }),
          { status: 200 },
        ),
      )
    }
    return originalFetch(input, init)
  }) as unknown as typeof fetch

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("NANO_GPT_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["nano-gpt"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5:thinking"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5-original:thinking"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5:thinking"].capabilities.reasoning).toBe(true)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5:thinking"].limit.context).toBe(262144)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5:thinking"].limit.output).toBe(64000)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5"].limit.context).toBe(256000)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5"].limit.output).toBe(65536)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5"].capabilities.reasoning).toBe(false)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5-original:thinking"].limit.context).toBe(128000)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5-original:thinking"].limit.output).toBe(16000)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5:thinking"].name).toBe("Kimi K2.5 Thinking")
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5-original:thinking"].name).toBe(
          "Kimi K2.5 Original Thinking",
        )
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2-thinking"].limit.context).toBe(262144)
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2-thinking"].limit.output).toBe(64000)
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
}, 20000)

test("nano-gpt model sync failure keeps static models", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString()
    if (url.includes("/models?detailed=true")) {
      return Promise.resolve(new Response("unauthorized", { status: 401 }))
    }
    return originalFetch(input, init)
  }) as unknown as typeof fetch

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("NANO_GPT_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["nano-gpt"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2-thinking"]).toBeDefined()
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
}, 20000)
