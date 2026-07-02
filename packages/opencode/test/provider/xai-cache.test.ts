import { describe, expect, test } from "bun:test"
import { XaiCache } from "@/provider/xai-cache"

describe("XaiCache.withPromptCacheKey", () => {
  test("injects prompt_cache_key on /responses without touching other requests", async () => {
    const calls: RequestInit[] = []
    const wrapped = XaiCache.withPromptCacheKey((async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init!)
      return new Response("{}")
    }) as typeof fetch)
    const headers = { "x-grok-conv-id": "ses_abc123" }
    const body = JSON.stringify({ model: "grok-4.3", input: [] })
    const explicit = JSON.stringify({ model: "grok-4.3", prompt_cache_key: "custom" })

    await wrapped("https://api.x.ai/v1/responses", { method: "POST", headers, body })
    await wrapped("https://api.x.ai/v1/chat/completions", { method: "POST", headers, body })
    await wrapped("https://api.x.ai/v1/responses", { method: "POST", headers, body: explicit })
    await wrapped("https://api.x.ai/v1/responses", { method: "POST", headers, body: "not json" })

    // The conv id header becomes prompt_cache_key on /responses bodies.
    expect(JSON.parse(calls[0].body as string)).toEqual({
      model: "grok-4.3",
      input: [],
      prompt_cache_key: "ses_abc123",
    })
    // Other endpoints, explicit keys, and unparseable bodies pass through unchanged.
    expect(calls[1].body).toBe(body)
    expect(calls[2].body).toBe(explicit)
    expect(calls[3].body).toBe("not json")
  })
})
