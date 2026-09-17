export * as ConfigProviderOptionsV1 from "./provider-options"

type Options = Readonly<Record<string, unknown>>

export interface ProviderResult {
  readonly headers?: Record<string, string>
  readonly body?: Record<string, unknown>
  readonly url?: string
  readonly settings?: Record<string, unknown>
}

export interface Lowerer {
  readonly provider: (options: Options) => ProviderResult
  readonly request: (options: Options) => Record<string, unknown>
}

export function get(packageName?: string): Lowerer {
  const key = packageName ?? ""
  return Object.hasOwn(lowerers, key) ? lowerers[key]! : raw
}

const raw: Lowerer = {
  provider(options) {
    return { body: clone(options) }
  },
  request: clone,
}

const openai: Lowerer = {
  provider(options) {
    return {
      url: string(options.baseURL),
      headers: compact({
        Authorization: bearer(options.apiKey),
        "OpenAI-Organization": string(options.organization),
        "OpenAI-Project": string(options.project),
        ...headers(options.headers),
      }),
      body: body(options.body),
      settings: omit(options, ["apiKey", "baseURL", "organization", "project", "headers", "body"]),
    }
  },
  request(options) {
    const result = snake(options)
    if (options.reasoningEffort !== undefined || options.reasoningSummary !== undefined) {
      result.reasoning = {
        ...(isRecord(result.reasoning) ? result.reasoning : {}),
        ...(options.reasoningEffort !== undefined ? { effort: options.reasoningEffort } : {}),
        ...(options.reasoningSummary !== undefined ? { summary: options.reasoningSummary } : {}),
      }
      delete result.reasoning_effort
      delete result.reasoning_summary
    }
    if (options.textVerbosity !== undefined) {
      result.text = { ...(isRecord(result.text) ? result.text : {}), verbosity: options.textVerbosity }
      delete result.text_verbosity
    }
    return result
  },
}

const anthropic: Lowerer = {
  provider(options) {
    return {
      url: string(options.baseURL),
      headers: compact({
        "x-api-key": string(options.apiKey),
        Authorization: options.authToken ? bearer(options.authToken) : undefined,
        ...headers(options.headers),
      }),
      body: body(options.body),
      settings: omit(options, ["apiKey", "authToken", "baseURL", "headers", "body"]),
    }
  },
  request(options) {
    const result = snake(options)
    if (options.effort !== undefined || options.taskBudget !== undefined) {
      result.output_config = compactUnknown({ effort: options.effort, task_budget: options.taskBudget })
      delete result.effort
      delete result.task_budget
    }
    if (isRecord(options.metadata) && options.metadata.userId !== undefined) {
      result.metadata = { ...(isRecord(result.metadata) ? result.metadata : {}), user_id: options.metadata.userId }
    }
    return result
  },
}

const google: Lowerer = {
  provider(options) {
    return {
      url: string(options.baseURL),
      headers: compact({ "x-goog-api-key": string(options.apiKey), ...headers(options.headers) }),
      body: body(options.body),
      settings: omit(options, ["apiKey", "baseURL", "headers", "body"]),
    }
  },
  request(options) {
    const generationConfig = pick(options, ["thinkingConfig", "responseModalities", "mediaResolution", "imageConfig"])
    return {
      ...omit(options, ["thinkingConfig", "responseModalities", "mediaResolution", "imageConfig"]),
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    }
  },
}

const azure: Lowerer = {
  provider(options) {
    return {
      url: string(options.baseURL),
      headers: compact({ "api-key": string(options.apiKey), ...headers(options.headers) }),
      body: body(options.body),
      settings: omit(options, ["apiKey", "baseURL", "headers", "body"]),
    }
  },
  request: openai.request,
}

const bedrock: Lowerer = {
  provider(options) {
    return direct(options)
  },
  request(options) {
    return { additionalModelRequestFields: clone(options) }
  },
}

const openaiCompatible: Lowerer = {
  provider(options) {
    return { ...direct(options, ["baseURL"]), url: string(options.baseURL) }
  },
  request(options) {
    const result = clone(options)
    if (options.reasoningEffort !== undefined) {
      result.reasoning_effort = options.reasoningEffort
      delete result.reasoningEffort
    }
    return result
  },
}

const lowerers: Readonly<Record<string, Lowerer>> = {
  "@ai-sdk/openai": openai,
  "@ai-sdk/anthropic": anthropic,
  "@ai-sdk/google-vertex/anthropic": anthropic,
  "@ai-sdk/google": google,
  "@ai-sdk/google-vertex": google,
  "@ai-sdk/azure": azure,
  "@ai-sdk/amazon-bedrock": bedrock,
  "@ai-sdk/openai-compatible": openaiCompatible,
  "@ai-sdk/cerebras": openaiCompatible,
  "@ai-sdk/deepinfra": openaiCompatible,
  "@ai-sdk/groq": openaiCompatible,
  "@ai-sdk/mistral": openaiCompatible,
  "@ai-sdk/togetherai": openaiCompatible,
  "@ai-sdk/xai": openaiCompatible,
  "@openrouter/ai-sdk-provider": openaiCompatible,
  "ai-gateway-provider": openaiCompatible,
  "venice-ai-sdk-provider": openaiCompatible,
}

function direct(options: Options, extraKeys: ReadonlyArray<string> = []): ProviderResult {
  return {
    headers: headers(options.headers),
    body: body(options.body),
    settings: omit(options, ["headers", "body", ...extraKeys]),
  }
}

function body(input: unknown) {
  if (!isRecord(input)) return undefined
  return { ...input }
}

function snake(options: Options) {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => [snakeKey(key), snakeValue(value)]))
}

function snakeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, value]) => [snakeKey(key), snakeValue(value)]))
}

function snakeKey(key: string) {
  return key.replace(/[A-Z]/g, (match) => "_" + match.toLowerCase())
}

function clone(options: Options) {
  return { ...options }
}

function omit(options: Options, keys: ReadonlyArray<string>) {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !keys.includes(key)))
}

function pick(options: Options, keys: ReadonlyArray<string>) {
  return Object.fromEntries(Object.entries(options).filter(([key]) => keys.includes(key)))
}

function headers(input: unknown) {
  if (!isRecord(input)) return undefined
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function compact(input: Record<string, string | undefined>) {
  const entries = Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function compactUnknown(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter((entry) => entry[1] !== undefined))
}

function string(input: unknown) {
  return typeof input === "string" && input ? input : undefined
}

function bearer(input: unknown) {
  return typeof input === "string" && input ? `Bearer ${input}` : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
