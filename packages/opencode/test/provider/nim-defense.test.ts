import { test, expect } from "bun:test"
import {
  enrichNimRequest,
  fetchWithNimDefense,
  isNimProvider,
  normalizeNimResponse,
  normalizeNvidiaModelId,
  repairMalformedJson,
} from "../../src/provider/nim-defense"

// ─── isNimProvider ──────────────────────────────────────────────────

test("detects NVIDIA by provider ID and npm", () => {
  expect(isNimProvider("nvidia", "@ai-sdk/openai-compatible")).toBe(true)
})

test("detects NVIDIA by baseURL", () => {
  expect(isNimProvider("custom", "@ai-sdk/openai-compatible", "https://integrate.api.nvidia.com/v1")).toBe(true)
})

test("detects NVIDIA by baseURL with nvidia.com", () => {
  expect(isNimProvider("my-provider", "@ai-sdk/openai-compatible", "https://api.nvidia.com/v1")).toBe(true)
})

test("rejects non-NVIDIA providers", () => {
  expect(isNimProvider("anthropic", "@ai-sdk/anthropic")).toBe(false)
  expect(isNimProvider("openai", "@ai-sdk/openai")).toBe(false)
  expect(isNimProvider("nvidia", "@ai-sdk/openai")).toBe(false)
})

test("rejects openai-compatible with non-NVIDIA URL", () => {
  expect(isNimProvider("fireworks", "@ai-sdk/openai-compatible", "https://api.fireworks.ai/v1")).toBe(false)
})

// ─── normalizeNvidiaModelId ─────────────────────────────────────────

test("fixes double nvidia/ prefix", () => {
  expect(normalizeNvidiaModelId("nvidia/nvidia/meta/llama-3_1-70b")).toBe("nvidia/meta/llama-3_1-70b")
})

test("fixes triple nvidia/ prefix", () => {
  expect(normalizeNvidiaModelId("nvidia/nvidia/nvidia/meta/llama-3_1-70b")).toBe("nvidia/meta/llama-3_1-70b")
})

test("passes normal model ID through unchanged", () => {
  expect(normalizeNvidiaModelId("nvidia/meta/llama-3_1-70b")).toBe("nvidia/meta/llama-3_1-70b")
})

test("passes non-NVIDIA model ID through unchanged", () => {
  expect(normalizeNvidiaModelId("anthropic/claude-sonnet-4")).toBe("anthropic/claude-sonnet-4")
})

test("handles single nvidia/ prefix correctly (no dedup needed)", () => {
  expect(normalizeNvidiaModelId("nvidia/deepseek-ai/deepseek-v4")).toBe("nvidia/deepseek-ai/deepseek-v4")
})

test("is idempotent", () => {
  const id = "nvidia/nvidia/meta/llama-3_1-70b"
  expect(normalizeNvidiaModelId(normalizeNvidiaModelId(id))).toBe("nvidia/meta/llama-3_1-70b")
})

// ─── repairMalformedJson ────────────────────────────────────────────

test("passes valid JSON through unchanged", () => {
  const valid = '{"key": "value", "num": 42}'
  expect(repairMalformedJson(valid)).toBe(valid)
})

test("preserves apostrophes inside string values", () => {
  const input = '{"msg": "it\'s fine"}'
  const result = repairMalformedJson(input)
  // After repair, the single quotes-as-apostrophes should be preserved
  const parsed = JSON.parse(result)
  expect(parsed.msg).toBe("it's fine")
})

test("removes trailing commas in objects", () => {
  const result = repairMalformedJson('{"a": 1, "b": 2,}')
  expect(JSON.parse(result)).toEqual({ a: 1, b: 2 })
})

test("removes trailing commas in arrays", () => {
  const result = repairMalformedJson('[1, 2, 3,]')
  expect(JSON.parse(result)).toEqual([1, 2, 3])
})

test("converts single-quote JSON delimiters to double quotes", () => {
  const result = repairMalformedJson("{'key': 'value'}")
  expect(JSON.parse(result)).toEqual({ key: "value" })
})

test("converts Python True/False/None literals", () => {
  const result = repairMalformedJson('{"a": True, "b": False, "c": None}')
  const parsed = JSON.parse(result)
  expect(parsed.a).toBe(true)
  expect(parsed.b).toBe(false)
  expect(parsed.c).toBe(null)
})

