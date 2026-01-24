import { ZenData } from "@opencode-ai/console-core/model.js"
import {
  fromAnthropicChunk,
  fromAnthropicRequest,
  fromAnthropicResponse,
  toAnthropicChunk,
  toAnthropicRequest,
  toAnthropicResponse,
} from "./anthropic"
import {
  fromOpenaiChunk,
  fromOpenaiRequest,
  fromOpenaiResponse,
  toOpenaiChunk,
  toOpenaiRequest,
  toOpenaiResponse,
} from "./openai"
import {
  fromOaCompatibleChunk,
  fromOaCompatibleRequest,
  fromOaCompatibleResponse,
  toOaCompatibleChunk,
  toOaCompatibleRequest,
  toOaCompatibleResponse,
  createKimiAwareChunkParser,
} from "./openai-compatible"

export type UsageInfo = {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWrite5mTokens?: number
  cacheWrite1hTokens?: number
}

export type ProviderHelper = (input: { reqModel: string; providerModel: string }) => {
  format: ZenData.Format
  modifyUrl: (providerApi: string, isStream?: boolean) => string
  modifyHeaders: (headers: Headers, body: Record<string, any>, apiKey: string) => void
  modifyBody: (body: Record<string, any>) => Record<string, any>
  createBinaryStreamDecoder: () => ((chunk: Uint8Array) => Uint8Array | undefined) | undefined
  streamSeparator: string
  createUsageParser: () => {
    parse: (chunk: string) => void
    retrieve: () => any
  }
  normalizeUsage: (usage: any) => UsageInfo
}

export interface CommonMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | Array<CommonContentPart>
  tool_call_id?: string
  tool_calls?: CommonToolCall[]
}

export interface CommonContentPart {
  type: "text" | "image_url"
  text?: string
  image_url?: { url: string }
}

export interface CommonToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface CommonTool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: Record<string, any>
  }
}

export interface CommonUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  input_tokens_details?: {
    cached_tokens?: number
  }
  output_tokens_details?: {
    reasoning_tokens?: number
  }
}

export interface CommonRequest {
  model: string
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string | string[]
  messages: CommonMessage[]
  stream?: boolean
  tools?: CommonTool[]
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } }
}

export interface CommonResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: "assistant"
      content?: string
      tool_calls?: CommonToolCall[]
    }
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

export interface CommonChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: "assistant"
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: "function"
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

export function createBodyConverter(from: ZenData.Format, to: ZenData.Format) {
  return (body: any): any => {
    if (from === to) return body

    let raw: CommonRequest
    if (from === "anthropic") raw = fromAnthropicRequest(body)
    else if (from === "openai") raw = fromOpenaiRequest(body)
    else raw = fromOaCompatibleRequest(body)

    if (to === "anthropic") return toAnthropicRequest(raw)
    if (to === "openai") return toOpenaiRequest(raw)
    if (to === "oa-compat") return toOaCompatibleRequest(raw)
  }
}

export function createStreamPartConverter(from: ZenData.Format, to: ZenData.Format, toolCallFormat?: "kimi") {
  let kimiParser: ReturnType<typeof createKimiAwareChunkParser> | null =
    toolCallFormat === "kimi" ? createKimiAwareChunkParser() : null

  return (part: any): any => {
    if (from === to && !kimiParser && !part.includes?.("<|tool_call")) return part

    if (from === "oa-compat" && part.includes?.("<|tool_call")) {
      kimiParser ??= createKimiAwareChunkParser()
    }

    if (kimiParser && from === "oa-compat") {
      const chunks = kimiParser.parse(part)
      if (chunks.length === 0) return null

      const results = chunks.map((chunk) => {
        if (to === "anthropic") return toAnthropicChunk(chunk)
        if (to === "openai") return toOpenaiChunk(chunk)
        return toOaCompatibleChunk(chunk)
      })

      return results.length === 1 ? results[0] : results
    }

    let raw: CommonChunk | string
    if (from === "anthropic") raw = fromAnthropicChunk(part)
    else if (from === "openai") raw = fromOpenaiChunk(part)
    else raw = fromOaCompatibleChunk(part)

    if (typeof raw === "string") return raw

    if (to === "anthropic") return toAnthropicChunk(raw)
    if (to === "openai") return toOpenaiChunk(raw)
    if (to === "oa-compat") return toOaCompatibleChunk(raw)
  }
}

export function createResponseConverter(from: ZenData.Format, to: ZenData.Format, toolCallFormat?: "kimi") {
  return (response: any): any => {
    if (from === to && !toolCallFormat) return response

    let raw: CommonResponse
    if (from === "anthropic") raw = fromAnthropicResponse(response)
    else if (from === "openai") raw = fromOpenaiResponse(response)
    else raw = fromOaCompatibleResponse(response, toolCallFormat)

    if (to === "anthropic") return toAnthropicResponse(raw)
    if (to === "openai") return toOpenaiResponse(raw)
    if (to === "oa-compat") return toOaCompatibleResponse(raw)
  }
}
