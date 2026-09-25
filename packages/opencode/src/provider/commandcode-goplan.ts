import { APICallError } from "ai"
import { LoadAPIKeyError } from "@ai-sdk/provider"
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider"
import type { ModelsDev } from "@opencode-ai/core/models-dev"

export const PROVIDER_ID = "commandcode-goplan"
const GATEWAY_URL = "https://api.commandcode.ai"
const CLI_VERSION = "1.44.0"
// ponytail: mirrors the Go proxy (Jg=5): re-POST while rawFinishReason=="pause_turn".
const MAX_ATTEMPTS = 6

// ── Seed catalog (opsi A: port validModels + modelMetas dari Go) ──

type SeedModel = {
  id: string
  name: string
  context: number
  image: boolean
  reasoning: boolean
}

const SEED: SeedModel[] = [
  { id: "xiaomi/mimo-v2.5", name: "MiMo V2.5", context: 1000000, image: true, reasoning: false },
  { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5 Pro", context: 1000000, image: false, reasoning: false },
  { id: "Qwen/Qwen3.8-Max", name: "Qwen 3.8 Max", context: 1000000, image: true, reasoning: true },
  { id: "Qwen/Qwen3.8-Flash", name: "Qwen 3.8 Flash", context: 1000000, image: true, reasoning: true },
  { id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", context: 262144, image: true, reasoning: true },
  { id: "Qwen/Qwen3.7-Max", name: "Qwen 3.7 Max", context: 1000000, image: false, reasoning: true },
  { id: "Qwen/Qwen3.7-Plus", name: "Qwen 3.7 Plus", context: 1000000, image: true, reasoning: true },
  { id: "Qwen/Qwen3.7-Flash", name: "Qwen 3.7 Flash", context: 1000000, image: true, reasoning: true },
  { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview", context: 0, image: false, reasoning: true },
  { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus", context: 0, image: true, reasoning: true },
  { id: "zai-org/GLM-5.3", name: "GLM-5.3", context: 1000000, image: false, reasoning: true },
  { id: "zai-org/GLM-5.2", name: "GLM-5.2", context: 1000000, image: false, reasoning: true },
  { id: "zai-org/GLM-5.1", name: "GLM-5.1", context: 0, image: false, reasoning: false },
  { id: "zai-org/GLM-5", name: "GLM-5", context: 200000, image: false, reasoning: false },
  { id: "zai-org/GLM-5.2-Fast", name: "GLM-5.2 Fast", context: 1000000, image: false, reasoning: false },
  { id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash", context: 1048576, image: true, reasoning: true },
  { id: "moonshotai/Kimi-K3", name: "Kimi K3", context: 1000000, image: true, reasoning: true },
  { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code", context: 256000, image: true, reasoning: true },
  {
    id: "moonshotai/Kimi-K2.7-Code-Highspeed",
    name: "Kimi K2.7 Code HighSpeed",
    context: 262000,
    image: true,
    reasoning: true,
  },
  { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6", context: 256000, image: true, reasoning: false },
  { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5", context: 256000, image: true, reasoning: false },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (latest)", context: 1000000, image: false, reasoning: true },
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash (latest)",
    context: 1000000,
    image: false,
    reasoning: true,
  },
  {
    id: "deepseek/deepseek-v4-flash-fast",
    name: "DeepSeek V4 Flash Fast",
    context: 1000000,
    image: false,
    reasoning: true,
  },
  {
    id: "deepseek/deepseek-v4-flash-vision-exp",
    name: "DeepSeek V4 Flash Vision (exp)",
    context: 1000000,
    image: true,
    reasoning: true,
  },
  { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3", context: 1000000, image: true, reasoning: true },
  { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5", context: 200000, image: false, reasoning: false },
  { id: "stepfun/Step-3.7-Flash", name: "Step 3.7 Flash", context: 256000, image: true, reasoning: true },
  { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash", context: 1000000, image: true, reasoning: true },
  { id: "tencent/hy3-paid", name: "Tencent Hy3", context: 262144, image: false, reasoning: true },
  { id: "tencent/hy4-preview", name: "Tencent Hy4 Preview", context: 1048576, image: false, reasoning: true },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", context: 1050000, image: true, reasoning: true },
  { id: "xai/grok-4.5", name: "Grok 4.5", context: 500000, image: true, reasoning: true },
  { id: "thinkingmachines/inkling", name: "Inkling", context: 256000, image: true, reasoning: true },
  { id: "thinkingmachines/inkling-small", name: "Inkling Small", context: 1000000, image: true, reasoning: true },
  {
    id: "meta/muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    context: 1048576,
    image: true,
    reasoning: true,
  },
]

export function catalog(): ModelsDev.Provider {
  const models: Record<string, ModelsDev.Model> = {}
  for (const item of SEED) {
    models[item.id] = {
      id: item.id,
      name: item.name,
      release_date: "",
      attachment: false,
      reasoning: item.reasoning,
      temperature: true,
      tool_call: true,
      limit: { context: item.context, output: 8192 },
      modalities: { input: item.image ? ["text", "image"] : ["text"], output: ["text"] },
    }
  }
  return {
    id: PROVIDER_ID,
    name: "CommandCode GoPlan",
    env: ["COMMANDCODE_API_KEY"],
    api: GATEWAY_URL,
    npm: PROVIDER_ID,
    models,
  }
}

// ── Wire mapping (port cmd/server Go: wire.go + handler_chat.go) ──

export type WireToolCall = {
  id: string
  name: string
  args: string
}

export type WireMessage = {
  role: string
  text: string
  toolCalls: Array<{ id: string; name: string; args: string }>
  toolCallID: string
}

function safeJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// toolOutputText renders every tool-result output variant as text. The
// previous build sent "" for json outputs, so the gateway saw empty tool
// results and the model retried the same call forever.
export function toolOutputText(output: LanguageModelV3ToolResultPart["output"]): string {
  if (output.type === "text" || output.type === "error-text") return output.value
  if (output.type === "json" || output.type === "error-json") {
    return typeof output.value === "string" ? output.value : JSON.stringify(output.value)
  }
  if (output.type === "execution-denied") return output.reason ?? "Tool execution was denied."
  return output.value
    .map((part) => {
      if (part.type === "text") return part.text
      return `[${part.type} omitted]`
    })
    .join("\n")
}

export function toWireMessages(prompt: LanguageModelV3Prompt): {
  system: string
  messages: WireMessage[]
  warnings: SharedV3Warning[]
} {
  const systems: string[] = []
  const messages: WireMessage[] = []
  const warnings: SharedV3Warning[] = []
  for (const message of prompt) {
    if (message.role === "system") {
      systems.push(message.content)
      continue
    }
    if (message.role === "user") {
      const texts: string[] = []
      for (const part of message.content) {
        if (part.type === "text") texts.push(part.text)
        else
          warnings.push({ type: "unsupported", feature: "file-input", details: "CommandCode gateway takes text only" })
      }
      messages.push({ role: "user", text: texts.join(""), toolCalls: [], toolCallID: "" })
      continue
    }
    if (message.role === "assistant") {
      let text = ""
      const toolCalls: WireMessage["toolCalls"] = []
      const pending: WireMessage[] = []
      for (const part of message.content) {
        if (part.type === "text") text += part.text
        else if (part.type === "tool-call") {
          const input = typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {})
          toolCalls.push({ id: part.toolCallId, name: part.toolName, args: input })
        } else if (part.type === "tool-result") {
          // Tool results belong after their assistant message, never before it.
          pending.push({ role: "tool", text: toolOutputText(part.output), toolCalls: [], toolCallID: part.toolCallId })
        } else
          warnings.push({ type: "unsupported", feature: "reasoning-input", details: "Reasoning parts are not resent" })
      }
      messages.push({ role: "assistant", text, toolCalls, toolCallID: "" }, ...pending)
      continue
    }
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      messages.push({ role: "tool", text: toolOutputText(part.output), toolCalls: [], toolCallID: part.toolCallId })
    }
  }
  return { system: systems.join("\n"), messages, warnings }
}

export function toWireTools(
  tools: LanguageModelV3CallOptions["tools"],
  toolChoice: LanguageModelV3CallOptions["toolChoice"],
): { tools: Array<Record<string, unknown>>; warnings: SharedV3Warning[] } {
  const warnings: SharedV3Warning[] = []
  if (toolChoice?.type === "none") return { tools: [], warnings }
  if (toolChoice && toolChoice.type !== "auto")
    warnings.push({ type: "unsupported", feature: "tool-choice", details: "Only auto/none are honored" })
  const out: Array<Record<string, unknown>> = []
  for (const tool of tools ?? []) {
    if (tool.type !== "function") {
      warnings.push({ type: "unsupported", feature: "provider-tool", details: "Only function tools are sent" })
      continue
    }
    if (!tool.name) continue
    out.push({ name: tool.name, description: tool.description ?? "", input_schema: tool.inputSchema })
  }
  return { tools: out, warnings }
}

export function buildWireBody(input: {
  model: string
  system: string
  messages: WireMessage[]
  tools: Array<Record<string, unknown>>
  maxTokens: number
  temperature?: number
  reasoningEffort?: unknown
}): string {
  const nameByID = new Map<string, string>()
  const wire: Array<Record<string, unknown>> = []
  for (const message of input.messages) {
    if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = []
      if (message.text) content.push({ type: "text", text: message.text })
      for (const call of message.toolCalls) {
        nameByID.set(call.id, call.name)
        content.push({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: safeJSON(call.args) ?? {} })
      }
      wire.push({ role: "assistant", content })
      continue
    }
    if (message.role === "tool") {
      wire.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallID,
            toolName: nameByID.get(message.toolCallID) ?? "unknown",
            output: { type: "text", value: message.text },
          },
        ],
      })
      continue
    }
    wire.push({ role: "user", content: [{ type: "text", text: message.text }] })
  }
  const params: Record<string, unknown> = {
    model: input.model,
    messages: wire,
    tools: input.tools,
    max_tokens: input.maxTokens,
    stream: true,
  }
  if (input.system) params["system"] = input.system
  if (input.temperature !== undefined) params["temperature"] = input.temperature
  if (input.reasoningEffort !== undefined) params["reasoning_effort"] = input.reasoningEffort
  return JSON.stringify({
    config: {
      workingDir: "/tmp",
      date: new Date().toISOString().slice(0, 10),
      environment: "linux",
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    memory: null,
    taste: null,
    skills: null,
    permissionMode: "standard",
    mode: "agent",
    params,
  })
}

// ── Gateway NDJSON events (port upstream.go) ──

export type WireEvent = {
  type: string
  text?: string
  rawFinishReason?: string
  toolName?: string
  toolCallId?: string
  input?: unknown
  totalUsage?: {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    inputTokenDetails?: { cacheReadTokens?: number }
    outputTokenDetails?: { reasoningTokens?: number }
  }
  providerMetadata?: Record<string, unknown>
  message?: string
}

export function parseWireLine(line: string): WireEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  const parsed = safeJSON(trimmed) as WireEvent | undefined
  if (!parsed || typeof parsed.type !== "string") return undefined
  return parsed
}

export type Collected = {
  text: string
  prompt: number
  completion: number
  cached: number
  reasoning: number
  raw: string
  fingerprint: string
  calls: WireToolCall[]
  error: string
}

function fingerprintOf(meta: Record<string, unknown> | undefined): string {
  const gateway = meta?.["gateway"] as Record<string, unknown> | undefined
  if (!gateway) return ""
  const gen = gateway["generationId"]
  const routing = gateway["routing"] as Record<string, unknown> | undefined
  const prov = gateway["resolvedProvider"] ?? routing?.["resolvedProvider"]
  if (typeof prov === "string" && typeof gen === "string") return `${prov}:${gen}`
  if (typeof gen === "string") return gen
  if (typeof prov === "string") return prov
  return ""
}

function inputArgs(input: unknown): string {
  if (input === undefined || input === null) return "{}"
  if (typeof input === "string") return input === "" ? "{}" : input
  return JSON.stringify(input)
}

export function collectWire(body: string): Collected {
  const result: Collected = {
    text: "",
    prompt: 0,
    completion: 0,
    cached: 0,
    reasoning: 0,
    raw: "",
    fingerprint: "",
    calls: [],
    error: "",
  }
  let seq = 0
  for (const line of body.split("\n")) {
    const event = parseWireLine(line)
    if (!event) continue
    if (event.type === "text-delta" && event.text) result.text += event.text
    else if (event.type === "tool-call") {
      seq++
      result.calls.push({
        id: event.toolCallId || `call_${seq}`,
        name: event.toolName || "unknown",
        args: inputArgs(event.input),
      })
    } else if (event.type === "finish") {
      result.raw = event.rawFinishReason ?? ""
      result.prompt = event.totalUsage?.inputTokens ?? 0
      result.completion = event.totalUsage?.outputTokens ?? 0
      result.reasoning = event.totalUsage?.reasoningTokens ?? event.totalUsage?.outputTokenDetails?.reasoningTokens ?? 0
      result.cached = event.totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0
    } else if (event.type === "provider-metadata") {
      const fp = fingerprintOf(event.providerMetadata)
      if (fp) result.fingerprint = fp
    } else if (event.type === "error") {
      result.error = event.message || line.trim()
      return result
    }
  }
  return result
}

const XML_CALL = /<tool_call>\s*<function=([^>]+)>(.*?)<\/function>\s*<\/tool_call>/gs
const XML_PARAM = /<parameter=([^>]+)>(.*?)<\/parameter>/gs

export function extractXMLToolCalls(text: string): { clean: string; calls: WireToolCall[] } {
  const calls: WireToolCall[] = []
  const clean = text
    .replace(XML_CALL, (_block, name: string, inner: string) => {
      const trimmed = String(name ?? "").trim()
      if (!trimmed) return _block
      const args: Record<string, string> = {}
      for (const param of String(inner).matchAll(XML_PARAM)) args[param[1].trim()] = param[2].trim()
      calls.push({ id: `call_${calls.length + 1}`, name: trimmed, args: JSON.stringify(args) })
      return ""
    })
    .trim()
  return { clean, calls }
}

const OVERFLOW =
  /prompt is too long|context.{0,20}(length|window)|maximum.{0,20}tokens|too many tokens|exceeds.*context/i

export function isOverflow(status: number, body: string): boolean {
  if (status === 413) return true
  return OVERFLOW.test(body)
}

export function mapFinish(numCalls: number, raw: string): "stop" | "length" | "tool-calls" {
  if (numCalls > 0) return "tool-calls"
  if (raw === "length" || raw === "max_tokens") return "length"
  return "stop"
}

function toFinishReason(unified: "stop" | "length" | "tool-calls", raw: string): LanguageModelV3FinishReason {
  return { unified, raw: raw || undefined }
}

function toUsage(collected: Pick<Collected, "prompt" | "completion" | "cached" | "reasoning">): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: collected.prompt || undefined,
      noCache: collected.prompt - collected.cached || undefined,
      cacheRead: collected.cached || undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: collected.completion || undefined,
      text: collected.completion - collected.reasoning || undefined,
      reasoning: collected.reasoning || undefined,
    },
  }
}

