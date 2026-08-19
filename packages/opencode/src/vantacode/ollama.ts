/**
 * Native Ollama client for VantaCode.
 *
 * This talks to Ollama's own `/api/chat` and `/api/tags` / `/api/show` endpoints
 * rather than the OpenAI-compatible `/v1` shim. Tool-call reliability on local
 * models is measurably better on the native endpoint, so VantaCode routes local
 * inference here.
 *
 * The module is intentionally dependency-free (plain fetch + types) so it can be
 * unit tested with Node and reused by the doctor / optimize commands without
 * pulling in the wider Effect runtime.
 */

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"

/** Models that are known-good for agentic tool use. Used by the doctor check. */
export const KNOWN_GOOD_TOOL_MODELS = [
  "qwen2.5-coder",
  "qwen3-coder",
  "qwen3",
  "qwen2.5",
  "llama3.1",
  "llama3.2",
  "llama3.3",
  "mistral",
  "mistral-nemo",
  "hermes3",
  "glm-4",
  "glm4",
  "firefunction",
  "command-r",
] as const

export interface OllamaToolFunction {
  readonly name: string
  readonly description?: string
  readonly parameters: Record<string, unknown>
}

export interface OllamaTool {
  readonly type: "function"
  readonly function: OllamaToolFunction
}

export interface OllamaToolCall {
  readonly function: {
    readonly name: string
    /** Ollama returns already-parsed arguments as an object. */
    readonly arguments: Record<string, unknown>
  }
}

export interface OllamaMessage {
  readonly role: "system" | "user" | "assistant" | "tool"
  readonly content: string
  readonly thinking?: string
  readonly tool_calls?: OllamaToolCall[]
  /** Present on `role: "tool"` messages to correlate a result with its call. */
  readonly tool_name?: string
  readonly images?: string[]
}

export interface OllamaChatOptions {
  readonly num_ctx?: number
  readonly num_gpu?: number
  readonly num_thread?: number
  readonly temperature?: number
  readonly top_p?: number
  readonly num_predict?: number
  readonly [key: string]: unknown
}

export interface OllamaChatRequest {
  readonly model: string
  readonly messages: OllamaMessage[]
  readonly tools?: OllamaTool[]
  readonly stream?: boolean
  readonly think?: boolean
  readonly keep_alive?: string | number
  readonly options?: OllamaChatOptions
  readonly format?: "json" | Record<string, unknown>
}

export interface OllamaChatChunk {
  readonly model: string
  readonly created_at?: string
  readonly message?: OllamaMessage
  readonly done: boolean
  readonly done_reason?: string
  readonly total_duration?: number
  readonly load_duration?: number
  readonly prompt_eval_count?: number
  readonly eval_count?: number
}

export interface OllamaModelCapabilities {
  readonly tools: boolean
  readonly completion: boolean
  readonly vision: boolean
  readonly thinking: boolean
  readonly embedding: boolean
}

export interface OllamaModelInfo {
  readonly name: string
  readonly capabilities: OllamaModelCapabilities
  readonly parameterSize?: string
  readonly quantization?: string
  readonly family?: string
  /** Model size on disk in bytes, when reported by /api/tags. */
  readonly sizeBytes?: number
}

export class OllamaError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "OllamaError"
    this.status = status
  }
}

/** Normalize a user-provided host into a scheme+origin with no trailing slash. */
export function normalizeHost(host?: string): string {
  const raw = (host ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST).trim()
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    return new URL(withScheme).origin
  } catch {
    return DEFAULT_OLLAMA_HOST
  }
}

export interface OllamaClientConfig {
  readonly host?: string
  readonly headers?: Record<string, string>
  /** When true, raw request/response bodies are logged (mirrors OLLAMA_DEBUG=1). */
  readonly debug?: boolean
  readonly fetchImpl?: typeof fetch
  /** Sink for debug output; defaults to stderr. */
  readonly logger?: (line: string) => void
}

function capabilityList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === "string")
}

export class OllamaClient {
  readonly host: string
  private readonly headers: Record<string, string>
  private readonly debug: boolean
  private readonly fetchImpl: typeof fetch
  private readonly log: (line: string) => void

  constructor(config: OllamaClientConfig = {}) {
    this.host = normalizeHost(config.host)
    this.headers = { "content-type": "application/json", ...config.headers }
    this.debug = config.debug ?? (process.env.OLLAMA_DEBUG === "1" || process.env.VANTACODE_DEBUG === "1")
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch
    this.log = config.logger ?? ((line) => process.stderr.write(`[vantacode:ollama] ${line}\n`))
  }

  private debugLog(label: string, payload: unknown) {
    if (!this.debug) return
    const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
    this.log(`${label}: ${body}`)
  }

