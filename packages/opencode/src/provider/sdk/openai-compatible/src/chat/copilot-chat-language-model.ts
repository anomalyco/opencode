import {
  type LanguageModelV2,
  type LanguageModelV2CallWarning,
  type LanguageModelV2Content,
  type LanguageModelV2FinishReason,
  type LanguageModelV2StreamPart,
  type LanguageModelV2Usage,
  type SharedV2ProviderMetadata,
} from "@ai-sdk/provider"
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  type ParseResult,
  postJsonToApi,
} from "@ai-sdk/provider-utils"
import { z } from "zod/v4"
import type { CopilotChatConfig } from "./copilot-chat-config"
import { copilotChatChunkSchema, copilotChatResponseSchema, copilotChatUsageSchema } from "./copilot-chat-api-types"
import { convertToCopilotChatMessages } from "./convert-to-copilot-chat-input"
import { openaiFailedResponseHandler } from "../responses/openai-error"
import { ProviderTransform } from "@/provider/transform"

type CopilotChatChunk = z.infer<typeof copilotChatChunkSchema>
type CopilotChatTool = { type: "function"; function: { name: string; description?: string; parameters?: unknown } }
type ToolState = { id: string; name: string; args: string; started: boolean }

export class CopilotChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {
    "image/*": [/^https?:\/\/.*$/],
    "application/pdf": [/^https?:\/\/.*$/],
  }
  private readonly config: CopilotChatConfig

  constructor(modelId: string, config: CopilotChatConfig) {
    this.modelId = modelId
    this.config = config
  }

  get provider(): string {
    return this.config.provider
  }

  private async getArgs(options: Parameters<LanguageModelV2["doGenerate"]>[0]) {
    const warnings: LanguageModelV2CallWarning[] = []
    if (options.topK != null) warnings.push({ type: "unsupported-setting", setting: "topK" })

    const messages = await convertToCopilotChatMessages(options.prompt, options.providerOptions)
    const toolConfig = prepareTools({ tools: options.tools, toolChoice: options.toolChoice, modelId: this.modelId })
    warnings.push(...toolConfig.warnings)
    const format = toResponseFormat(options.responseFormat)

    const body = {
      model: this.modelId,
      messages,
      temperature: options.temperature,
      top_p: options.topP,
      max_tokens: options.maxOutputTokens,
      presence_penalty: options.presencePenalty,
      frequency_penalty: options.frequencyPenalty,
      seed: options.seed,
      ...(options.stopSequences != null && { stop: options.stopSequences }),
      ...(toolConfig.tools && { tools: toolConfig.tools }),
      ...(toolConfig.toolChoice && { tool_choice: toolConfig.toolChoice }),
      ...(format && { response_format: format }),
    }

    return { body, warnings }
  }

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const result = await this.getArgs(options)
    const body = result.body
    const warnings = result.warnings
    const url = this.config.url({ path: "/chat/completions", modelId: this.modelId })

    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(copilotChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const choice = response.choices[0]
    const message = choice?.message
    if (!message) throw new Error("Copilot chat response missing message")

    const content: Array<LanguageModelV2Content> = []
    const reasoning = pickReasoning(message)
    if (reasoning != null) {
      content.push({
        type: "reasoning",
        text: reasoning,
        providerMetadata: reasoningMetadata(message.reasoning_opaque ?? null),
      })
    }
    if (typeof message.content === "string" && message.content.length > 0) {
      content.push({ type: "text", text: message.content })
    }

    const toolCalls = message.tool_calls ?? []
    for (const call of toolCalls) {
      const toolCallId = call.id ?? generateId()
      const toolName = call.function?.name ?? ""
      const input = call.function?.arguments ?? ""
      content.push({ type: "tool-call", toolCallId, toolName, input })
    }

    const finishReason = mapFinishReason({ finishReason: choice.finish_reason, hasToolCall: toolCalls.length > 0 })
    const usage = toUsage(response.usage)
    const providerMetadata: SharedV2ProviderMetadata = {}
    if (message.reasoning_opaque != null)
      providerMetadata.openaiCompatible = { reasoning_opaque: message.reasoning_opaque }

    return {
      content,
      finishReason,
      usage,
      request: { body },
      response: {
        id: response.id,
        timestamp: new Date(response.created * 1000),
        modelId: response.model ?? this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
      providerMetadata,
      warnings,
    }
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const result = await this.getArgs(options)
    const body = result.body
    const warnings = result.warnings

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({ path: "/chat/completions", modelId: this.modelId }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: { ...body, stream: true },
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(copilotChatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const state = {
      textId: null as string | null,
      reasoningId: null as string | null,
      reasoningOpaque: null as string | null,
      finishReason: "unknown" as LanguageModelV2FinishReason,
      usage: emptyUsage(),
      toolCalls: new Map<number, ToolState>(),
      toolEmitted: false,
      hasToolCall: false,
    }

    const emitToolCalls = (controller: TransformStreamDefaultController<LanguageModelV2StreamPart>) => {
      if (state.toolEmitted || state.toolCalls.size === 0) return
      for (const entry of state.toolCalls.values()) {
        if (entry.started) controller.enqueue({ type: "tool-input-end", id: entry.id })
        controller.enqueue({ type: "tool-call", toolCallId: entry.id, toolName: entry.name, input: entry.args })
      }
      state.toolEmitted = true
    }

    const ensureTextStart = (controller: TransformStreamDefaultController<LanguageModelV2StreamPart>) => {
      if (state.textId) return
      state.textId = generateId()
      controller.enqueue({ type: "text-start", id: state.textId })
    }

    const ensureReasoningStart = (controller: TransformStreamDefaultController<LanguageModelV2StreamPart>) => {
      if (state.reasoningId) return
      state.reasoningId = generateId()
      controller.enqueue({
        type: "reasoning-start",
        id: state.reasoningId,
        providerMetadata: reasoningMetadata(state.reasoningOpaque),
      })
    }

    return {
      stream: response.pipeThrough(
        new TransformStream<ParseResult<CopilotChatChunk>, LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings })
          },
          transform(chunk, controller) {
            if (options.includeRawChunks) controller.enqueue({ type: "raw", rawValue: chunk.rawValue })
            if (!chunk.success) {
              state.finishReason = "error"
              controller.enqueue({ type: "error", error: chunk.error })
              return
            }

            const value = chunk.value
            const choice = value.choices[0]
            if (!choice) return
            const delta = choice.delta

            if (delta.reasoning_opaque != null) state.reasoningOpaque = delta.reasoning_opaque
            const reasoning = pickReasoning(delta)
            if (reasoning != null) {
              ensureReasoningStart(controller)
              controller.enqueue({
                type: "reasoning-delta",
                id: state.reasoningId as string,
                delta: reasoning,
                providerMetadata: reasoningMetadata(state.reasoningOpaque),
              })
            }

            if (typeof delta.content === "string") {
              ensureTextStart(controller)
              controller.enqueue({ type: "text-delta", id: state.textId as string, delta: delta.content })
            }

            if (delta.tool_calls) {
              for (const call of delta.tool_calls) {
                state.hasToolCall = true
                const index = call.index ?? 0
                const entry = state.toolCalls.get(index) ?? {
                  id: call.id ?? generateId(),
                  name: "",
                  args: "",
                  started: false,
                }
                if (call.id) entry.id = call.id
                if (call.function?.name) entry.name = call.function.name

                const args = typeof call.function?.arguments === "string" ? call.function.arguments : ""
                if (args) entry.args += args

                const shouldStart = !entry.started && entry.name
                if (shouldStart) {
                  entry.started = true
                  controller.enqueue({ type: "tool-input-start", id: entry.id, toolName: entry.name })
                  if (entry.args) controller.enqueue({ type: "tool-input-delta", id: entry.id, delta: entry.args })
                }
                if (entry.started && !shouldStart && args) {
                  controller.enqueue({ type: "tool-input-delta", id: entry.id, delta: args })
                }

                state.toolCalls.set(index, entry)
              }
            }

            if (value.usage) state.usage = toUsage(value.usage)
            if (choice.finish_reason != null) {
              state.finishReason = mapFinishReason({
                finishReason: choice.finish_reason,
                hasToolCall: state.hasToolCall,
              })
              emitToolCalls(controller)
            }
          },
          flush(controller) {
            if (state.textId) {
              controller.enqueue({ type: "text-end", id: state.textId })
              state.textId = null
            }
            if (state.reasoningId) {
              controller.enqueue({
                type: "reasoning-end",
                id: state.reasoningId,
                providerMetadata: reasoningMetadata(state.reasoningOpaque),
              })
              state.reasoningId = null
            }
            emitToolCalls(controller)

            const providerMetadata: SharedV2ProviderMetadata = {}
            if (state.reasoningOpaque != null)
              providerMetadata.openaiCompatible = { reasoning_opaque: state.reasoningOpaque }
            controller.enqueue({
              type: "finish",
              finishReason: state.finishReason,
              usage: state.usage,
              providerMetadata,
            })
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    }
  }
}

function prepareTools(input: {
  tools: Parameters<LanguageModelV2["doGenerate"]>[0]["tools"]
  toolChoice?: Parameters<LanguageModelV2["doGenerate"]>[0]["toolChoice"]
  modelId: string
}) {
  const warnings: LanguageModelV2CallWarning[] = []
  const list = input.tools?.length ? input.tools : undefined
  if (!list) return { tools: undefined, toolChoice: undefined, warnings }

  const isGemini = input.modelId.toLowerCase().includes("gemini")

  const tools: Array<CopilotChatTool> = []
  for (const tool of list) {
    if (tool.type === "function") {
      const params = isGemini ? ProviderTransform.sanitizeGeminiSchema(tool.inputSchema) : tool.inputSchema
      tools.push({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: params },
      })
      continue
    }
    warnings.push({ type: "unsupported-tool", tool })
  }

  if (!input.toolChoice) return { tools, toolChoice: undefined, warnings }
  const type = input.toolChoice.type
  if (type === "auto" || type === "none" || type === "required") return { tools, toolChoice: type, warnings }
  if (type === "tool") {
    return { tools, toolChoice: { type: "function", function: { name: input.toolChoice.toolName } }, warnings }
  }
  warnings.push({ type: "unsupported-setting", setting: "toolChoice" })
  return { tools, toolChoice: undefined, warnings }
}
function pickReasoning(delta: { reasoning_text?: string | null }) {
  return typeof delta.reasoning_text === "string" ? delta.reasoning_text : null
}
function reasoningMetadata(opaque: string | null): SharedV2ProviderMetadata {
  return { openaiCompatible: { reasoning_opaque: opaque } }
}
function toResponseFormat(responseFormat: Parameters<LanguageModelV2["doGenerate"]>[0]["responseFormat"]) {
  if (!responseFormat || responseFormat.type !== "json") return undefined
  if (responseFormat.schema) {
    return {
      type: "json_schema",
      json_schema: {
        name: responseFormat.name ?? "response",
        description: responseFormat.description,
        schema: responseFormat.schema,
        strict: false,
      },
    }
  }
  return { type: "json_object" }
}
function emptyUsage(): LanguageModelV2Usage {
  return {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    reasoningTokens: undefined,
    cachedInputTokens: undefined,
  }
}
function toUsage(usage: z.infer<typeof copilotChatUsageSchema> | null | undefined): LanguageModelV2Usage {
  if (!usage) return emptyUsage()
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? undefined,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
  }
}
function mapFinishReason(input: {
  finishReason: string | null | undefined
  hasToolCall: boolean
}): LanguageModelV2FinishReason {
  if (input.finishReason == null) return input.hasToolCall ? "tool-calls" : "stop"
  if (input.finishReason === "stop") return "stop"
  if (input.finishReason === "length") return "length"
  if (input.finishReason === "content_filter") return "content-filter"
  if (input.finishReason === "tool_calls") return "tool-calls"
  if (input.finishReason === "function_call") return "tool-calls"
  return input.hasToolCall ? "tool-calls" : "unknown"
}