// ── LanguageModelV3 ──

export type ModelConfig = {
  apiKey: string
  baseURL: string
  headers?: Record<string, string | undefined>
  fetch?: typeof fetch
}

function cleanHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

export class CommandcodeLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly supportedUrls = {}

  constructor(
    readonly modelId: string,
    private config: ModelConfig,
  ) {}

  get provider(): string {
    return PROVIDER_ID
  }

  private requestHeaders(callHeaders?: Record<string, string | undefined>): Record<string, string> {
    return {
      ...cleanHeaders(this.config.headers ?? {}),
      ...cleanHeaders(callHeaders ?? {}),
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "User-Agent": "cli",
      "x-command-code-version": CLI_VERSION,
    }
  }

  private fail(url: string, body: string, status: number, responseHeaders: Record<string, string>): never {
    if (isOverflow(status, body)) {
      throw new APICallError({
        message: "This model's maximum context length was exceeded. Compact the conversation and retry.",
        url,
        requestBodyValues: {},
        statusCode: status,
        responseHeaders,
        responseBody: JSON.stringify({
          error: {
            message: "prompt is too long for context window",
            type: "invalid_request_error",
            code: "context_length_exceeded",
          },
        }),
        isRetryable: false,
      })
    }
    throw new APICallError({
      message: `CommandCode gateway ${status}: ${body.slice(0, 500)}`,
      url,
      requestBodyValues: {},
      statusCode: status,
      responseHeaders,
      responseBody: body,
      isRetryable: status === 429 || status >= 500,
    })
  }

  private prepare(options: LanguageModelV3CallOptions): { body: string; warnings: SharedV3Warning[] } {
    if (!this.config.apiKey)
      throw new LoadAPIKeyError({
        message: "CommandCode API key is missing. Run `opencode auth login` and choose commandcode-goplan.",
      })
    const wired = toWireMessages(options.prompt)
    const tools = toWireTools(options.tools, options.toolChoice)
    const warnings = [...wired.warnings, ...tools.warnings]
    for (const feature of ["topP", "topK", "stopSequences", "seed", "frequencyPenalty", "presencePenalty"] as const) {
      if (options[feature] !== undefined && options[feature] !== null)
        warnings.push({ type: "unsupported", feature, details: "The CommandCode gateway ignores this setting" })
    }
    if (options.responseFormat?.type === "json")
      warnings.push({
        type: "unsupported",
        feature: "responseFormat",
        details: "The CommandCode gateway ignores response_format",
      })
    const providerOptions = options.providerOptions?.[PROVIDER_ID] as { reasoningEffort?: unknown } | undefined
    return {
      body: buildWireBody({
        model: this.modelId,
        system: wired.system,
        messages: wired.messages.map((message) => ({
          role: message.role,
          text: message.text,
          toolCalls: message.toolCalls,
          toolCallID: message.toolCallID,
        })),
        tools: tools.tools,
        maxTokens: options.maxOutputTokens && options.maxOutputTokens > 0 ? options.maxOutputTokens : 1024,
        temperature: options.temperature,
        reasoningEffort: providerOptions?.reasoningEffort,
      }),
      warnings,
    }
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const { body, warnings } = this.prepare(options)
    const url = `${this.config.baseURL}/alpha/generate`
    const doFetch = this.config.fetch ?? fetch
    let text = ""
    let prompt = 0
    let completion = 0
    let cached = 0
    let reasoning = 0
    let raw = ""
    let fingerprint = ""
    let calls: WireToolCall[] = []
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await doFetch(url, {
        method: "POST",
        headers: this.requestHeaders(options.headers),
        body,
        signal: options.abortSignal,
      })
      if (!response.ok) {
        const responseBody = await response.text().catch(() => "")
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => (headers[key] = value))
        this.fail(url, responseBody, response.status, headers)
      }
      const collected = collectWire(await response.text())
      text += collected.text
      prompt += collected.prompt
      completion += collected.completion
      cached += collected.cached
      reasoning += collected.reasoning
      calls = [...calls, ...collected.calls]
      raw = collected.raw
      if (collected.fingerprint) fingerprint = collected.fingerprint
      if (collected.error) {
        throw new APICallError({
          message: collected.error.slice(0, 500),
          url,
          requestBodyValues: {},
          responseBody: collected.error,
          isRetryable: true,
        })
      }
      if (collected.raw !== "pause_turn") break
    }
    if (calls.length === 0) {
      const recovered = extractXMLToolCalls(text)
      if (recovered.calls.length > 0) {
        text = recovered.clean
        calls = recovered.calls
      }
    }
    const unified = mapFinish(calls.length, raw)
    const content: LanguageModelV3Content[] = []
    if (text) content.push({ type: "text", text })
    for (const call of calls)
      // ponytail: V3 generate content uses the stringified args; ai-sdk parses
      // them into the tool call itself (see parseToolCall in ai/dist).
      content.push({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.args })
    return {
      content,
      finishReason: toFinishReason(unified, raw),
      usage: toUsage({ prompt, completion, cached, reasoning }),
      providerMetadata: fingerprint ? { [PROVIDER_ID]: { routing: fingerprint } } : undefined,
      response: { modelId: this.modelId },
      warnings,
    }
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const { body, warnings } = this.prepare(options)
    const url = `${this.config.baseURL}/alpha/generate`
    const config = this.config
    const headers = this.requestHeaders(options.headers)
    const modelId = this.modelId
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        const textId = "text-0"
        controller.enqueue({ type: "stream-start", warnings })
        controller.enqueue({ type: "response-metadata", modelId })
        controller.enqueue({ type: "text-start", id: textId })
        let prompt = 0
        let completion = 0
        let cached = 0
        let reasoning = 0
        let raw = ""
        let calls: WireToolCall[] = []
        const doFetch = config.fetch ?? fetch
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const response = await doFetch(url, { method: "POST", headers, body, signal: options.abortSignal })
          if (!response.ok || !response.body) {
            const responseBody = await response.text().catch(() => "")
            const responseHeaders: Record<string, string> = {}
            response.headers.forEach((value, key) => (responseHeaders[key] = value))
            if (isOverflow(response.status, responseBody)) {
              controller.error(
                new APICallError({
                  message: "This model's maximum context length was exceeded. Compact the conversation and retry.",
                  url,
                  requestBodyValues: {},
                  statusCode: response.status,
                  responseHeaders,
                  responseBody: JSON.stringify({
                    error: {
                      message: "prompt is too long",
                      type: "invalid_request_error",
                      code: "context_length_exceeded",
                    },
                  }),
                  isRetryable: false,
                }),
              )
              return
            }
            controller.error(
              new APICallError({
                message: `CommandCode gateway ${response.status}: ${responseBody.slice(0, 500)}`,
                url,
                requestBodyValues: {},
                statusCode: response.status,
                responseHeaders,
                responseBody,
                isRetryable: response.status === 429 || response.status >= 500,
              }),
            )
            return
          }
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          let seq = calls.length
          let attemptRaw = ""
          let failed = false
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
              const event = parseWireLine(line)
              if (!event) continue
              if (event.type === "text-delta" && event.text)
                controller.enqueue({ type: "text-delta", id: textId, delta: event.text })
              else if (event.type === "tool-call") {
                seq++
                calls.push({
                  id: event.toolCallId || `call_${seq}`,
                  name: event.toolName || "unknown",
                  args: inputArgs(event.input),
                })
              } else if (event.type === "finish") {
                attemptRaw = event.rawFinishReason ?? ""
                prompt += event.totalUsage?.inputTokens ?? 0
                completion += event.totalUsage?.outputTokens ?? 0
                cached += event.totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0
                reasoning +=
                  event.totalUsage?.reasoningTokens ?? event.totalUsage?.outputTokenDetails?.reasoningTokens ?? 0
              } else if (event.type === "error") {
                failed = true
                controller.error(
                  new APICallError({
                    message: (event.message || line.trim()).slice(0, 500),
                    url,
                    requestBodyValues: {},
                    responseBody: event.message || line.trim(),
                    isRetryable: true,
                  }),
                )
              }
              if (failed) break
            }
            if (failed) break
          }
          if (failed) return
          raw = attemptRaw
          if (attemptRaw !== "pause_turn") break
        }
        controller.enqueue({ type: "text-end", id: textId })
        for (const call of calls) {
          controller.enqueue({ type: "tool-input-start", id: call.id, toolName: call.name })
          controller.enqueue({ type: "tool-input-delta", id: call.id, delta: call.args })
          controller.enqueue({ type: "tool-input-end", id: call.id })
          // ponytail: ai-sdk only executes on tool-call; input-* alone leaves
          // the call pending and the session re-asks forever. V3 stream parts
          // take the stringified args here (unlike content parts above).
          controller.enqueue({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.args })
        }
        controller.enqueue({
          type: "finish",
          finishReason: toFinishReason(mapFinish(calls.length, raw), raw),
          usage: toUsage({ prompt, completion, cached, reasoning }),
        })
        controller.close()
      },
    })
    return { stream }
  }
}

export function createCommandcodeGoplan(
  input: { apiKey?: string; baseURL?: string; headers?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
) {
  const apiKey = input.apiKey ?? process.env["COMMANDCODE_API_KEY"] ?? ""
  const baseURL = (input.baseURL || GATEWAY_URL).replace(/\/$/, "")
  const create = (modelId: string) =>
    new CommandcodeLanguageModel(modelId, { apiKey, baseURL, headers: input.headers, fetch: input.fetch })
  const provider = (modelId: string) => create(modelId)
  provider.languageModel = create
  provider.chat = create
  return provider
}
