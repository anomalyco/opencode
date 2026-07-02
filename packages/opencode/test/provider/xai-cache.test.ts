import { describe, expect, test } from "bun:test"
import { XaiCache } from "@/provider/xai-cache"

describe("XaiCache.withPromptCacheKey", () => {
  test("mirrors x-grok-conv-id into prompt_cache_key on /responses requests only", async () => {
    const calls: RequestInit[] = []
    const wrapped = XaiCache.withPromptCacheKey((async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init!)
      return new Response("{}")
    }) as typeof fetch)
    const headers = { "x-grok-conv-id": "ses_abc123" }
    const body = JSON.stringify({ model: "grok-4.3", input: [] })

    await wrapped("https://api.x.ai/v1/responses", { method: "POST", headers, body })
    await wrapped("https://api.x.ai/v1/chat/completions", { method: "POST", headers, body })

    expect(JSON.parse(calls[0].body as string)).toEqual({
      model: "grok-4.3",
      input: [],
      prompt_cache_key: "ses_abc123",
    })
    expect(calls[1].body).toBe(body)
  })
})