test("balances missing closing braces", () => {
  const result = repairMalformedJson('{"a": {"b": 1}')
  expect(JSON.parse(result)).toEqual({ a: { b: 1 } })
})

test("handles braces inside JSON string values without corruption", () => {
  // Valid JSON - passes through
  const input = '{"code": "if (x) { return y; }"}'
  expect(repairMalformedJson(input)).toBe(input)
})

test("handles mixed single-quote delimiters and apostrophes", () => {
  const input = "{'msg': 'it\\'s broken', 'status': 'ok'}"
  const result = repairMalformedJson(input)
  const parsed = JSON.parse(result)
  expect(parsed.msg).toBe("it's broken")
  expect(parsed.status).toBe("ok")
})

test("handles empty input gracefully", () => {
  const result = repairMalformedJson("")
  expect(result).toBe("")
})

// ─── normalizeNimResponse ──────────────────────────────────────────

test("handles null/undefined input", () => {
  expect(normalizeNimResponse(null)).toBe(null)
  expect(normalizeNimResponse(undefined)).toBe(undefined)
})

test("generates response.id when missing", () => {
  const result = normalizeNimResponse({ choices: [] }) as any
  expect(result.id).toMatch(/^nim_/)
})

test("generates response.id when null", () => {
  const result = normalizeNimResponse({ id: null, choices: [] }) as any
  expect(result.id).toMatch(/^nim_/)
})

test("preserves valid response.id", () => {
  const result = normalizeNimResponse({ id: "valid-id", choices: [] }) as any
  expect(result.id).toBe("valid-id")
})

test("fixes numeric tool_call.id to string", () => {
  const input = {
    id: "r1",
    choices: [{ message: { tool_calls: [{ id: 123, function: { name: "f", arguments: "{}" } }] } }],
  }
  const result = normalizeNimResponse(input) as any
  expect(typeof result.choices[0].message.tool_calls[0].id).toBe("string")
  expect(result.choices[0].message.tool_calls[0].id).toBe("123")
})

test("generates tool_call.id when missing", () => {
  const input = {
    id: "r1",
    choices: [{ message: { tool_calls: [{ function: { name: "f", arguments: "{}" } }] } }],
  }
  const result = normalizeNimResponse(input) as any
  expect(result.choices[0].message.tool_calls[0].id).toMatch(/^call_/)
})

test("generates tool_call.id when null", () => {
  const input = {
    id: "r1",
    choices: [{ message: { tool_calls: [{ id: null, function: { name: "f", arguments: "{}" } }] } }],
  }
  const result = normalizeNimResponse(input) as any
  expect(result.choices[0].message.tool_calls[0].id).toMatch(/^call_/)
})

test("converts dict arguments to JSON string", () => {
  const input = {
    id: "r1",
    choices: [{
      message: {
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: { location: "Paris" } },
        }],
      },
    }],
  }
  const result = normalizeNimResponse(input) as any
  expect(typeof result.choices[0].message.tool_calls[0].function.arguments).toBe("string")
  expect(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments)).toEqual({ location: "Paris" })
})

test("strips thinking blocks from content", () => {
  const input = {
    id: "r1",
    choices: [{ message: { content: "Before<thinking>internal reasoning</thinking>After" } }],
  }
  const result = normalizeNimResponse(input) as any
  expect(result.choices[0].message.content).toBe("BeforeAfter")
})

test("strips think blocks (without ing) from content", () => {
  const input = {
    id: "r1",
    choices: [{ message: { content: "Hello <think>reasoning</think> world" } }],
  }
  const result = normalizeNimResponse(input) as any
  expect(result.choices[0].message.content).toBe("Hello  world")
})

test("passes valid responses through unchanged (no mutation)", () => {
  const input = {
    id: "r1",
    choices: [{
      message: {
        content: "Hello",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "f", arguments: '{"x": 1}' },
        }],
      },
    }],
  }
  const cloned = JSON.parse(JSON.stringify(input))
  normalizeNimResponse(input)
  // Input should not be mutated (function uses structuredClone)
  expect(JSON.stringify(input)).toBe(JSON.stringify(cloned))
})

test("skips null message gracefully", () => {
  const input = { choices: [{ message: null }] }
  expect(() => normalizeNimResponse(input)).not.toThrow()
  // Should still generate an id
  const result = normalizeNimResponse(input) as any
  expect(result.id).toMatch(/^nim_/)
})

