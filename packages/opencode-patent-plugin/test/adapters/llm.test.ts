import { describe, expect, test, mock, afterEach } from "bun:test"
import { OpenCodeLLMAdapter, createDefaultLLM } from "../../src/adapters/llm.js"

// mock global fetch
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("OpenCodeLLMAdapter", () => {
  const adapter = new OpenCodeLLMAdapter({
    baseUrl: "https://api.test.com/v1",
    apiKey: "test-key",
    modelId: "test-model",
  })

  test("isAvailable 有 baseUrl 和 apiKey 时为 true", () => {
    expect(adapter.isAvailable).toBe(true)
  })

  test("isAvailable 无配置时为 false", () => {
    const empty = new OpenCodeLLMAdapter({ baseUrl: "", apiKey: "" })
    expect(empty.isAvailable).toBe(false)
  })

  test("chat 正常调用", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "测试回复" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: "test-model",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as any

    const result = await adapter.chat({
      messages: [{ role: "user", content: "你好" }],
    })

    expect(result.content).toBe("测试回复")
    expect(result.usage?.promptTokens).toBe(10)
    expect(result.model).toBe("test-model")
  })

  test("chat API 错误抛出异常", async () => {
    globalThis.fetch = mock(async () =>
      new Response("unauthorized", { status: 401 }),
    ) as any

    expect(
      adapter.chat({ messages: [{ role: "user", content: "test" }] }),
    ).rejects.toThrow("LLM API error (401)")
  })

  test("chat 超时抛出异常", async () => {
    // 模拟 AbortError
    globalThis.fetch = mock(async (_url: string, opts: any) => {
      // 模拟 AbortController 触发
      const err = new DOMException("The operation was aborted", "AbortError")
      throw err
    }) as any

    // 使用短超时的适配器测试（这里的 30s 超时在真实环境才有效）
    // 此测试验证 AbortError 被正确转换
    expect(
      adapter.chat({ messages: [{ role: "user", content: "test" }] }),
    ).rejects.toThrow("timeout")
  })
})

describe("createDefaultLLM", () => {
  test("从 options 创建适配器", () => {
    const llm = createDefaultLLM({}, {
      baseUrl: "https://test.com",
      apiKey: "key123",
      model: "model-1",
    })
    expect(llm.isAvailable).toBe(true)
  })

  test("从 llm 嵌套配置创建", () => {
    const llm = createDefaultLLM({}, {
      llm: { baseUrl: "https://test.com", apiKey: "key", model: "m" },
    })
    expect(llm.isAvailable).toBe(true)
  })

  test("无配置时仍可创建（isAvailable=false）", () => {
    const original = process.env.LLM_BASE_URL
    const originalKey = process.env.LLM_API_KEY
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_API_KEY

    const llm = createDefaultLLM({})
    expect(llm.isAvailable).toBe(false)

    // 恢复环境变量
    if (original) process.env.LLM_BASE_URL = original
    if (originalKey) process.env.LLM_API_KEY = originalKey
  })
})
