import { expect, mock, test } from "bun:test"
import path from "path"
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string, _version?: string) => {
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = () => ({})
mock.module("../../src/plugin", () => ({
  Plugin: {
    trigger: async (_name: string, _input: unknown, output: unknown) => output,
    list: async () => [],
    init: async () => {},
  },
}))
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))
mock.module("opencode-antigravity-auth", () => ({ default: mockPlugin }))
mock.module("opencode-pty", () => ({ default: mockPlugin }))
mock.module("opencode-scheduler", () => ({ default: mockPlugin }))

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

const schema = "https://opencode.ai/config.json"

const responseBody = {
  id: "res_1",
  created_at: 0,
  model: "retry-model",
  output: [
    {
      type: "message",
      role: "assistant",
      id: "msg_1",
      content: [
        {
          type: "output_text",
          text: "ok",
          annotations: [],
        },
      ],
    },
  ],
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
  },
}

const prompt = () => [
  {
    role: "user" as const,
    content: [{ type: "text" as const, text: "hi" }],
  },
]

const writeConfig = async (dir: string, config: Record<string, unknown>) => {
  await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: schema, ...config }))
}

test("retries /responses when include is rejected", async () => {
  const calls: { url: string; body: string }[] = []
  const attempt = { count: 0 }

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text()
      calls.push({ url: req.url, body })
      if (attempt.count === 0) {
        attempt.count += 1
        return new Response(JSON.stringify({ error: { message: "include is not supported" } }), {
          status: 400,
        })
      }
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    },
  })

  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        provider: {
          openai: {
            npm: "@ai-sdk/openai",
            api: server.url.origin,
            options: { apiKey: "test-key", baseURL: server.url.origin },
            models: {
              "retry-model": {
                name: "Retry Model",
                tool_call: true,
                limit: { context: 8000, output: 2000 },
              },
            },
          },
        },
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = await Provider.getModel("openai", "retry-model")
      const language = await Provider.getLanguage(model)
      await language.doGenerate({
        prompt: prompt(),
        providerOptions: { openai: { include: ["message.output_text.logprobs"] } },
      })
    },
  })

  expect(calls.length).toBe(2)
  expect(new URL(calls[0].url).pathname).toBe("/responses")
  expect(new URL(calls[1].url).pathname).toBe("/responses")
  const first = JSON.parse(calls[0].body)
  const second = JSON.parse(calls[1].body)
  expect(first.include).toContain("message.output_text.logprobs")
  expect("include" in second).toBe(false)
})

test("does not retry /responses when error text lacks include", async () => {
  const calls: { url: string; body: string }[] = []

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text()
      calls.push({ url: req.url, body })
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })
    },
  })

  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        provider: {
          openai: {
            npm: "@ai-sdk/openai",
            api: server.url.origin,
            options: { apiKey: "test-key", baseURL: server.url.origin },
            models: {
              "retry-model": {
                name: "Retry Model",
                tool_call: true,
                limit: { context: 8000, output: 2000 },
              },
            },
          },
        },
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = await Provider.getModel("openai", "retry-model")
      const language = await Provider.getLanguage(model)
      await expect(
        language.doGenerate({
          prompt: prompt(),
          providerOptions: { openai: { include: ["message.output_text.logprobs"] } },
        }),
      ).rejects.toThrow()
    },
  })

  expect(calls.length).toBe(1)
  expect(new URL(calls[0].url).pathname).toBe("/responses")
})

test("does not retry /responses when include was not sent", async () => {
  const calls: { url: string; body: string }[] = []

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text()
      calls.push({ url: req.url, body })
      return new Response(JSON.stringify({ error: { message: "include is not supported" } }), {
        status: 400,
      })
    },
  })

  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        provider: {
          openai: {
            npm: "@ai-sdk/openai",
            api: server.url.origin,
            options: { apiKey: "test-key", baseURL: server.url.origin },
            models: {
              "retry-model": {
                name: "Retry Model",
                tool_call: true,
                limit: { context: 8000, output: 2000 },
              },
            },
          },
        },
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = await Provider.getModel("openai", "retry-model")
      const language = await Provider.getLanguage(model)
      await expect(
        language.doGenerate({
          prompt: prompt(),
        }),
      ).rejects.toThrow()
    },
  })

  expect(calls.length).toBe(1)
  expect(new URL(calls[0].url).pathname).toBe("/responses")
  const body = JSON.parse(calls[0].body)
  expect("include" in body).toBe(false)
})

test("does not retry non-/responses endpoints", async () => {
  const calls: { url: string; body: string }[] = []

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text()
      calls.push({ url: req.url, body })
      return new Response(JSON.stringify({ error: { message: "include is not supported" } }), {
        status: 400,
      })
    },
  })

  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        provider: {
          "openai-compatible": {
            npm: "@ai-sdk/openai-compatible",
            api: server.url.origin,
            options: { apiKey: "test-key", baseURL: server.url.origin },
            models: {
              "chat-model": {
                name: "Chat Model",
                tool_call: true,
                limit: { context: 8000, output: 2000 },
              },
            },
          },
        },
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = await Provider.getModel("openai-compatible", "chat-model")
      const language = await Provider.getLanguage(model)
      await expect(
        language.doGenerate({
          prompt: prompt(),
        }),
      ).rejects.toThrow()
    },
  })

  expect(calls.length).toBe(1)
  expect(new URL(calls[0].url).pathname).toBe("/chat/completions")
})