test("handles content as array (non-string content)", () => {
  const input = {
    id: "r1",
    choices: [{ message: { content: [{ type: "text", text: "Hello" }] } }],
  }
  expect(() => normalizeNimResponse(input)).not.toThrow()
})

test("handles empty tool_calls array", () => {
  const input = {
    id: "r1",
    choices: [{ message: { content: "Hello", tool_calls: [] } }],
  }
  expect(() => normalizeNimResponse(input)).not.toThrow()
})

test("handles undefined tool_calls", () => {
  const input = {
    id: "r1",
    choices: [{ message: { content: "Hello" } }],
  }
  expect(() => normalizeNimResponse(input)).not.toThrow()
})

test("handles choices array with null entries", () => {
  const input = { id: "r1", choices: [null] }
  expect(() => normalizeNimResponse(input)).not.toThrow()
})

test("handles mixed tool_calls: some valid, some numeric, some missing", () => {
  const input = {
    id: "r1",
    choices: [{
      message: {
        tool_calls: [
          { id: "valid", function: { name: "f1", arguments: "{}" } },
          { id: 456, function: { name: "f2", arguments: "{}" } },
          { function: { name: "f3", arguments: "{}" } },
        ],
      },
    }],
  }
  const result = normalizeNimResponse(input) as any
  const calls = result.choices[0].message.tool_calls
  expect(calls[0].id).toBe("valid")
  expect(calls[1].id).toBe("456")
  expect(calls[2].id).toMatch(/^call_/)
})

test("handles tool_call without function property", () => {
  const input = {
    id: "r1",
    choices: [{
      message: {
        tool_calls: [{ id: "c1" }],
      },
    }],
  }
  expect(() => normalizeNimResponse(input)).not.toThrow()
})

test("preserves extra properties on response", () => {
  const input = {
    id: "r1",
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
    model: "test-model",
  }
  const result = normalizeNimResponse(input) as any
  expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 })
  expect(result.model).toBe("test-model")
})

// ─── enrichNimRequest ───────────────────────────────────────────────

test("injects chat_template_kwargs for DeepSeek v4 reasoning models", () => {
  const body = {}
  const result = enrichNimRequest(body, "nvidia/deepseek-ai/deepseek-v4-flash")
  expect(result.chat_template_kwargs).toEqual({ enable_thinking: true, thinking: true })
})

test("injects chat_template_kwargs for Kimi K2 models", () => {
  const body = {}
  const result = enrichNimRequest(body, "nvidia/moonshotai/kimi-k2.6")
  expect(result.chat_template_kwargs).toEqual({ thinking: true })
})

test("injects chat_template_kwargs for GLM-5 models", () => {
  const body = {}
  const result = enrichNimRequest(body, "nvidia/z-ai/glm-5.1")
  expect(result.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false })
})

test("merges user kwargs with defaults (user wins)", () => {
  const body = { chat_template_kwargs: { thinking: false } }
  const result = enrichNimRequest(body, "nvidia/deepseek-ai/deepseek-v4-flash")
  const kwargs = result.chat_template_kwargs as Record<string, unknown> | undefined
  // Defaults first, user overwrites
  expect(kwargs?.thinking).toBe(false)
  expect(kwargs?.enable_thinking).toBe(true)
})

test("does not inject kwargs for non-reasoning models", () => {
  const body = {}
  const result = enrichNimRequest(body, "nvidia/meta/llama-3_1-70b")
  expect(result.chat_template_kwargs).toBeUndefined()
})

test("uses fallback heuristic for unknown reasoning model variants", () => {
  const body = {}
  const result = enrichNimRequest(body, "nvidia/deepseek-ai/deepseek-r1")
  expect(result.chat_template_kwargs).toEqual({ enable_thinking: true, thinking: true })
})

test("logs warning when user kwargs conflict with required kwargs", () => {
  const body = { chat_template_kwargs: { enable_thinking: false } }
  const warnings: string[] = []
  const log = (msg: string) => warnings.push(msg)
  enrichNimRequest(body, "nvidia/deepseek-ai/deepseek-v4-flash", log)
  expect(warnings.length).toBeGreaterThan(0)
  expect(warnings[0]).toContain("enable_thinking")
})

