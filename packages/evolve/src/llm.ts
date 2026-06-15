/**
 * LLM client abstraction. The evolution loop only depends on this interface, so
 * mutation/judging can run against the real API in production and a deterministic
 * mock in tests / offline environments (where no model credentials exist).
 */

export interface LLMRequest {
  system?: string
  prompt: string
  maxTokens?: number
  temperature?: number
}

export interface LLMClient {
  complete(req: LLMRequest): Promise<string>
}

export interface AnthropicOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch
  /** Per-request timeout in ms (default 60s). */
  timeoutMs?: number
  /** Retries on 429/5xx/network errors with exponential backoff (default 3). */
  maxRetries?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Minimal Anthropic Messages API client (no SDK dependency). */
export class AnthropicClient implements LLMClient {
  constructor(private readonly opts: AnthropicOptions = {}) {}

  async complete(req: LLMRequest): Promise<string> {
    const apiKey = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("AnthropicClient: ANTHROPIC_API_KEY is not set")
    const baseUrl = (this.opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(
      /\/$/,
      "",
    )
    const model = this.opts.model ?? process.env.EVOLVE_MODEL ?? "claude-sonnet-4-6"
    const doFetch = this.opts.fetch ?? fetch
    const timeoutMs = this.opts.timeoutMs ?? 60_000
    const maxRetries = this.opts.maxRetries ?? 3

    const body = JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: "user", content: req.prompt }],
    })

    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(Math.min(2 ** attempt * 500, 8_000)) // 1s, 2s, 4s, 8s
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await doFetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body,
          signal: controller.signal,
        })

        if (!res.ok) {
          const text = await res.text().catch(() => "")
          // Retry transient failures (rate limit / server errors); fail fast otherwise.
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            lastError = new Error(`AnthropicClient: ${res.status} ${res.statusText} ${text}`.trim())
            continue
          }
          throw new Error(`AnthropicClient: ${res.status} ${res.statusText} ${text}`.trim())
        }

        const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
        return (json.content ?? [])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("")
      } catch (err) {
        lastError = err
        if (attempt >= maxRetries) break
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`AnthropicClient: request failed: ${String(lastError)}`)
  }
}

export type MockResponder = (req: LLMRequest, index: number) => string

/** Deterministic client for tests and offline runs. */
export class MockLLMClient implements LLMClient {
  readonly calls: LLMRequest[] = []
  private index = 0

  constructor(private readonly responder: MockResponder) {}

  async complete(req: LLMRequest): Promise<string> {
    this.calls.push(req)
    return this.responder(req, this.index++)
  }
}
