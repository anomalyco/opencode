import { describe, expect, test } from "bun:test"
import { XaiCache } from "@/provider/xai-cache"

function capture() {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init })
    return new Response("{}")
  }) as typeof fetch
  return { calls, fetchFn }
}

describe("XaiCache.withPromptCacheKey", () => {
  const url = "https://api.x.ai/v1/responses"
  const headers = { "x-grok-conv-id": "ses_abc123", "content-type": "application/json" }

  test("mirrors x-grok-conv-id into prompt_cache_key on /responses bodies", async () => {
    const { calls, fetchFn } = capture()
    await XaiCache.withPromptCacheKey(fetchFn)(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "grok-4.3", input: [] }),
    })
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      model: "grok-4.3",
      input: [],
      prompt_cache_key: "ses_abc123",
    })
  })

  test("preserves an explicit prompt_cache_key", async () => {
    const { calls, fetchFn } = capture()
    const body = JSON.stringify({ model: "grok-4.3", prompt_cache_key: "custom" })
    await XaiCache.withPromptCacheKey(fetchFn)(url, { method: "POST", headers, body })
    expect(calls[0].init?.body).toBe(body)
  })

  test("leaves non-responses endpoints untouched", async () => {
    const { calls, fetchFn } = capture()
    const body = JSON.stringify({ model: "grok-4.3", messages: [] })
    await XaiCache.withPromptCacheKey(fetchFn)("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers,
      body,
    })
    expect(calls[0].init?.body).toBe(body)
  })

  test("skips requests without the conv id header", async () => {
    const { calls, fetchFn } = capture()
    const body = JSON.stringify({ model: "grok-4.3", input: [] })
    await XaiCache.withPromptCacheKey(fetchFn)(url, { method: "POST", body })
    expect(calls[0].init?.body).toBe(body)
  })

  test("passes through non-JSON bodies", async () => {
    const { calls, fetchFn } = capture()
    await XaiCache.withPromptCacheKey(fetchFn)(url, { method: "POST", headers, body: "not json" })
    expect(calls[0].init?.body).toBe("not json")
  })
})