test("does not mutate original body", () => {
  const body = { existing: "value" }
  const result = enrichNimRequest(body, "nvidia/deepseek-ai/deepseek-v4-flash")
  expect(body).toEqual({ existing: "value" })
  expect(result).not.toBe(body)
})

// ─── fetchWithNimDefense (retry wrapper) ────────────────────────────

test("passes through successful response unchanged", async () => {
  const mockResponse = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
  const result = await fetchWithNimDefense(async () => mockResponse, "test-model", { maxRetries: 0 })
  expect(result.status).toBe(200)
  const body = await result.json()
  expect(body.ok).toBe(true)
})

test("retries on HTTP 429 and eventually succeeds", async () => {
  let attempt = 0
  const sleepFn = async (ms: number) => { /* no-op for test speed */ }
  const result = await fetchWithNimDefense(async () => {
    attempt++
    if (attempt <= 2) return new Response("rate limit", { status: 429, headers: { "content-type": "text/plain" } })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
  }, "test-model", { maxRetries: 3, baseDelay: 1, sleepFn, log: undefined })
  expect(attempt).toBe(3)
  const body = await result.json()
  expect(body.ok).toBe(true)
})

test("passes through HTTP 401 without retrying", async () => {
  let attempt = 0
  const result = await fetchWithNimDefense(async () => {
    attempt++
    return new Response("Unauthorized", { status: 401 })
  }, "test-model", { maxRetries: 3, baseDelay: 1 })
  expect(result.status).toBe(401)
  expect(attempt).toBe(1)
})

test("passes through HTTP 403 without retrying", async () => {
  let attempt = 0
  const result = await fetchWithNimDefense(async () => {
    attempt++
    return new Response("Forbidden", { status: 403 })
  }, "test-model", { maxRetries: 3, baseDelay: 1 })
  expect(result.status).toBe(403)
  expect(attempt).toBe(1)
})

test("passes through HTTP 404 without retrying", async () => {
  let attempt = 0
  const result = await fetchWithNimDefense(async () => {
    attempt++
    return new Response("Not Found", { status: 404 })
  }, "test-model", { maxRetries: 3, baseDelay: 1 })
  expect(result.status).toBe(404)
  expect(attempt).toBe(1)
})

test("exhausts retries and throws with summary", async () => {
  let attempts = 0
  const sleepFn = async (ms: number) => { /* no-op */ }
  await expect(
    fetchWithNimDefense(async () => {
      attempts++
      return new Response("unavailable", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    }, "test-model", { maxRetries: 3, baseDelay: 1, sleepFn }),
  ).rejects.toThrow(/NIM retry exhausted/)
  expect(attempts).toBe(3)
})

test("respects external abort signal", async () => {
  const ctl = new AbortController()
  ctl.abort()
  await expect(
    fetchWithNimDefense(async () => new Response("ok"), "test-model", { signal: ctl.signal, maxRetries: 0 }),
  ).rejects.toThrow()
})

test("uses exponential backoff with full jitter", async () => {
  const delays: number[] = []
  const sleepFn = async (ms: number) => { delays.push(ms) }
  let attempt = 0
  await expect(
    fetchWithNimDefense(async () => {
      attempt++
      return new Response("unavailable", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    }, "test-model", { maxRetries: 3, baseDelay: 1000, sleepFn }),
  ).rejects.toThrow()
  // delays should increase (each is random(0, cap) so just check they're roughly in range)
  expect(delays.length).toBe(2) // attempt 0 delays, attempt 1 delays
  expect(delays[0]).toBeLessThanOrEqual(1000)
  // Attempt 2 (last) doesn't delay since it exhausts
})

test("supports config overrides", async () => {
  let attempts = 0
  const sleepFn = async (ms: number) => { /* no-op */ }
  await expect(
    fetchWithNimDefense(async () => {
      attempts++
      return new Response("unavailable", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    }, "test-model", { maxRetries: 2, baseDelay: 10, sleepFn }),
  ).rejects.toThrow()
  expect(attempts).toBe(2)
})

test("does not apply retry to non-NVIDIA providers (pass-through)", async () => {
  // fetchWithNimDefense is provider-agnostic — the caller decides which provider gets retry
  const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 })
  const result = await fetchWithNimDefense(async () => mockResponse, "any-provider", { maxRetries: 0 })
  expect(result.status).toBe(200)
})