  /** Returns true if the Ollama server responds to /api/version. */
  async ping(timeoutMs = 2_000): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.host}/api/version`, {
        headers: this.headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async version(timeoutMs = 2_000): Promise<string | undefined> {
    try {
      const res = await this.fetchImpl(`${this.host}/api/version`, {
        headers: this.headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return undefined
      const payload = (await res.json()) as { version?: unknown }
      return typeof payload.version === "string" ? payload.version : undefined
    } catch {
      return undefined
    }
  }

  /** List installed models with their capabilities (merged /api/tags + /api/show). */
  async listModels(timeoutMs = 5_000): Promise<OllamaModelInfo[]> {
    const res = await this.fetchImpl(`${this.host}/api/tags`, {
      headers: this.headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new OllamaError(`Failed to list models (${res.status})`, res.status)
    const payload = (await res.json()) as {
      models?: Array<{ name?: unknown; model?: unknown; size?: unknown; details?: { family?: unknown } }>
    }
    const names = (payload.models ?? [])
      .map((m) => ({
        name: typeof m.name === "string" ? m.name : typeof m.model === "string" ? m.model : undefined,
        sizeBytes: typeof m.size === "number" ? m.size : undefined,
        family: typeof m.details?.family === "string" ? m.details.family : undefined,
      }))
      .filter(
        (m): m is { name: string; sizeBytes: number | undefined; family: string | undefined } =>
          typeof m.name === "string",
      )

    return Promise.all(
      names.map(async (entry) => {
        const details = await this.show(entry.name, timeoutMs).catch(() => undefined)
        return {
          name: entry.name,
          sizeBytes: entry.sizeBytes,
          family: entry.family,
          parameterSize: details?.parameterSize,
          quantization: details?.quantization,
          capabilities: details?.capabilities ?? {
            tools: false,
            completion: true,
            vision: false,
            thinking: false,
            embedding: false,
          },
        }
      }),
    )
  }

  /** Fetch capabilities + metadata for one model via /api/show. */
  async show(
    model: string,
    timeoutMs = 5_000,
  ): Promise<{ capabilities: OllamaModelCapabilities; parameterSize?: string; quantization?: string }> {
    const res = await this.fetchImpl(`${this.host}/api/show`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new OllamaError(`Failed to show model ${model} (${res.status})`, res.status)
    const payload = (await res.json()) as {
      capabilities?: unknown
      details?: { parameter_size?: unknown; quantization_level?: unknown }
    }
    const caps = capabilityList(payload.capabilities)
    return {
      parameterSize: typeof payload.details?.parameter_size === "string" ? payload.details.parameter_size : undefined,
      quantization:
        typeof payload.details?.quantization_level === "string" ? payload.details.quantization_level : undefined,
      capabilities: {
        // When a model reports no capability list at all, assume completion only.
        tools: caps.includes("tools"),
        completion: caps.length === 0 || caps.includes("completion"),
        vision: caps.includes("vision"),
        thinking: caps.includes("thinking"),
        embedding: caps.includes("embedding"),
      },
    }
  }

  /** Currently-loaded models and their placement (from /api/ps). */
  async ps(timeoutMs = 3_000): Promise<Array<{ name: string; sizeVramBytes: number; sizeBytes: number }>> {
    try {
      const res = await this.fetchImpl(`${this.host}/api/ps`, {
        headers: this.headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return []
      const payload = (await res.json()) as {
        models?: Array<{ name?: unknown; size?: unknown; size_vram?: unknown }>
      }
      return (payload.models ?? [])
        .map((m) => ({
          name: typeof m.name === "string" ? m.name : "",
          sizeBytes: typeof m.size === "number" ? m.size : 0,
          sizeVramBytes: typeof m.size_vram === "number" ? m.size_vram : 0,
        }))
        .filter((m) => m.name.length > 0)
    } catch {
      return []
    }
  }

  /** Non-streaming chat. Returns the single final message. */
  async chat(request: OllamaChatRequest, timeoutMs = 300_000): Promise<OllamaChatChunk> {
    const body = { ...request, stream: false }
    this.debugLog("request", body)
    const res = await this.fetchImpl(`${this.host}/api/chat`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new OllamaError(`Ollama /api/chat failed (${res.status}): ${text}`, res.status)
    }
    const payload = (await res.json()) as OllamaChatChunk
    this.debugLog("response", payload)
    return payload
  }

  /** Streaming chat. Yields NDJSON chunks as they arrive from /api/chat. */
  async *chatStream(request: OllamaChatRequest, timeoutMs = 300_000): AsyncGenerator<OllamaChatChunk> {
    const body = { ...request, stream: true }
    this.debugLog("request", body)
    const res = await this.fetchImpl(`${this.host}/api/chat`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok || !res.body) {
      const text = res.body ? await res.text().catch(() => "") : ""
      throw new OllamaError(`Ollama /api/chat stream failed (${res.status}): ${text}`, res.status)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")
        if (!line) continue
        const chunk = JSON.parse(line) as OllamaChatChunk
        this.debugLog("chunk", chunk)
        yield chunk
      }
    }
    const rest = buffer.trim()
    if (rest) yield JSON.parse(rest) as OllamaChatChunk
  }
}

/** True when a model id/tag matches one of the known-good tool-capable families. */
export function isKnownGoodToolModel(model: string): boolean {
  const base = model.toLowerCase().split(":")[0]
  return KNOWN_GOOD_TOOL_MODELS.some((good) => base === good || base.startsWith(good))
}
