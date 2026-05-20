import type { JsonSchema, LLMRequest, ProviderMetadata } from "@opencode-ai/llm"
import { LLM, Message, SystemPart, ToolCallPart, ToolDefinition, ToolResultPart } from "@opencode-ai/llm"
import "@opencode-ai/llm/providers"
import type { ModelMessage } from "ai"
import type { Provider } from "@/provider/provider"
import { isRecord } from "@/util/record"

type ToolInput = {
  readonly description?: string
  readonly inputSchema?: unknown
}

export type RequestInput = {
  readonly model: Provider.Model
  readonly apiKey?: string
  readonly baseURL?: string
  readonly system?: readonly string[]
  readonly messages: readonly ModelMessage[]
  readonly tools?: Record<string, ToolInput>
  readonly toolChoice?: "auto" | "required" | "none"
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly providerOptions?: LLMRequest["providerOptions"]
  readonly headers?: Record<string, string>
}

const DEFAULT_BASE_URL: Record<string, string> = {
  "@ai-sdk/openai": "https://api.openai.com/v1",
  "@ai-sdk/anthropic": "https://api.anthropic.com/v1",
  "@ai-sdk/google": "https://generativelanguage.googleapis.com/v1beta",
  "@ai-sdk/amazon-bedrock": "https://bedrock-runtime.us-east-1.amazonaws.com",
  "@openrouter/ai-sdk-provider": "https://openrouter.ai/api/v1",
}

const ROUTE: Record<string, string> = {
  "@ai-sdk/openai": "openai-responses",
  "@ai-sdk/azure": "azure-openai-responses",
  "@ai-sdk/anthropic": "anthropic-messages",
  "@ai-sdk/google": "gemini",
  "@ai-sdk/amazon-bedrock": "bedrock-converse",
  "@ai-sdk/openai-compatible": "openai-compatible-chat",
  "@openrouter/ai-sdk-provider": "openrouter",
}

const providerMetadata = (value: unknown): ProviderMetadata | undefined => {
  if (!isRecord(value)) return undefined
  const result = Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])),
  )
  return Object.keys(result).length === 0 ? undefined : result
}

const textPart = (part: Record<string, unknown>) => ({
  type: "text" as const,
  text: typeof part.text === "string" ? part.text : "",
  providerMetadata: providerMetadata(part.providerOptions),
})

const mediaPart = (part: Record<string, unknown>) => {
  if (typeof part.data !== "string" && !(part.data instanceof Uint8Array))
    throw new Error("Native LLM request adapter only supports file parts with string or Uint8Array data")
  return {
    type: "media" as const,
    mediaType: typeof part.mediaType === "string" ? part.mediaType : "application/octet-stream",
    data: part.data,
    filename: typeof part.filename === "string" ? part.filename : undefined,
  }
}

const toolResult = (part: Record<string, unknown>) => {
  const output = isRecord(part.output) ? part.output : { type: "json", value: part.output }
  const type = output.type === "text" ? "text" : output.type === "error-text" ? "error" : "json"
  return ToolResultPart.make({
    id: typeof part.toolCallId === "string" ? part.toolCallId : "",
    name: typeof part.toolName === "string" ? part.toolName : "",
    result: "value" in output ? output.value : output,
    resultType: type,
    providerExecuted: typeof part.providerExecuted === "boolean" ? part.providerExecuted : undefined,
    providerMetadata: providerMetadata(part.providerOptions),
  })
}

const contentPart = (part: unknown) => {
  if (!isRecord(part)) throw new Error("Native LLM request adapter only supports object content parts")
  if (part.type === "text") return textPart(part)
  if (part.type === "file") return mediaPart(part)
  if (part.type === "reasoning")
    return {
      type: "reasoning" as const,
      text: typeof part.text === "string" ? part.text : "",
      providerMetadata: providerMetadata(part.providerOptions),
    }
  if (part.type === "tool-call")
    return ToolCallPart.make({
      id: typeof part.toolCallId === "string" ? part.toolCallId : "",
      name: typeof part.toolName === "string" ? part.toolName : "",
      input: part.input,
      providerExecuted: typeof part.providerExecuted === "boolean" ? part.providerExecuted : undefined,
      providerMetadata: providerMetadata(part.providerOptions),
    })
  if (part.type === "tool-result") return toolResult(part)
  throw new Error(`Native LLM request adapter does not support ${String(part.type)} content parts`)
}

const content = (value: ModelMessage["content"]) =>
  typeof value === "string" ? [{ type: "text" as const, text: value }] : value.map(contentPart)

const messages = (input: readonly ModelMessage[]) => {
  const system = input.flatMap((message) => (message.role === "system" ? [SystemPart.make(message.content)] : []))
  const messages = input.flatMap((message) => {
    if (message.role === "system") return []
    return [
      Message.make({
        role: message.role,
        content: content(message.content),
        native: isRecord(message.providerOptions) ? { providerOptions: message.providerOptions } : undefined,
      }),
    ]
  })
  return { system, messages }
}

const schema = (value: unknown): JsonSchema => {
  if (!isRecord(value)) return { type: "object", properties: {} }
  if (isRecord(value.jsonSchema)) return value.jsonSchema
  return value
}

const tools = (input: Record<string, ToolInput> | undefined): ToolDefinition[] =>
  Object.entries(input ?? {}).map(([name, item]) =>
    ToolDefinition.make({
      name,
      description: item.description ?? "",
      inputSchema: schema(item.inputSchema),
    }),
  )

const generation = (input: RequestInput) => {
  const result = {
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
    maxTokens: input.maxOutputTokens,
  }
  return Object.values(result).some((value) => value !== undefined) ? result : undefined
}

const baseURL = (model: Provider.Model) => {
  if (model.api.url) return model.api.url
  const fallback = DEFAULT_BASE_URL[model.api.npm]
  if (fallback) return fallback
  throw new Error(`Native LLM request adapter requires a base URL for ${model.providerID}/${model.id}`)
}

export const model = (input: Provider.Model | RequestInput, headers?: Record<string, string>) => {
  const model = "model" in input ? input.model : input
  const route = ROUTE[model.api.npm]
  if (!route) throw new Error(`Native LLM request adapter does not support provider package ${model.api.npm}`)
  return LLM.model({
    id: model.api.id,
    provider: model.providerID,
    route,
    baseURL: "model" in input && input.baseURL ? input.baseURL : baseURL(model),
    apiKey: "model" in input ? input.apiKey : undefined,
    headers: Object.keys({ ...model.headers, ...headers }).length === 0 ? undefined : { ...model.headers, ...headers },
    limits: {
      context: model.limit.context,
      output: model.limit.output,
    },
  })
}

export const request = (input: RequestInput) => {
  const converted = messages(input.messages)
  return LLM.request({
    model: model(input, input.headers),
    system: [...(input.system ?? []).map(SystemPart.make), ...converted.system],
    messages: converted.messages,
    tools: tools(input.tools),
    toolChoice: input.toolChoice,
    generation: generation(input),
    providerOptions: input.providerOptions,
  })
}

export * as LLMNative from "./native-request"
