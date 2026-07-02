export * as XaiCache from "./xai-cache"

// @ai-sdk/xai has no provider option for the Responses API's prompt_cache_key,
// so mirror the x-grok-conv-id header set by LLMRequestPrep into the body here.
// https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits
export function withPromptCacheKey(baseFetch?: typeof fetch): typeof fetch {
  const inner = baseFetch ?? fetch
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = promptCacheKeyBody(input, init)
    return body === undefined ? inner(input, init) : inner(input, { ...init, body })
  }) as typeof fetch
}

function promptCacheKeyBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body !== "string") return
  const url = input instanceof Request ? input.url : input.toString()
  if (!new URL(url, "http://localhost").pathname.endsWith("/responses")) return
  const convID = new Headers(init.headers).get("x-grok-conv-id")
  if (!convID) return
  try {
    const parsed = JSON.parse(init.body)
    if (typeof parsed !== "object" || parsed === null || "prompt_cache_key" in parsed) return
    return JSON.stringify({ ...parsed, prompt_cache_key: convID })
  } catch {
    return
  }
}
